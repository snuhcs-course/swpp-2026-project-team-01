SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION fmat.requester_availability_view (
  p_request    fmat.requests,
  p_connection fmat.calendar_connections
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
 select jsonb_build_object('revision',p_request.revision,'mode',p_request.availability_mode,'failed',p_request.availability_failed,
 'connected',p_connection.id is not null,'selectedCalendarIds',to_jsonb(coalesce(p_connection.selected_calendar_ids,'{}')),
 'timezone',coalesce(p_request.details->>'timezone',''),'windows',coalesce(p_request.details->'windows','[]'));
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
declare v_grant fmat.oauth_grants; v_request fmat.requests; v_actor jsonb; v_input jsonb; v_result jsonb; v_scope text; v_write boolean; v_conversation fmat.conversation_scopes; v_connection fmat.calendar_connections;
begin
 if p_operation is null or p_operation not in ('setup_read','setup_analysis_read','setup_draft','request_read','private_note_save','details_propose','decision_review','requests_list','conversation_resolve','availability_read','availability_propose') then raise exception 'FORBIDDEN';end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 v_write:=p_operation in ('setup_draft','private_note_save','details_propose','availability_propose');
 if (v_write and p_idempotency_key is null) or (not v_write and (p_idempotency_key is not null or (p_operation not in ('requests_list','conversation_resolve') and p_input<>'{}'::jsonb))) then raise exception 'INVALID_INPUT';end if;
 if p_input ? 'idempotencyKey' or p_input ? 'requestId' or p_input ? 'actor' then raise exception 'INVALID_INPUT';end if;
 if p_token_expires_at is null or p_token_expires_at<=extract(epoch from clock_timestamp()) then return '{"error":"invalid_token"}';end if;
 select * into v_grant from fmat.oauth_grants where id=p_grant_id;
 if not found or v_grant.client_id is distinct from p_client_id or v_grant.resource is distinct from p_resource
  or v_grant.actor_kind is distinct from p_actor_kind or v_grant.actor_id is distinct from p_actor_id then return '{"error":"invalid_grant"}';end if;
 if (p_operation like 'setup_%' or p_operation in ('private_note_save','requests_list')) and v_grant.actor_kind<>'host'
  or p_operation in ('details_propose','availability_read','availability_propose') and v_grant.actor_kind<>'guest' then raise exception 'FORBIDDEN';end if;
 v_scope:=(case when v_grant.actor_kind='host' then 'host:' else 'request:' end)||
  case when p_operation='decision_review' then 'decide' when v_write then 'write' else 'read' end;
 if not fmat.oauth_scope_valid(p_scope) or not(v_scope=any(string_to_array(p_scope,' '))) then return '{"error":"invalid_scope"}';end if;
 if p_operation='conversation_resolve' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k<>'audience')
   or jsonb_typeof(p_input->'audience') is distinct from 'string'
   or p_input->>'audience' not in ('host_setup','host_private','request_shared')
   or ((p_input->>'audience'='host_setup')<>(p_request_id is null)) then raise exception 'INVALID_INPUT';end if;
  if v_grant.actor_kind='guest' and (p_input->>'audience'<>'request_shared' or p_request_id is distinct from v_grant.request_id) then raise exception 'FORBIDDEN';end if;
  if p_request_id is not null then
   select * into v_request from fmat.requests where id=p_request_id and host_id=v_grant.host_id for update;
   if not found then raise exception 'FORBIDDEN';end if;
  end if;
 elsif p_operation='requests_list' then
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
  when 'availability_read' then
   select * into v_connection from fmat.calendar_connections where principal_kind='guest' and principal_id=v_request.id
    and revoked_at is null and guest_authority_key=v_grant.token_hash for share;
   v_result:=fmat.requester_availability_view(v_request,v_connection);
  when 'availability_propose' then
   if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('expectedRevision','timezone','windows'))
    or jsonb_typeof(p_input->'timezone') is distinct from 'string' or length(p_input->>'timezone') not between 1 and 100
    or jsonb_typeof(p_input->'windows') is distinct from 'array'
    or jsonb_array_length(p_input->'windows') not between 1 and 30 then raise exception 'INVALID_INPUT';end if;
   if exists(select 1 from jsonb_array_elements(p_input->'windows') w where jsonb_typeof(w) is distinct from 'object'
    or jsonb_typeof(w->'start') is distinct from 'string' or jsonb_typeof(w->'end') is distinct from 'string') then raise exception 'INVALID_INPUT';end if;
   if exists(select 1 from jsonb_array_elements(p_input->'windows') w cross join lateral jsonb_object_keys(w) k where k not in ('start','end')) then raise exception 'INVALID_INPUT';end if;
   v_result:=fmat.propose_request_details(v_actor,jsonb_build_object('expectedRevision',p_input->'expectedRevision',
    'patch',jsonb_build_object('timezone',p_input->'timezone','windows',p_input->'windows'),'clarifications','[]'::jsonb,'idempotencyKey',v_input->>'idempotencyKey'));
  when 'conversation_resolve' then
   -- Internal adapter result only: never return the runtime binding as a tool result.
   select * into v_conversation from fmat.conversation_scopes where host_id=v_grant.host_id
     and request_id is not distinct from p_request_id and audience=p_input->>'audience' for share;
   if v_conversation.revoked_at is not null then raise exception 'NOT_FOUND';end if;
   if p_request_id is not null and (v_request.status in ('booked','declined','withdrawn','expired')
     or (v_request.expires_at<=clock_timestamp() and v_request.status<>'booking')) then raise exception 'REQUEST_CLOSED';end if;
   v_result:=jsonb_build_object('conversationId',v_conversation.id,'sessionId',v_conversation.runtime_session_id);
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

