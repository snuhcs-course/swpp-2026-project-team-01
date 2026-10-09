-- Exact closure retries retain only minimal status, never transcript authority.
create table fmat.request_closures (
 request_id uuid primary key references fmat.requests(id) on delete cascade,
 actor_scope text not null,
 key uuid not null,
 operation text not null check(operation in ('withdraw','decline')),
 input jsonb not null,
 result_revision integer not null check(result_revision>0),
 created_at timestamptz not null default clock_timestamp()
);
alter table fmat.request_closures enable row level security;
revoke all on fmat.request_closures from public,anon,authenticated;
create trigger request_closures_immutable before update on fmat.request_closures for each row execute function fmat.reject_candidate_evaluation_update();

create or replace function fmat.request_lifecycle_view(p_request_id uuid,p_kind text)
returns jsonb language plpgsql set search_path='' as $$
declare r fmat.requests; state text; closed boolean; can_close boolean;
begin
 select * into strict r from fmat.requests where id=p_request_id;
 state:=case when r.status='booked' then 'booked'
  when r.status='booking' or exists(select 1 from fmat.booking_attempts where request_id=r.id and phase not in ('blocked','noncreating')) then 'booking'
  when r.status in ('gathering','negotiating','awaiting_approval') and r.expires_at<=clock_timestamp() then 'expired' else r.status end;
 closed:=state in ('booked','declined','withdrawn','expired');
 -- A booking label alone is not proof that cancellation can prevent a write.
 -- Only a saved, provably undispatched prepared attempt opens that window.
 can_close:=not closed and (state<>'booking' or exists(select 1 from fmat.booking_attempts where request_id=r.id and phase='prepared'))
  and not exists(select 1 from fmat.booking_attempts a where a.request_id=r.id and
   (a.phase in ('dispatched','uncertain','conflict','confirmed') or (a.phase='prepared' and
    (a.dispatched_at is not null or exists(select 1 from fmat.booking_dispatches where attempt_id=a.id)))));
 return jsonb_build_object('requestId',r.id,'revision',r.revision,'status',state,'closed',closed,
  'canWithdraw',can_close and p_kind='guest','canDecline',can_close and p_kind='host');
end;
$$;
revoke all on function fmat.request_lifecycle_view(uuid,text) from public,anon,authenticated,service_role;

create or replace function public.fmat_request_lifecycle(p_operation text,p_credential jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r fmat.requests; actor jsonb; scope text; prior fmat.request_closures; result jsonb;
begin
 if p_operation is null or p_operation not in ('read','withdraw','decline') or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 if (p_operation='withdraw' and p_credential->>'kind' is distinct from 'guest') or (p_operation='decline' and p_credential->>'kind' is distinct from 'host') then raise exception 'FORBIDDEN';end if;
 select * into r from fmat.requests where id=(p_input->>'requestId')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if p_credential->>'kind'='host' then
  actor:=fmat.calendar_actor(p_credential);perform fmat.require_request(actor,r.id);
  scope:='host:'||(p_credential->>'subject')||':'||(p_credential->>'sessionId');
 elsif p_credential->>'kind'='guest' then
  -- Closure revokes mutation authority but preserves an unexpired, same-token
  -- minimal receipt. Wall-clock checks run after acquiring the request lock.
  if p_credential->>'requestId' is distinct from r.id::text or p_credential->>'tokenHash' is distinct from r.token_hash or r.token_expires_at<=clock_timestamp()
   or (r.token_revoked_at is not null and r.status not in ('booked','declined','withdrawn','expired')) then raise exception 'NOT_FOUND';end if;
  actor:=jsonb_build_object('kind','guest','requestId',r.id);scope:='guest:'||(p_credential->>'tokenHash');
 else raise exception 'UNAUTHORIZED';end if;
 if p_operation='read' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k<>'requestId') then raise exception 'INVALID_INPUT';end if;
  return fmat.request_lifecycle_view(r.id,p_credential->>'kind');
 end if;
 if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','revision','confirmed','idempotencyKey')) or p_input->'confirmed' is distinct from 'true'::jsonb or p_input->>'idempotencyKey' is null then raise exception 'INVALID_INPUT';end if;
 select * into prior from fmat.request_closures where request_id=r.id;
 if prior.request_id is not null and prior.actor_scope=scope and prior.key=(p_input->>'idempotencyKey')::uuid then
  if prior.operation<>p_operation or prior.input is distinct from p_input then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  if prior.result_revision<>r.revision or r.status<>(case when p_operation='withdraw' then 'withdrawn' else 'declined' end) then raise exception 'REVISION_CONFLICT';end if;
  return fmat.request_lifecycle_view(r.id,p_credential->>'kind');
 end if;
 -- Request locking serializes closure with dispatch. Never lock jobs here:
 -- the worker owns its job before waiting for this request.
 perform 1 from fmat.hosts where id=r.host_id for update;
 perform 1 from fmat.booking_attempts where request_id=r.id order by id for update;
 if p_credential->>'kind'='host' then perform fmat.calendar_actor(p_credential);
 elsif r.token_expires_at<=clock_timestamp() then raise exception 'NOT_FOUND';end if;
 result:=fmat.request_lifecycle_view(r.id,p_credential->>'kind');
 if result->>'status'='booking' and not (result->>(case when p_operation='withdraw' then 'canWithdraw' else 'canDecline' end))::boolean then raise exception 'BOOKING_PENDING';end if;
 if (result->>'closed')::boolean then raise exception 'REQUEST_CLOSED';end if;
 if (p_input->>'revision')::integer is distinct from r.revision then raise exception 'REVISION_CONFLICT';end if;
 return fmat.commit_request_closure(r,actor,scope,p_operation,p_input);
end;
$$;
revoke all on function public.fmat_request_lifecycle(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_request_lifecycle(text,jsonb,jsonb) to service_role;
