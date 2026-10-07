-- Model tools receive an execution reference captured by authenticated ingress.
-- They cannot supply an actor, resource ID, decision, or privileged operation.
create or replace function public.fmat_conversation_tool(
  p_grant_id uuid,p_conversation_id uuid,p_operation text,p_input jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_access jsonb; v_actor jsonb; v_input jsonb; v_result jsonb; v_request_id uuid;
begin
  v_access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
  v_actor:=v_access->'actor'; v_request_id:=(v_access->>'requestId')::uuid;
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
  case p_operation
  when 'setup_read' then
    if v_access->>'audience' not in ('host_setup','host_private') or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
    return fmat.host_setup_operation('read',v_actor,'{}','assistant');
  when 'setup_draft' then
    if v_access->>'audience'<>'host_setup' or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    return fmat.host_setup_operation('draft',v_actor,p_input,'assistant');
  when 'request_read' then
    if v_request_id is null then raise exception 'FORBIDDEN'; end if;
    if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
    -- Host identity does not make a shared conversation private. Project for
    -- the audience at the database boundary before any model sees the result.
    return fmat.request_view(v_request_id,case when v_access->>'audience'='request_shared' then '{"kind":"guest"}'::jsonb else v_actor end);
  when 'private_note_save' then
    if v_access->>'audience'<>'host_private' or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('text','expectedRevision','idempotencyKey')) then raise exception 'INVALID_INPUT'; end if;
    if jsonb_typeof(p_input->'text') is distinct from 'string' then raise exception 'INVALID_INPUT'; end if;
  when 'details_update' then
    if v_access->>'audience'<>'request_shared' then raise exception 'FORBIDDEN'; end if;
    if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('details','expectedRevision','idempotencyKey')) then raise exception 'INVALID_INPUT'; end if;
    if jsonb_typeof(p_input->'details') is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(p_input->'details') k where k not in ('requesterName','requesterEmail','purpose','durationMinutes','timezone','windows','mode','location')) then raise exception 'INVALID_INPUT'; end if;
  else
    -- Approval, agreement, confirmed settings, travel exceptions and worker or
    -- provider outcomes require separate authored application operations.
    raise exception 'FORBIDDEN';
  end case;
  if (v_access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED'; end if;
  if jsonb_typeof(p_input->'expectedRevision') is distinct from 'number'
    or (p_input->>'expectedRevision') !~ '^[0-9]+$'
    or jsonb_typeof(p_input->'idempotencyKey') is distinct from 'string' then raise exception 'INVALID_INPUT'; end if;
  v_input:=p_input||jsonb_build_object('requestId',v_request_id);
  v_result:=public.fmat_command(p_operation,v_actor,v_input);
  if v_access->>'audience'='request_shared' then
    -- Also scrub cached idempotency results; these may have been produced by
    -- the host's same command from a private application surface.
    select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_result from jsonb_each(v_result)
      where key=any(array['id','hostId','revision','status','details','candidates','proposal','requesterAgreed','hostApproved','contactVerified','calendarConnected','event','messages','nextAction','receipt']);
  end if;
  return v_result;
end;
$$;
revoke execute on function public.fmat_conversation_tool(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_conversation_tool(uuid,uuid,text,jsonb) to service_role;
