-- Private web setup tools reuse current browser Calendar authority. No model
-- input supplies an actor or credential; every provider phase rechecks ingress.
create or replace function public.fmat_conversation_calendar(
 p_grant_id uuid,p_conversation_id uuid,p_session_id text,p_message_id uuid,p_operation text,p_input jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_access jsonb;v_scope fmat.conversation_scopes;v_grant fmat.conversation_grants;
 v_receipt fmat.idempotency;v_actor_scope text;v_key text;v_result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('runtime:'||p_conversation_id::text,0));
 v_access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
 select * into strict v_scope from fmat.conversation_scopes where id=p_conversation_id;
 perform fmat.require_runtime_generation(v_scope,p_session_id,true);
 select * into strict v_grant from fmat.conversation_grants where id=p_grant_id;
 if v_access->>'audience' is distinct from 'host_setup' or v_access->'actor'->>'kind' is distinct from 'host'
  or v_grant.credential->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN';end if;
 if not exists(select 1 from fmat.runtime_messages where id=p_message_id and conversation_id=p_conversation_id and grant_id=p_grant_id and status='pending') then raise exception 'UNAUTHORIZED';end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 if p_operation in ('replay','select') then
  if jsonb_typeof(p_input->'choice') is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
  v_actor_scope:='host:'||v_scope.host_id::text;v_key:='calendar:'||p_message_id::text;
  select * into v_receipt from fmat.idempotency where actor_scope=v_actor_scope and operation='conversation_calendar_select' and key=v_key for update;
  if found then
   if v_receipt.input is distinct from p_input->'choice' then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   return v_receipt.result;
  end if;
  if p_operation='replay' then return 'null'::jsonb;end if;
  v_result:=public.fmat_calendar_access('select',v_grant.credential,p_input->'selection');
  insert into fmat.idempotency(actor_scope,operation,key,input,result) values(v_actor_scope,'conversation_calendar_select',v_key,p_input->'choice',v_result);
  return v_result;
 elsif p_operation in ('read','check','refresh') then
  return public.fmat_calendar_access(p_operation,v_grant.credential,p_input);
 end if;
 raise exception 'FORBIDDEN';
end;
$$;
revoke all on function public.fmat_conversation_calendar(uuid,uuid,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_conversation_calendar(uuid,uuid,text,uuid,text,jsonb) to service_role;
