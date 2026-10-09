-- Conservative allowance, not provider invoice data. No prompts or credentials.
create table fmat.model_budgets (
 name text primary key check(name='service' or name ~ '^(host|guest):[a-f0-9-]{36}$'),
 window_started_at timestamptz not null,
 reserved_cents integer not null check(reserved_cents>=0)
);
create table fmat.model_work_attempts (
 name text primary key check(name ~ '^(conversation|ranking):[a-f0-9-]{36}$'),
 attempts integer not null check(attempts between 0 and 8)
);
alter table fmat.model_budgets enable row level security;
alter table fmat.model_work_attempts enable row level security;
revoke all on fmat.model_budgets,fmat.model_work_attempts from public,anon,authenticated,service_role;

create or replace function fmat.model_budget_reserve(p_kind text,p_principal uuid,p_work_kind text,p_work uuid)
returns void language plpgsql set search_path='' as $$
declare key text; work_key text; b fmat.model_budgets; checked_at timestamptz; used integer; ceiling integer;
begin
 if p_kind is null or p_kind not in ('host','guest') or p_principal is null
  or p_work_kind is null or p_work_kind not in ('conversation','ranking') or p_work is null then raise exception 'UNAUTHORIZED';end if;
 -- Callers acquire every authority lock before this shared ordering. Never
 -- refund an uncertain attempt or recreate an expired work counter.
 foreach key in array array['service',p_kind||':'||p_principal::text] loop
  insert into fmat.model_budgets values(key,clock_timestamp(),0) on conflict do nothing;
  perform 1 from fmat.model_budgets where name=key for update;
 end loop;
 work_key:=p_work_kind||':'||p_work::text;
 insert into fmat.model_work_attempts values(work_key,0) on conflict do nothing;
 select attempts into strict used from fmat.model_work_attempts where name=work_key for update;
 if used>=(case when p_work_kind='conversation' then 8 else 2 end) then raise exception 'MODEL_LIMIT';end if;
 checked_at:=clock_timestamp();
 foreach key in array array['service',p_kind||':'||p_principal::text] loop
  select * into strict b from fmat.model_budgets where name=key;
  if b.window_started_at+interval '24 hours'<=checked_at then b.window_started_at:=checked_at;b.reserved_cents:=0;end if;
  ceiling:=case when key='service' then 30000 else 3000 end;
  if b.reserved_cents+60>ceiling then raise exception 'MODEL_LIMIT';end if;
  update fmat.model_budgets set window_started_at=b.window_started_at,reserved_cents=b.reserved_cents+60 where name=key;
 end loop;
 update fmat.model_work_attempts set attempts=used+1 where name=work_key;
end;
$$;
revoke all on function fmat.model_budget_reserve(text,uuid,text,uuid) from public,anon,authenticated,service_role;

create or replace function public.fmat_conversation_model_reserve(p_grant_id uuid,p_conversation_id uuid,p_message_id uuid,p_session_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare access jsonb; scope fmat.conversation_scopes; message fmat.runtime_messages;
begin
 if p_grant_id is null or p_conversation_id is null or p_message_id is null
  or length(coalesce(p_session_id,'')) not between 1 and 200 then raise exception 'UNAUTHORIZED';end if;
 perform pg_advisory_xact_lock(hashtextextended('runtime:'||p_conversation_id::text,0));
 access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
 if (access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED';end if;
 select * into strict scope from fmat.conversation_scopes where id=p_conversation_id for update;
 perform fmat.require_runtime_generation(scope,p_session_id);
 select * into message from fmat.runtime_messages where id=p_message_id and conversation_id=p_conversation_id and grant_id=p_grant_id for update;
 if not found or message.status<>'pending' then raise exception 'NOT_FOUND';end if;
 perform fmat.model_budget_reserve(access->>'actorKind',case when access->>'actorKind'='host' then scope.host_id else scope.request_id end,'conversation',message.id);
 -- Time may expire while the service counter is contended. All charges roll
 -- back if the original authority is no longer valid after that wait.
 access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
 if (access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED';end if;
 return jsonb_build_object('reserved',true);
end;
$$;
revoke all on function public.fmat_conversation_model_reserve(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fmat_conversation_model_reserve(uuid,uuid,uuid,text) to service_role;
