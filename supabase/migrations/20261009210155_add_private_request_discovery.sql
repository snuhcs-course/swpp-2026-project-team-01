SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION fmat.host_request_model_page (
  p_host_id uuid,
  p_input   jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare page jsonb; rows jsonb;
begin
 if jsonb_typeof(p_input) is distinct from 'object'
  or p_input-array['search','status','beforeCreatedAt','beforeId']<>'{}'::jsonb
  or (p_input?'search' and jsonb_typeof(p_input->'search') is distinct from 'string')
  or (p_input?'status' and jsonb_typeof(p_input->'status') is distinct from 'string')
  or (p_input?'beforeCreatedAt' and jsonb_typeof(p_input->'beforeCreatedAt') is distinct from 'string')
  or (p_input?'beforeId' and jsonb_typeof(p_input->'beforeId') is distinct from 'string')
  then raise exception 'INVALID_INPUT'; end if;
 page:=fmat.host_request_page(p_host_id,p_input);
 select coalesce(jsonb_agg(jsonb_build_object(
  'requestId',item->'requestId','revision',item->'revision','title',item->'title',
  'status',item->'status','closed',item->'closed','createdAt',item->'createdAt',
  'updatedAt',item->'updatedAt','proposalVersion',item->'proposalVersion'
 ) order by position),'[]'::jsonb) into rows
 from jsonb_array_elements(page->'requests') with ordinality as entry(item,position);
 return jsonb_build_object('requests',rows,'nextCursor',page->'nextCursor');
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_conversation_tool (
  p_grant_id        uuid,
  p_conversation_id uuid,
  p_operation       text,
  p_input           jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_access jsonb; v_actor jsonb; v_input jsonb; v_result jsonb; v_request_id uuid;
begin
  v_access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
  v_actor:=v_access->'actor'; v_request_id:=(v_access->>'requestId')::uuid;
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
  case p_operation
  when 'host_requests_read' then
    if v_access->>'audience' not in ('host_setup','host_private') or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    return fmat.host_request_model_page((v_actor->>'id')::uuid,p_input);
  when 'setup_read' then
    if v_access->>'audience' not in ('host_setup','host_private') or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
    return fmat.host_setup_operation('read',v_actor,'{}','assistant');
  when 'setup_analysis_read' then
    if v_access->>'audience' not in ('host_setup','host_private') or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
    return fmat.calendar_scan_model_view((v_actor->>'id')::uuid);
  when 'setup_draft' then
    if v_access->>'audience'<>'host_setup' or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    return fmat.host_setup_operation('draft',v_actor,p_input,'assistant');
  when 'request_read' then
    if v_request_id is null then raise exception 'FORBIDDEN'; end if;
    if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
    -- Host identity does not make a shared conversation private. Project for
    -- the audience at the database boundary before any model sees the result.
    v_result:=fmat.request_view(v_request_id,case when v_access->>'audience'='request_shared' then '{"kind":"guest"}'::jsonb else v_actor end);
    if v_actor->>'kind'='guest' then
      v_result:=v_result||jsonb_build_object('review',(select fmat.request_detail_review_view(r) from fmat.request_detail_reviews r
        where r.request_id=v_request_id and r.authority_key=v_actor->>'tokenHash' order by r.created_at desc,r.id desc limit 1));
    end if;
    return v_result;
  when 'private_note_save' then
    if v_access->>'audience'<>'host_private' or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('text','expectedRevision','idempotencyKey')) then raise exception 'INVALID_INPUT'; end if;
    if jsonb_typeof(p_input->'text') is distinct from 'string' then raise exception 'INVALID_INPUT'; end if;
  when 'details_propose' then
    if v_access->>'audience'<>'request_shared' or v_actor->>'kind'<>'guest' then raise exception 'FORBIDDEN'; end if;
    if (v_access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED'; end if;
    return fmat.propose_request_details(v_actor,p_input);
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
$function$;

REVOKE ALL ON FUNCTION "fmat"."host_request_model_page"(uuid, jsonb) FROM PUBLIC;
