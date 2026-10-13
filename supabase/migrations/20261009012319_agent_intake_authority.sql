SET local check_function_bodies = off;

ALTER TABLE "fmat"."oauth_grants"
  DROP CONSTRAINT "oauth_grants_actor_kind_check";

ALTER TABLE "fmat"."oauth_grants"
  DROP CONSTRAINT "oauth_grants_check1";

CREATE OR REPLACE FUNCTION fmat.oauth_authority_current (
  p_grant fmat.oauth_grants
)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_request fmat.requests; v_user auth.users; v_session auth.sessions; v_host fmat.hosts; v_now timestamptz;
 v_intake fmat.oauth_intakes; v_bound fmat.oauth_grants; v_auth fmat.oauth_authorizations;
begin
  if p_grant.actor_kind='intake' then
    -- Serialize the mutable pending -> bound lookup before any request/host
    -- lock. Creation and same-browser revocation use this same order.
    select * into v_intake from fmat.oauth_intakes where id=p_grant.actor_id for update;
    if not found or v_intake.grant_id is distinct from p_grant.id or v_intake.host_id is distinct from p_grant.host_id
      or v_intake.authorization_id is distinct from p_grant.authorization_id or v_intake.revoked_at is not null
      then return false;end if;
    select * into v_auth from fmat.oauth_authorizations where id=v_intake.authorization_id;
    if not found or v_auth.decision is distinct from 'grant' or v_auth.client_id is distinct from p_grant.client_id
      or v_auth.browser_hash is distinct from v_intake.browser_hash then return false;end if;
    if v_intake.request_id is null then
      if not fmat.oauth_intake_host_current(v_intake.host_id) then return false;end if;
      return coalesce(v_intake.create_expires_at>clock_timestamp(),false);
    end if;
    v_bound:=p_grant;v_bound.actor_kind:='guest';v_bound.actor_id:=v_intake.request_id;
    v_bound.request_id:=v_intake.request_id;v_bound.token_hash:=v_intake.token_hash;
    return fmat.oauth_authority_current(v_bound);
  end if;
  if p_grant.actor_kind='guest' then
    select * into v_request from fmat.requests where id=p_grant.request_id for update;
    if not found or v_request.host_id is distinct from p_grant.host_id then return false;end if;
  end if;
  select * into v_host from fmat.hosts where id=p_grant.host_id for share;
  if not found or v_host.revoked_at is not null then return false;end if;
  if p_grant.actor_kind='host' then
    select * into v_user from auth.users where id=p_grant.actor_id for share;
    select * into v_session from auth.sessions where id=p_grant.session_id for share;
    v_now:=clock_timestamp();
    return coalesce(p_grant.actor_id=p_grant.host_id and v_user.id=p_grant.actor_id and v_session.user_id=v_user.id
      and v_user.deleted_at is null and v_user.email_confirmed_at is not null and length(v_user.email)>0
      and (v_user.banned_until is null or v_user.banned_until<=v_now)
      and (v_session.not_after is null or v_session.not_after>v_now),false);
  elsif p_grant.actor_kind='guest' then
    v_now:=clock_timestamp();
    return coalesce(p_grant.actor_id=v_request.id and p_grant.token_hash=v_request.token_hash
      and v_request.token_revoked_at is null and v_request.token_expires_at>v_now and v_request.expires_at>v_now
      and v_request.status not in ('booked','declined','withdrawn','expired'),false);
  end if;
  return false;
end$function$;