CREATE OR REPLACE FUNCTION public.fmat_requester_availability (
  p_operation  text,
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_actor jsonb; v_request fmat.requests; v_connection fmat.calendar_connections; v_ids text[]; v_id text; v_details jsonb;
begin
  if p_credential->>'kind' is distinct from 'guest' or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'FORBIDDEN'; end if;
  v_actor:=fmat.calendar_actor(p_credential);
  select * into strict v_request from fmat.requests where id=(v_actor->>'requestId')::uuid;
  select * into v_connection from fmat.calendar_connections where principal_kind='guest' and principal_id=v_request.id and revoked_at is null and guest_authority_key=p_credential->>'tokenHash' for update;
  if p_operation='status' then
    return fmat.requester_availability_view(v_request,v_connection);
  end if;
  if p_operation='manual' then
    if (p_input->>'revision')::integer is distinct from v_request.revision then raise exception 'REVISION_CONFLICT'; end if;
    if p_input->>'confirmed' is distinct from 'true' or jsonb_typeof(p_input->'windows') is distinct from 'array' or jsonb_array_length(p_input->'windows') not between 1 and 30 or coalesce(p_input->>'timezone','')='' then raise exception 'INVALID_INPUT'; end if;
    v_details:=fmat.normalize_details(v_request.details||jsonb_build_object('windows',p_input->'windows','timezone',p_input->>'timezone'));
    perform fmat.request_command('request_calendar_disconnect',v_actor,jsonb_build_object('requestId',v_request.id,'expectedRevision',v_request.revision));
    update fmat.requests set details=v_details,availability_mode='manual',availability_failed=false,expires_at=fmat.request_expiry(v_details,created_at),status=case when fmat.details_complete(v_details) then 'negotiating' else 'gathering' end where id=v_request.id returning * into v_request;
    perform fmat.audit('manual_availability',v_actor,v_request.id::text);
    return jsonb_build_object('saved',true,'revision',v_request.revision);
  end if;
  if v_connection.id is null or v_request.availability_mode<>'calendar' then raise exception 'RECONNECT_REQUIRED'; end if;
  if p_operation='read' then
    return jsonb_build_object('connectionId',v_connection.id,'generation',v_connection.generation,'principalId',v_request.id,'encryptedCredential',v_connection.encrypted_credential,'revision',v_request.revision,'selectedCalendarIds',to_jsonb(v_connection.selected_calendar_ids),'windows',coalesce(v_request.details->'windows','[]'));
  end if;
  if (p_input->>'connectionId')::uuid is distinct from v_connection.id or (p_input->>'generation')::uuid is distinct from v_connection.generation or (p_input->>'revision')::integer is distinct from v_request.revision then raise exception 'REVISION_CONFLICT'; end if;
  if p_operation='check' then return jsonb_build_object('current',true);
  elsif p_operation='read_success' then
    update fmat.requests set availability_failed=false where id=v_request.id;
    return jsonb_build_object('current',true);
  elsif p_operation='read_failure' then
    update fmat.requests set availability_failed=true,revision=revision+1,candidates='[]',private_diagnostics='[]',private_travel_checks='[]',current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,status=case when fmat.details_complete(details) then 'negotiating' else 'gathering' end,updated_at=clock_timestamp() where id=v_request.id returning * into v_request;
    insert into fmat.request_history(request_id,revision,operation,actor) values(v_request.id,v_request.revision,'requester_calendar_failed',v_actor-'tokenHash');
    perform fmat.audit('requester_calendar_failed',v_actor,v_request.id::text);
    return jsonb_build_object('paused',true);
  elsif p_operation='refresh' then
    if p_input->>'previousCredential' is distinct from v_connection.encrypted_credential then raise exception 'REVISION_CONFLICT'; end if;
    if length(coalesce(p_input->>'encryptedCredential','')) not between 20 and 131072 then raise exception 'INVALID_INPUT'; end if;
    update fmat.calendar_connections set encrypted_credential=p_input->>'encryptedCredential',updated_at=clock_timestamp() where id=v_connection.id;
    return jsonb_build_object('refreshed',true);
  elsif p_operation='select' then
    if jsonb_typeof(p_input->'calendarIds') is distinct from 'array' or jsonb_typeof(p_input->'verifiedCalendarIds') is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
    select array_agg(distinct value) into v_ids from jsonb_array_elements_text(p_input->'calendarIds');
    if coalesce(cardinality(v_ids),0) not between 1 and 50 then raise exception 'INVALID_INPUT'; end if;
    foreach v_id in array v_ids loop
      if not exists(select 1 from jsonb_array_elements_text(p_input->'verifiedCalendarIds') c where c.value=v_id) then raise exception 'CALENDAR_ACCESS_INVALID'; end if;
    end loop;
    update fmat.calendar_connections set selected_calendar_ids=v_ids,updated_at=clock_timestamp() where id=v_connection.id;
    -- Reuse the request revision/history boundary to invalidate prior decisions.
    perform fmat.request_command('details_update',v_actor,jsonb_build_object('requestId',v_request.id,'expectedRevision',v_request.revision,'details',v_request.details));
    update fmat.requests set availability_failed=false where id=v_request.id;
    perform fmat.audit('requester_calendar_select',v_actor,v_request.id::text);
    return jsonb_build_object('saved',true,'revision',v_request.revision+1);
  end if;
  raise exception 'FORBIDDEN';
end;
$function$;

REVOKE ALL ON FUNCTION "fmat"."requester_availability_view"(fmat.requests, fmat.calendar_connections) FROM PUBLIC;
