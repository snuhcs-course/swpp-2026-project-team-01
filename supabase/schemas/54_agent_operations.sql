-- Only verified access claims from the internal agent adapter may call this
-- service-only boundary. Scope/authority remain transactional, not JWT-only.
create or replace function public.fmat_agent_operation(
 p_grant_id uuid,p_client_id uuid,p_resource text,p_actor_kind text,p_actor_id uuid,
 p_scope text,p_token_expires_at bigint,p_operation text,p_request_id uuid,
 p_input jsonb,p_idempotency_key uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_grant fmat.oauth_grants; v_authority fmat.oauth_grants; v_request fmat.requests; v_actor jsonb; v_input jsonb; v_result jsonb; v_scope text; v_write boolean; v_conversation fmat.conversation_scopes; v_connection fmat.calendar_connections; v_context text; v_reconnect boolean:=false;
begin
 if p_operation is null or p_operation not in ('setup_read','setup_analysis_read','setup_draft','request_read','private_note_save','details_propose','decision_review','requests_list','conversation_resolve','availability_read','availability_propose','scheduling_read','booking_status','connection_review','setup_review') then raise exception 'FORBIDDEN';end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 v_write:=p_operation in ('setup_draft','private_note_save','details_propose','availability_propose');
 if (v_write and p_idempotency_key is null) or (not v_write and (p_idempotency_key is not null or (p_operation not in ('requests_list','conversation_resolve') and p_input<>'{}'::jsonb))) then raise exception 'INVALID_INPUT';end if;
 if p_input ? 'idempotencyKey' or p_input ? 'requestId' or p_input ? 'actor' then raise exception 'INVALID_INPUT';end if;
 if p_token_expires_at is null or p_token_expires_at<=extract(epoch from clock_timestamp()) then return '{"error":"invalid_token"}';end if;
 select * into v_grant from fmat.oauth_grants where id=p_grant_id;
 if not found or v_grant.client_id is distinct from p_client_id or v_grant.resource is distinct from p_resource
  or v_grant.actor_kind is distinct from p_actor_kind or v_grant.actor_id is distinct from p_actor_id then return '{"error":"invalid_grant"}';end if;
 -- Lock intake before resolving its binding or taking any request lock.
 v_grant:=fmat.oauth_bound_grant(v_grant);
 if v_grant.id is null or v_grant.actor_kind not in ('host','guest') then return '{"error":"invalid_grant"}';end if;
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
 -- Evaluator requires UPDATE on host: avoid upgrading a grant's SHARE lock.
 if p_operation='scheduling_read' then perform 1 from fmat.hosts where id=v_grant.host_id for update;end if;
 v_authority:=fmat.oauth_lock_grant(p_grant_id);
 if v_authority.id is null or not(string_to_array(p_scope,' ') <@ string_to_array(v_authority.scope,' ')) then return '{"error":"invalid_grant"}';end if;
 v_grant:=fmat.oauth_bound_grant(v_authority);
 if v_grant.id is null then return '{"error":"invalid_grant"}';end if;
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
  when 'booking_status' then v_result:=fmat.booking_receipt_view(p_request_id,v_grant.actor_kind);
  when 'setup_review' then
   v_result:=jsonb_build_object('requiresBrowser',true,'path','/app','actions',jsonb_build_array('review_settings','manage_calendar','link_imessage'));
  when 'connection_review' then
   v_result:=jsonb_build_object('requiresBrowser',true,'requestId',p_request_id,'revision',v_request.revision,'action','manage_connections',
    'path',case when v_grant.actor_kind='host' then '/app?request='||p_request_id::text||'&audience=host_private' else '/booking/'||p_request_id::text end);
  when 'scheduling_read' then
   begin
    v_context:=fmat.evaluate_availability('current_context',jsonb_build_object('kind','agent','grantId',v_grant.id,'tokenExpiresAt',p_token_expires_at),
      jsonb_build_object('requestId',p_request_id,'revision',v_request.revision),null)->>'travelBasis';
   exception when raise_exception then
    if sqlerrm='RECONNECT_REQUIRED' then v_reconnect:=true;else raise;end if;
   end;
   v_result:=fmat.scheduling_view(p_request_id,v_context,v_reconnect);
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
   v_result:=jsonb_build_object('requiresHumanConfirmation',true,'requestId',p_request_id,'revision',v_request.revision,'proposalVersion',v_request.current_proposal_version,
    'path',case when v_grant.actor_kind='host' then '/app?request='||p_request_id::text||'&audience=host_private' else '/booking/'||p_request_id::text end);
  end case;
  if p_token_expires_at<=extract(epoch from clock_timestamp()) or v_grant.expires_at<=clock_timestamp() or not fmat.oauth_authority_current(v_authority) then
   raise exception using errcode='PT401',message='AGENT_AUTHORITY_EXPIRED';
  end if;
 exception when sqlstate 'PT401' then
  -- This check is outside the rolled-back domain subtransaction so observed
  -- underlying authority loss remains permanently revoked.
  perform fmat.oauth_lock_grant(p_grant_id);
  return '{"error":"invalid_token"}';
 end;
 return v_result;
end$$;
revoke all on function public.fmat_agent_operation(uuid,uuid,text,text,uuid,text,bigint,text,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.fmat_agent_operation(uuid,uuid,text,text,uuid,text,bigint,text,uuid,jsonb,uuid) to service_role;
