SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION fmat.host_request_page (
  p_host_id uuid,
  p_input   jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_request fmat.requests; v_item jsonb; v_rows jsonb:='[]'; v_cursor jsonb; v_search text; v_status text; v_before timestamptz; v_id uuid;
begin
 if p_host_id is null then raise exception 'FORBIDDEN';end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 v_search:=trim(coalesce(p_input->>'search',''));v_status:=coalesce(p_input->>'status','active');
 if length(v_search)>200 or v_status not in ('active','closed','all') or ((p_input->>'beforeId') is null)<>((p_input->>'beforeCreatedAt') is null) then raise exception 'INVALID_INPUT'; end if;
 v_before:=(p_input->>'beforeCreatedAt')::timestamptz;v_id:=(p_input->>'beforeId')::uuid;
 -- Pagination is stable under updates. The cursor is a position, never authority.
 for v_request in select r.* from fmat.requests r where r.host_id=p_host_id
   and (v_before is null or (r.created_at,r.id)<(v_before,v_id))
   and (v_search='' or position(lower(v_search) in lower(coalesce(r.details->>'purpose','')||' '||coalesce(r.details->>'requesterName','')))>0)
   and (v_status='all' or (v_status='closed')=(r.status in ('booked','declined','withdrawn','expired') or (r.status<>'booking' and r.expires_at<=statement_timestamp())))
   order by r.created_at desc,r.id desc limit 31
 loop
   if jsonb_array_length(v_rows)=30 then return jsonb_build_object('requests',v_rows,'nextCursor',v_cursor); end if;
   v_item:=fmat.host_request_summary(v_request);v_rows:=v_rows||jsonb_build_array(v_item);
   v_cursor:=jsonb_build_object('beforeCreatedAt',v_request.created_at,'beforeId',v_request.id);
 end loop;
 return jsonb_build_object('requests',v_rows,'nextCursor',null);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_agent_operation (
  p_grant_id         uuid,
  p_client_id        uuid,
  p_resource         text,
  p_actor_kind       text,
  p_actor_id         uuid,
  p_scope            text,
  p_token_expires_at bigint,
  p_operation        text,
  p_request_id       uuid,
  p_input            jsonb,
  p_idempotency_key  uuid   DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_grant fmat.oauth_grants; v_request fmat.requests; v_actor jsonb; v_input jsonb; v_result jsonb; v_scope text; v_write boolean;
begin
 if p_operation is null or p_operation not in ('setup_read','setup_analysis_read','setup_draft','request_read','private_note_save','details_propose','decision_review','requests_list') then raise exception 'FORBIDDEN';end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 v_write:=p_operation in ('setup_draft','private_note_save','details_propose');
 if (v_write and p_idempotency_key is null) or (not v_write and (p_idempotency_key is not null or (p_operation<>'requests_list' and p_input<>'{}'::jsonb))) then raise exception 'INVALID_INPUT';end if;
 if p_input ? 'idempotencyKey' or p_input ? 'requestId' or p_input ? 'actor' then raise exception 'INVALID_INPUT';end if;
 if p_token_expires_at is null or p_token_expires_at<=extract(epoch from clock_timestamp()) then return '{"error":"invalid_token"}';end if;
 select * into v_grant from fmat.oauth_grants where id=p_grant_id;
 if not found or v_grant.client_id is distinct from p_client_id or v_grant.resource is distinct from p_resource
  or v_grant.actor_kind is distinct from p_actor_kind or v_grant.actor_id is distinct from p_actor_id then return '{"error":"invalid_grant"}';end if;
 if (p_operation like 'setup_%' or p_operation in ('private_note_save','requests_list')) and v_grant.actor_kind<>'host'
  or p_operation='details_propose' and v_grant.actor_kind<>'guest' then raise exception 'FORBIDDEN';end if;
 v_scope:=(case when v_grant.actor_kind='host' then 'host:' else 'request:' end)||
  case when p_operation='decision_review' then 'decide' when v_write then 'write' else 'read' end;
 if not fmat.oauth_scope_valid(p_scope) or not(v_scope=any(string_to_array(p_scope,' '))) then return '{"error":"invalid_scope"}';end if;
 if p_operation='requests_list' then
  if p_request_id is not null then raise exception 'FORBIDDEN';end if;
 elsif p_operation like 'setup_%' then
  if p_request_id is not null then raise exception 'FORBIDDEN';end if;
  -- Setup helpers take UPDATE; acquire it before grant-check SHARE to avoid
  -- two different grants deadlocking on a later lock upgrade.
  perform 1 from fmat.hosts where id=v_grant.host_id for update;
 else
  if p_request_id is null or (v_grant.actor_kind='guest' and p_request_id is distinct from v_grant.request_id) then raise exception 'FORBIDDEN';end if;
  select * into v_request from fmat.requests where id=p_request_id and host_id=v_grant.host_id for update;
  if not found then raise exception 'FORBIDDEN';end if;
 end if;
 v_grant:=fmat.oauth_lock_grant(p_grant_id);
 if v_grant.id is null or not(string_to_array(p_scope,' ') <@ string_to_array(v_grant.scope,' ')) then return '{"error":"invalid_grant"}';end if;
 if p_token_expires_at<=extract(epoch from clock_timestamp()) or p_token_expires_at>floor(extract(epoch from v_grant.expires_at)) then return '{"error":"invalid_token"}';end if;
 if v_grant.actor_kind='host' then
  select jsonb_build_object('kind','host','id',v_grant.actor_id,'email',email) into v_actor from auth.users where id=v_grant.actor_id;
 else v_actor:=jsonb_build_object('kind','guest','requestId',v_grant.request_id,'tokenHash',v_grant.token_hash);end if;
 v_actor:=v_actor||jsonb_build_object('agentClientId',v_grant.client_id,'agentGrantId',v_grant.id);
 v_input:=p_input;
 if v_write then v_input:=v_input||jsonb_build_object('idempotencyKey','agent:'||v_grant.id::text||':'||p_idempotency_key::text);end if;
 -- Any later helper lock can consume the remaining token/authority lifetime.
 -- Roll back its domain effect before returning an expired outcome.
 begin
  case p_operation
  when 'requests_list' then
   if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('search','status','beforeId','beforeCreatedAt'))
    or (p_input ? 'search' and jsonb_typeof(p_input->'search') is distinct from 'string')
    or (p_input ? 'status' and jsonb_typeof(p_input->'status') is distinct from 'string')
    or (p_input ? 'beforeId' and jsonb_typeof(p_input->'beforeId') is distinct from 'string')
    or (p_input ? 'beforeCreatedAt' and jsonb_typeof(p_input->'beforeCreatedAt') is distinct from 'string') then raise exception 'INVALID_INPUT';end if;
   -- Agent cursors must identify an actual position within this host's list.
   -- An absent/deleted/foreign anchor fails neutrally; restart from page one.
   if p_input ? 'beforeId' and not exists(select 1 from fmat.requests
     where id=(p_input->>'beforeId')::uuid and host_id=v_grant.host_id
       and created_at=(p_input->>'beforeCreatedAt')::timestamptz) then raise exception 'INVALID_INPUT';end if;
   v_result:=fmat.host_request_page(v_grant.host_id,p_input);
  when 'setup_read' then v_result:=fmat.host_setup_operation('read',v_actor,'{}','assistant');
  when 'setup_analysis_read' then v_result:=fmat.calendar_scan_model_view(v_grant.host_id);
  when 'setup_draft' then v_result:=fmat.host_setup_operation('draft',v_actor,v_input,'assistant');
  when 'request_read' then
   v_result:=fmat.request_view(p_request_id,v_actor);
   if v_grant.actor_kind='guest' then
    v_result:=v_result||jsonb_build_object('review',(select fmat.request_detail_review_view(r) from fmat.request_detail_reviews r
      where r.request_id=p_request_id and r.authority_key=v_grant.token_hash order by r.created_at desc,r.id desc limit 1));
   end if;
  when 'private_note_save' then
   if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('text','expectedRevision'))
    or jsonb_typeof(p_input->'text') is distinct from 'string' or length(trim(p_input->>'text')) not between 1 and 10000
    or jsonb_typeof(p_input->'expectedRevision') is distinct from 'number' or (p_input->>'expectedRevision') !~ '^[0-9]+$' then raise exception 'INVALID_INPUT';end if;
   v_result:=public.fmat_command('private_note_save',v_actor,v_input||jsonb_build_object('requestId',p_request_id));
  when 'details_propose' then v_result:=fmat.propose_request_details(v_actor,v_input);
  when 'decision_review' then
   v_result:=jsonb_build_object('requiresHumanConfirmation',true,'requestId',p_request_id,'revision',v_request.revision,
    'path',case when v_grant.actor_kind='host' then '/app' else '/booking/'||p_request_id::text end);
  end case;
  if p_token_expires_at<=extract(epoch from clock_timestamp()) or v_grant.expires_at<=clock_timestamp() or not fmat.oauth_authority_current(v_grant) then
   raise exception using errcode='PT401',message='AGENT_AUTHORITY_EXPIRED';
  end if;
 exception when sqlstate 'PT401' then
  -- This check is outside the rolled-back domain subtransaction so observed
  -- underlying authority loss remains permanently revoked.
  perform fmat.oauth_lock_grant(p_grant_id);
  return '{"error":"invalid_token"}';
 end;
 return v_result;
end$function$;

CREATE OR REPLACE FUNCTION public.fmat_host_requests (
  p_operation  text,
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_actor jsonb; v_request fmat.requests;
begin
 if p_credential->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
 if p_operation='read' then
   -- Match the request -> host -> Auth lock order used by conversation/evaluation.
   select * into v_request from fmat.requests where id=(p_input->>'requestId')::uuid for update;
 end if;
 v_actor:=fmat.calendar_actor(p_credential);
 if p_operation='read' then
   if v_request.id is null or v_request.host_id::text is distinct from v_actor->>'id' then raise exception 'NOT_FOUND'; end if;
   return fmat.host_request_summary(v_request);
 elsif p_operation<>'list' then raise exception 'FORBIDDEN'; end if;
 return fmat.host_request_page((v_actor->>'id')::uuid,p_input);
end;
$function$;

REVOKE ALL ON FUNCTION "fmat"."host_request_page"(uuid, jsonb) FROM PUBLIC;