CREATE OR REPLACE FUNCTION fmat.oauth_intake_host_current (
  p_host_id uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_user auth.users; v_host fmat.hosts; v_connection fmat.calendar_connections;
begin
  -- Same public-readiness order as public intake: Auth user, host, connection.
  select * into v_user from auth.users where id=p_host_id for share;
  select * into v_host from fmat.hosts where id=p_host_id for share;
  select * into v_connection from fmat.calendar_connections where principal_kind='host' and principal_id=p_host_id and revoked_at is null for share;
  return coalesce(v_user.id is not null and v_host.id is not null and v_connection.id is not null
    and v_user.deleted_at is null and v_user.email_confirmed_at is not null
    and (v_user.banned_until is null or v_user.banned_until<=clock_timestamp()) and fmat.host_ready(v_host),false);
end$function$;

CREATE OR REPLACE FUNCTION fmat.oauth_scope_valid (
  p_scope text
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select coalesce(length(p_scope) between 1 and 100
    and p_scope=(select string_agg(s,' ' order by s collate "C") from (select distinct unnest(string_to_array(p_scope,' ')) s) t)
    and (string_to_array(p_scope,' ') <@ array['host:read','host:write','host:decide']
      or string_to_array(p_scope,' ') <@ array['request:intake','request:read','request:write','request:decide']),false);
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
declare v_grant fmat.oauth_grants; v_request fmat.requests; v_actor jsonb; v_input jsonb; v_result jsonb; v_scope text; v_write boolean; v_conversation fmat.conversation_scopes; v_connection fmat.calendar_connections; v_context text; v_reconnect boolean:=false;
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
 -- Intake remains default-denied until the bound-request adapter is enabled.
 if v_grant.actor_kind not in ('host','guest') then return '{"error":"invalid_grant"}';end if;
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

CREATE OR REPLACE FUNCTION public.fmat_oauth_authorization_start (
  p_input jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_client fmat.oauth_clients; v_auth fmat.oauth_authorizations; v_now timestamptz; v_intake boolean; v_host uuid;
begin
  if not fmat.oauth_take_budget('authorization') then return '{"error":"rate_limited"}';end if;
  if jsonb_typeof(p_input) is distinct from 'object' then return '{"error":"invalid_request"}';end if;
  if (select count(*) from jsonb_object_keys(p_input)) not in (8,9)
    or not p_input ?& array['clientId','resource','redirectUri','scope','codeChallenge','codeChallengeMethod','state','browserHash']
    or exists(select 1 from jsonb_each(p_input) where jsonb_typeof(value)<>'string')
    or p_input->>'clientId' !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
    then return '{"error":"invalid_request"}';end if;
  if not fmat.oauth_scope_valid(p_input->>'scope') then return '{"error":"invalid_scope"}';end if;
  v_intake:='request:intake'=any(string_to_array(p_input->>'scope',' '));
  if (p_input ? 'handle')<>v_intake or (select count(*) from jsonb_object_keys(p_input))<>(case when v_intake then 9 else 8 end)
    then return '{"error":"invalid_request"}';end if;
  if v_intake then
    if not fmat.valid_public_handle(p_input->>'handle') then return '{"error":"invalid_request"}';end if;
    -- Registry budget -> intake budgets -> public host authority -> client ->
    -- authorization. No path may acquire these budgets after a client lock.
    select id into v_host from fmat.hosts where handle=p_input->>'handle';
    if v_host is null then return '{"error":"invalid_request"}';end if;
    if not fmat.oauth_intake_take_budget(v_host) then return '{"error":"rate_limited"}';end if;
    if not fmat.oauth_intake_host_current(v_host)
      or not exists(select 1 from fmat.hosts where id=v_host and handle=p_input->>'handle')
      then return '{"error":"invalid_request"}';end if;
  end if;
  -- Ordinary registry lock order remains budget, client, authorization.
  select * into v_client from fmat.oauth_clients where id=(p_input->>'clientId')::uuid for update;
  if not found or v_client.disabled_at is not null then return '{"error":"invalid_client"}';end if;
  v_now:=clock_timestamp();
  if v_client.authorization_window_at is null or v_client.authorization_window_at+interval '1 minute'<=v_now then
    update fmat.oauth_clients set authorization_window_at=v_now,authorization_count=1 where id=v_client.id;
  elsif v_client.authorization_count>=20 then return '{"error":"rate_limited"}';
  else update fmat.oauth_clients set authorization_count=authorization_count+1 where id=v_client.id;end if;
  if p_input->>'resource'<>v_client.resource then return '{"error":"invalid_target"}';end if;
  if not (p_input->>'redirectUri'=any(v_client.redirect_uris)) then return '{"error":"invalid_request"}';end if;
  if not fmat.oauth_scope_valid(p_input->>'scope') then return '{"error":"invalid_scope"}';end if;
  if p_input->>'codeChallengeMethod'<>'S256' or p_input->>'codeChallenge' !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
    or length(p_input->>'state') not between 1 and 1024 or p_input->>'state' ~ '[[:cntrl:]]'
    or p_input->>'browserHash' !~ '^[a-f0-9]{64}$'
    then return '{"error":"invalid_request"}';end if;
  insert into fmat.oauth_authorizations(client_id,resource,redirect_uri,scope,code_challenge,state,browser_hash,created_at,expires_at)
    values(v_client.id,v_client.resource,p_input->>'redirectUri',p_input->>'scope',p_input->>'codeChallenge',
      p_input->>'state',p_input->>'browserHash',v_now,v_now+interval '10 minutes') returning * into v_auth;
  if v_intake then
    -- Readiness and time can change while waiting on a client or budget lock.
    if not fmat.oauth_intake_host_current(v_host) then return '{"error":"invalid_request"}';end if;
    insert into fmat.oauth_intakes(authorization_id,host_id,browser_hash)
      values(v_auth.id,v_host,p_input->>'browserHash');
  end if;
  return jsonb_build_object('authorizationId',v_auth.id,'expiresAt',v_auth.expires_at);
end$function$;

CREATE OR REPLACE FUNCTION public.fmat_oauth_consent (
  p_id           uuid,
  p_browser_hash text,
  p_credential   jsonb,
  p_decision     text,
  p_code_hash    text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_auth fmat.oauth_authorizations; v_client fmat.oauth_clients; v_grant fmat.oauth_grants; v_old fmat.oauth_grants; v_code fmat.oauth_codes; v_now timestamptz;
begin
  if p_decision is null or p_decision not in ('grant','deny') then return '{"error":"invalid_request"}';end if;
  select * into v_auth from fmat.oauth_authorizations where id=p_id;
  if not found or v_auth.browser_hash is distinct from p_browser_hash then return '{"error":"invalid_request"}';end if;
  if 'request:intake'=any(string_to_array(v_auth.scope,' ')) then return '{"error":"invalid_scope"}';end if;
  if p_decision='grant' then
    if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' then return '{"error":"invalid_request"}';end if;
    v_grant:=fmat.oauth_browser_authority(p_credential);
    if v_grant.actor_id is null then return '{"error":"invalid_grant"}';end if;
    if (v_grant.actor_kind='host')<>(v_auth.scope like 'host:%') then return '{"error":"invalid_scope"}';end if;
  end if;
  select * into v_client from fmat.oauth_clients where id=v_auth.client_id for share;
  select * into v_auth from fmat.oauth_authorizations where id=p_id for update;
  v_now:=clock_timestamp();
  if not found or v_auth.browser_hash is distinct from p_browser_hash or v_auth.expires_at<=v_now
    or v_client.id is null or v_client.disabled_at is not null or v_client.resource<>v_auth.resource then return '{"error":"invalid_request"}';end if;
  if p_decision='grant' then
    -- Authority may have expired while waiting for the authorization lock.
    if not fmat.oauth_authority_current(v_grant) or v_grant.expires_at<=clock_timestamp()
      or (v_grant.actor_kind='host' and (p_credential->>'expiresAt')::timestamptz<=clock_timestamp()) then return '{"error":"invalid_grant"}';end if;
  end if;
  if v_auth.decision is not null then
    if v_auth.decision<>p_decision then return '{"error":"invalid_request"}';end if;
    if p_decision='grant' then
      select * into v_old from fmat.oauth_grants where authorization_id=p_id;
      select * into v_code from fmat.oauth_codes where grant_id=v_old.id;
      if v_old.actor_kind is distinct from v_grant.actor_kind or v_old.actor_id is distinct from v_grant.actor_id
        or v_old.session_id is distinct from v_grant.session_id or v_old.token_hash is distinct from v_grant.token_hash
        or v_code.token_hash is distinct from p_code_hash or v_old.revoked_at is not null or v_old.expires_at<=clock_timestamp()
        then return '{"error":"invalid_grant"}';end if;
    end if;
    return jsonb_build_object('decision',v_auth.decision,'redirectUri',v_auth.redirect_uri,'state',v_auth.state,'codeExpiresAt',v_code.expires_at);
  end if;
  if p_decision='grant' then
    v_grant.id:=gen_random_uuid();v_grant.authorization_id:=p_id;v_grant.client_id:=v_auth.client_id;
    v_grant.resource:=v_auth.resource;v_grant.scope:=v_auth.scope;
    insert into fmat.oauth_grants select v_grant.*;
    insert into fmat.oauth_codes(token_hash,grant_id,redirect_uri,code_challenge,created_at,expires_at)
      values(p_code_hash,v_grant.id,v_auth.redirect_uri,v_auth.code_challenge,v_now,least(v_now+interval '1 minute',v_grant.expires_at)) returning * into v_code;
  end if;
  update fmat.oauth_authorizations set decision=p_decision,decided_at=v_now where id=p_id;
  return jsonb_build_object('decision',p_decision,'redirectUri',v_auth.redirect_uri,'state',v_auth.state,'codeExpiresAt',v_code.expires_at);
end$function$;

CREATE OR REPLACE FUNCTION public.fmat_oauth_intake_consent (
  p_id           uuid,
  p_browser_hash text,
  p_decision     text,
  p_code_hash    text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_intake fmat.oauth_intakes; v_auth fmat.oauth_authorizations; v_client fmat.oauth_clients;
 v_grant fmat.oauth_grants; v_code fmat.oauth_codes; v_now timestamptz;
begin
  if p_decision is null or p_decision not in ('grant','deny') then return '{"error":"invalid_request"}';end if;
  if p_decision='grant' and (p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$') then return '{"error":"invalid_request"}';end if;
  select * into v_intake from fmat.oauth_intakes where authorization_id=p_id for update;
  if not found or v_intake.browser_hash is distinct from p_browser_hash or v_intake.revoked_at is not null then return '{"error":"invalid_request"}';end if;
  if p_decision='grant' then
    if v_intake.grant_id is not null then
      v_grant:=fmat.oauth_lock_grant(v_intake.grant_id);
      if v_grant.id is null then return '{"error":"invalid_grant"}';end if;
    elsif not fmat.oauth_intake_host_current(v_intake.host_id) then return '{"error":"invalid_grant"}';end if;
  end if;
  select * into v_auth from fmat.oauth_authorizations where id=p_id;
  select * into v_client from fmat.oauth_clients where id=v_auth.client_id for share;
  select * into v_auth from fmat.oauth_authorizations where id=p_id for update;
  v_now:=clock_timestamp();
  if not found or v_auth.browser_hash is distinct from p_browser_hash or v_auth.expires_at<=v_now
    or v_client.id is null or v_client.disabled_at is not null or v_client.resource<>v_auth.resource
    or not fmat.oauth_scope_valid(v_auth.scope) or not ('request:intake'=any(string_to_array(v_auth.scope,' ')))
    then return '{"error":"invalid_request"}';end if;
  if v_auth.decision is not null then
    if v_auth.decision<>p_decision then return '{"error":"invalid_request"}';end if;
    if p_decision='grant' then
      select * into v_code from fmat.oauth_codes where grant_id=v_grant.id;
      if v_code.token_hash is distinct from p_code_hash or v_code.consumed_at is not null or v_code.expires_at<=clock_timestamp()
        or not fmat.oauth_authority_current(v_grant) or v_grant.expires_at<=clock_timestamp()
        then return '{"error":"invalid_grant"}';end if;
    end if;
    return jsonb_build_object('decision',v_auth.decision,'redirectUri',v_auth.redirect_uri,'state',v_auth.state,'codeExpiresAt',v_code.expires_at);
  end if;
  if p_decision='grant' then
    if not fmat.oauth_intake_host_current(v_intake.host_id) then return '{"error":"invalid_grant"}';end if;
    v_now:=clock_timestamp();
    insert into fmat.oauth_grants(authorization_id,client_id,resource,scope,actor_kind,actor_id,host_id,created_at,expires_at)
      values(p_id,v_client.id,v_auth.resource,v_auth.scope,'intake',v_intake.id,v_intake.host_id,v_now,v_now+interval '30 days') returning * into v_grant;
    update fmat.oauth_intakes set grant_id=v_grant.id,granted_at=v_now,create_expires_at=v_now+interval '15 minutes' where id=v_intake.id;
    insert into fmat.oauth_codes(token_hash,grant_id,redirect_uri,code_challenge,created_at,expires_at)
      values(p_code_hash,v_grant.id,v_auth.redirect_uri,v_auth.code_challenge,v_now,v_now+interval '1 minute') returning * into v_code;
  end if;
  update fmat.oauth_authorizations set decision=p_decision,decided_at=v_now where id=p_id;
  return jsonb_build_object('decision',p_decision,'redirectUri',v_auth.redirect_uri,'state',v_auth.state,'codeExpiresAt',v_code.expires_at);
end$function$;

REVOKE ALL ON FUNCTION "public"."fmat_oauth_intake_consent"(uuid, text, text, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fmat_oauth_intake_read (
  p_id           uuid,
  p_browser_hash text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_intake fmat.oauth_intakes; v_grant fmat.oauth_grants; v_host fmat.hosts; v_auth jsonb;
begin
  select * into v_intake from fmat.oauth_intakes where authorization_id=p_id for update;
  if not found or v_intake.browser_hash is distinct from p_browser_hash or v_intake.revoked_at is not null then return '{"error":"invalid_request"}';end if;
  if v_intake.grant_id is null then
    if not fmat.oauth_intake_host_current(v_intake.host_id) then return '{"error":"invalid_grant"}';end if;
  else
    v_grant:=fmat.oauth_lock_grant(v_intake.grant_id);
    if v_grant.id is null then return '{"error":"invalid_grant"}';end if;
  end if;
  v_auth:=public.fmat_oauth_authorization_read(p_id,p_browser_hash);
  if v_auth ? 'error' then return v_auth;end if;
  select * into v_host from fmat.hosts where id=v_intake.host_id;
  if v_intake.grant_id is null then
    if not fmat.oauth_intake_host_current(v_intake.host_id) then return '{"error":"invalid_grant"}';end if;
  elsif not fmat.oauth_authority_current(v_grant) or v_grant.expires_at<=clock_timestamp() then return '{"error":"invalid_grant"}';end if;
  return v_auth||jsonb_build_object('intake',jsonb_build_object('state',case when v_intake.request_id is null then 'pending' else 'bound' end,
    'profile',jsonb_build_object('handle',v_host.handle,'displayName',v_host.display_name,'timezone',v_host.rules->>'timezone','durationMinutes',v_host.rules->'durationMinutes')));
end$function$;

REVOKE ALL ON FUNCTION "public"."fmat_oauth_intake_read"(uuid, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fmat_oauth_intake_revoke (
  p_id           uuid,
  p_browser_hash text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_intake fmat.oauth_intakes;
begin
  select * into v_intake from fmat.oauth_intakes where authorization_id=p_id for update;
  if not found or v_intake.browser_hash is distinct from p_browser_hash then return '{"error":"invalid_grant"}';end if;
  update fmat.oauth_intakes set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=v_intake.id;
  if v_intake.grant_id is not null then
    update fmat.oauth_grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=v_intake.grant_id;
  end if;
  return '{"revoked":true}';
end$function$;

REVOKE ALL ON FUNCTION "public"."fmat_oauth_intake_revoke"(uuid, text) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."oauth_grants"
  ADD CONSTRAINT "oauth_grants_actor_kind_check" CHECK ((actor_kind = ANY (ARRAY['host'::text, 'guest'::text, 'intake'::text])));

ALTER TABLE "fmat"."oauth_grants"
  ADD CONSTRAINT "oauth_grants_check1" CHECK ((((actor_kind = 'host'::text) AND (actor_id = host_id) AND (session_id IS
    NOT NULL) AND (request_id IS NULL) AND (token_hash IS NULL) AND (scope ~~ 'host:%'::text)) OR ((actor_kind = 'guest'::text) AND (actor_id = request_id) AND (request_id IS
    NOT NULL) AND (session_id IS NULL) AND (token_hash IS
    NOT NULL) AND (token_hash ~ '^[a-f0-9]{64}$'::text) AND (scope ~~ 'request:%'::text) AND (NOT ('request:intake'::text = ANY (string_to_array(scope, ' '::text))))) OR
    ((actor_kind = 'intake'::text) AND (session_id IS NULL) AND (request_id IS NULL) AND (token_hash IS NULL) AND (scope ~~ 'request:%'::text))));

REVOKE ALL ON FUNCTION "fmat"."oauth_intake_host_current"(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_oauth_intake_consent"(uuid, text, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_oauth_intake_consent"(uuid, text, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_oauth_intake_consent"(uuid, text, text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fmat_oauth_intake_read"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_oauth_intake_read"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_oauth_intake_read"(uuid, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fmat_oauth_intake_revoke"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_oauth_intake_revoke"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_oauth_intake_revoke"(uuid, text) TO "service_role";
