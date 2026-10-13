SET local check_function_bodies = off;

ALTER TABLE "fmat"."booking_identities"
  DROP CONSTRAINT "booking_identities_event_id_check";

ALTER TABLE "fmat"."calendar_connections"
  ADD COLUMN "selected_calendar_ids" text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE "fmat"."requests"
  ADD COLUMN "availability_mode" text NOT NULL DEFAULT 'manual'::text;

ALTER TABLE "fmat"."requests"
  ADD COLUMN "availability_failed" boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION fmat.close_requester_calendar()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if new.status in ('booked','declined','withdrawn','expired') or new.token_revoked_at is not null or new.token_hash is distinct from old.token_hash then
    update fmat.calendar_connections set encrypted_credential=null,revoked_at=clock_timestamp(),selected_calendar_ids='{}',updated_at=clock_timestamp() where principal_kind='guest' and principal_id=new.id;
    update fmat.oauth_exchanges set expires_at=least(expires_at,clock_timestamp()),encrypted_verifier=null where actor->>'kind'='guest' and actor->>'requestId'=new.id::text and saved_at is null;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.onboarding_command (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_host_id uuid; v_email text; v_invite fmat.invitations; v_host fmat.hosts;
  v_exchange fmat.oauth_exchanges; v_connection fmat.calendar_connections; v_principal uuid; v_kind text;
  v_scopes text[]; v_conflicts text[]; v_id uuid; v_requested text;
begin
  perform fmat.onboarding_authorize(p_operation,p_actor,p_input);
  case p_operation
  when 'waitlist_join' then
    v_email:=lower(trim(p_input->>'email'));
    if v_email is null or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(coalesce(p_input->>'name',''))>200 then raise exception 'INVALID_INPUT'; end if;
    insert into fmat.waitlist(email,name) values(v_email,nullif(trim(p_input->>'name'),'')) on conflict(email) do nothing;
    return jsonb_build_object('status','pending');
  when 'invite_issue','invitation_create' then
    v_email:=lower(trim(p_input->>'email'));
    if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or coalesce(p_input->>'tokenHash','') !~ '^[0-9a-f]{64}$'
      or (p_input->>'expiresAt')::timestamptz is null or (p_input->>'expiresAt')::timestamptz<=now() or (p_input->>'expiresAt')::timestamptz>now()+interval '7 days' then raise exception 'INVALID_INPUT'; end if;
    insert into fmat.invitations(email,token_hash,expires_at,issued_by) values(v_email,p_input->>'tokenHash',(p_input->>'expiresAt')::timestamptz,p_actor->>'id') returning id into v_id;
    perform fmat.audit(p_operation,p_actor,v_id::text,jsonb_build_object('email',v_email));
    return jsonb_build_object('invitationId',v_id,'email',v_email,'expiresAt',p_input->>'expiresAt');
  when 'invite_revoke' then
    update fmat.invitations set revoked_at=now() where id=(p_input->>'invitationId')::uuid returning * into v_invite;
    if not found then raise exception 'NOT_FOUND'; end if;
    perform fmat.audit(p_operation,p_actor,v_invite.id::text);
    return jsonb_build_object('ok',true);
  when 'invite_redeem' then
    v_host_id:=fmat.require_host(p_actor,false);
    select * into v_invite from fmat.invitations where token_hash=p_input->>'tokenHash' for update;
    if not found or v_invite.revoked_at is not null or (v_invite.redeemed_by is null and v_invite.expires_at<=now()) then raise exception 'INVITATION_INVALID'; end if;
    if v_invite.email is distinct from lower(p_actor->>'email') then raise exception 'INVITATION_INVALID'; end if;
    if v_invite.redeemed_by is not null and v_invite.redeemed_by<>v_host_id then raise exception 'INVITATION_INVALID'; end if;
    if exists(select 1 from fmat.hosts where id=v_host_id and revoked_at is not null) then raise exception 'HOST_NOT_ADMITTED'; end if;
    update fmat.invitations set redeemed_by=v_host_id,redeemed_at=coalesce(redeemed_at,now()) where id=v_invite.id;
    insert into fmat.hosts(id,email,invitation_id) values(v_host_id,v_invite.email,v_invite.id) on conflict(id) do nothing;
    perform fmat.audit(p_operation,p_actor,v_host_id::text);
    return fmat.setup_view(v_host_id);
  when 'setup_read','calendar_read' then return fmat.setup_view(fmat.require_host(p_actor,false));
  when 'setup_save' then
    v_host_id:=fmat.require_host(p_actor,true);
    if coalesce(p_input->>'handle','') !~ '^[a-z][a-z0-9-]{2,39}$' or p_input->>'handle' in ('host','requests','api','operator','auth','skills')
      or length(trim(coalesce(p_input->>'displayName',''))) not between 1 and 120 then raise exception 'INVALID_INPUT'; end if;
    perform fmat.validate_rules(p_input->'rules');
    update fmat.hosts set handle=p_input->>'handle',display_name=trim(p_input->>'displayName'),rules=p_input->'rules',rules_version=rules_version+1,updated_at=now() where id=v_host_id;
    perform fmat.audit(p_operation,p_actor,v_host_id::text);
    return fmat.setup_view(v_host_id);
  when 'host_public' then
    select * into v_host from fmat.hosts where handle=p_input->>'handle';
    if not found or not fmat.host_ready(v_host) then raise exception 'NOT_FOUND'; end if;
    return jsonb_build_object('id',v_host.id,'handle',v_host.handle,'displayName',v_host.display_name,'timezone',v_host.rules->>'timezone','ready',true,'durationMinutes',(v_host.rules->>'durationMinutes')::integer);
  when 'oauth_start' then
    if coalesce(p_input->>'stateHash','') !~ '^[0-9a-f]{64}$' or coalesce(p_input->>'bindingHash','') !~ '^[0-9a-f]{64}$'
      or length(coalesce(p_input->>'encryptedVerifier',''))<20 or jsonb_typeof(p_input->'context') is distinct from 'object'
      or coalesce(p_input->'context'->>'redirectUri','') !~ '^https?://' then raise exception 'INVALID_INPUT'; end if;
    if p_actor->>'kind'='guest' and (p_input->'context'->>'requestId') is distinct from p_actor->>'requestId' then raise exception 'FORBIDDEN'; end if;
    if p_actor->>'kind'='host' and p_input->'context' ? 'requestId' then raise exception 'FORBIDDEN'; end if;
    insert into fmat.oauth_exchanges(state_hash,binding_hash,actor,context,encrypted_verifier)
      values(p_input->>'stateHash',p_input->>'bindingHash',p_actor,p_input->'context',p_input->>'encryptedVerifier') returning * into v_exchange;
    perform fmat.audit(p_operation,p_actor,v_exchange.id::text);
    return jsonb_build_object('exchangeId',v_exchange.id,'encryptedVerifier',v_exchange.encrypted_verifier,'context',v_exchange.context);
  when 'oauth_consume' then
    select * into v_exchange from fmat.oauth_exchanges where state_hash=p_input->>'stateHash' for update;
    if not found or v_exchange.binding_hash is distinct from p_input->>'bindingHash' or v_exchange.consumed_at is not null or v_exchange.expires_at<=now() then raise exception 'OAUTH_STATE_INVALID'; end if;
    if v_exchange.actor->>'kind'='host' then perform fmat.require_host(v_exchange.actor,true);
    else perform fmat.authorize_guest(v_exchange.actor,(v_exchange.actor->>'requestId')::uuid); end if;
    update fmat.oauth_exchanges set consumed_at=now() where id=v_exchange.id;
    return jsonb_build_object('actor',v_exchange.actor,'context',v_exchange.context,'encryptedVerifier',v_exchange.encrypted_verifier,'exchangeId',v_exchange.id);
  when 'credential_save' then
    select * into v_exchange from fmat.oauth_exchanges where id=(p_input->>'exchangeId')::uuid for update;
    if not found or v_exchange.consumed_at is null or v_exchange.saved_at is not null or v_exchange.expires_at<=now() then raise exception 'OAUTH_STATE_INVALID'; end if;
    v_kind:=v_exchange.actor->>'kind';
    if v_kind='host' then v_principal:=fmat.require_host(v_exchange.actor,true);
    else v_principal:=(v_exchange.actor->>'requestId')::uuid; perform fmat.authorize_guest(v_exchange.actor,v_principal); end if;
    select array_agg(value) into v_scopes from jsonb_array_elements_text(p_input->'scopes');
    if v_kind='host' and not coalesce(v_scopes @> array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],false) then raise exception 'INSUFFICIENT_SCOPES'; end if;
    if v_kind='guest' and not coalesce(v_scopes @> array['https://www.googleapis.com/auth/calendar.events.freebusy','https://www.googleapis.com/auth/calendar.calendarlist.readonly'],false) then raise exception 'INSUFFICIENT_SCOPES'; end if;
    if v_kind='guest' and v_scopes && array['https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar'] then raise exception 'INSUFFICIENT_SCOPES'; end if;
    if length(coalesce(p_input->>'encryptedCredential',''))<20 or length(coalesce(p_input->>'providerSubject','')) not between 1 and 300 then raise exception 'INVALID_INPUT'; end if;
    insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential)
      values(v_kind,v_principal,p_input->>'providerSubject',v_scopes,p_input->>'encryptedCredential')
      on conflict(principal_kind,principal_id) do update set provider_subject=excluded.provider_subject,scopes=excluded.scopes,encrypted_credential=excluded.encrypted_credential,revoked_at=null,updated_at=now()
      returning id into v_id;
    update fmat.oauth_exchanges set saved_at=now(),encrypted_verifier=null where id=v_exchange.id;
    if v_kind='host' then update fmat.hosts set conflict_calendar_ids='{}',booking_calendar_id=null,updated_at=now() where id=v_principal; end if;
    perform fmat.audit(p_operation,p_actor,v_id::text,jsonb_build_object('principalKind',v_kind));
    return jsonb_build_object('connectionId',v_id);
  when 'connection_read' then
    if (p_input ? 'hostId')=(p_input ? 'requestId') then raise exception 'INVALID_INPUT'; end if;
    v_kind:=case when p_input ? 'hostId' then 'host' else 'guest' end;
    v_principal:=coalesce(p_input->>'hostId',p_input->>'requestId')::uuid;
    if v_kind='host' and not exists(select 1 from fmat.hosts where id=v_principal and revoked_at is null) then raise exception 'HOST_NOT_ADMITTED'; end if;
    select * into v_connection from fmat.calendar_connections where principal_kind=v_kind and principal_id=v_principal and revoked_at is null;
    if not found then raise exception 'RECONNECT_REQUIRED'; end if;
    select * into v_host from fmat.hosts where id=v_principal and v_kind='host';
    return jsonb_build_object('connectionId',v_connection.id,'encryptedCredential',v_connection.encrypted_credential,'scopes',to_jsonb(v_connection.scopes),'conflictCalendarIds',to_jsonb(coalesce(v_host.conflict_calendar_ids,'{}')),'bookingCalendarId',v_host.booking_calendar_id);
  when 'token_update' then
    if length(coalesce(p_input->>'encryptedCredential',''))<20 then raise exception 'INVALID_INPUT'; end if;
    update fmat.calendar_connections set encrypted_credential=p_input->>'encryptedCredential',updated_at=now() where id=(p_input->>'connectionId')::uuid and revoked_at is null returning id into v_id;
    if not found then raise exception 'RECONNECT_REQUIRED'; end if;
    return jsonb_build_object('ok',true);
  when 'calendar_save' then
    v_host_id:=fmat.require_host(p_actor,true);
    if not exists(select 1 from fmat.calendar_connections where principal_kind='host' and principal_id=v_host_id and revoked_at is null) then raise exception 'RECONNECT_REQUIRED'; end if;
    if jsonb_typeof(p_input->'conflictCalendarIds') is distinct from 'array' or jsonb_typeof(p_input->'verifiedCalendars') is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
    select array_agg(distinct value) into v_conflicts from jsonb_array_elements_text(p_input->'conflictCalendarIds');
    if coalesce(cardinality(v_conflicts),0) not between 1 and 50 then raise exception 'INVALID_INPUT'; end if;
    foreach v_requested in array v_conflicts loop
      if not exists(select 1 from jsonb_array_elements(p_input->'verifiedCalendars') c where c->>'id'=v_requested and c->>'accessRole' in ('reader','writer','owner')) then raise exception 'CALENDAR_ACCESS_INVALID'; end if;
    end loop;
    if not exists(select 1 from jsonb_array_elements(p_input->'verifiedCalendars') c where c->>'id'=p_input->>'bookingCalendarId' and c->>'accessRole' in ('writer','owner')) then raise exception 'CALENDAR_ACCESS_INVALID'; end if;
    update fmat.hosts set conflict_calendar_ids=v_conflicts,booking_calendar_id=p_input->>'bookingCalendarId',rules_version=rules_version+1,updated_at=now() where id=v_host_id;
    perform fmat.audit(p_operation,p_actor,v_host_id::text);
    return fmat.setup_view(v_host_id);
  when 'calendar_disconnect' then
    v_host_id:=fmat.require_host(p_actor,true);
    update fmat.calendar_connections set encrypted_credential=null,revoked_at=now(),updated_at=now() where principal_kind='host' and principal_id=v_host_id;
    update fmat.hosts set conflict_calendar_ids='{}',booking_calendar_id=null,rules_version=rules_version+1,updated_at=now() where id=v_host_id;
    update fmat.oauth_exchanges set expires_at=least(expires_at,now()),encrypted_verifier=null where actor->>'kind'='host' and actor->>'id'=v_host_id::text and saved_at is null;
    perform fmat.audit(p_operation,p_actor,v_host_id::text);
    return fmat.setup_view(v_host_id);
  when 'oauth_cleanup' then
    return jsonb_build_object('cleared',fmat.cleanup_oauth());
  else raise exception 'UNKNOWN_OPERATION';
  end case;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.request_command (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_request fmat.requests; v_host fmat.hosts; v_details jsonb; v_id uuid; v_start timestamptz; v_end timestamptz; v_proposal jsonb; v_version integer;
  v_challenge fmat.contact_challenges; v_replay fmat.idempotency; v_scope text; v_hash text; v_encrypted text; v_purpose text; v_mode text; v_location text;
begin
  perform fmat.request_authorize(p_operation,p_actor,p_input);
  if p_operation='mutation_replay' then
    if jsonb_typeof(p_input->'clientInput') is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_input->'clientInput') k where k not in ('requestId','expectedRevision','start','end','mode','location','edge','durationMinutes','confirmed','proposalVersion','reason','idempotencyKey','patch','reviewedRevision')) then raise exception 'INVALID_INPUT'; end if;
    if p_input->'clientInput'->>'requestId' is distinct from p_input->>'requestId' then raise exception 'INVALID_INPUT'; end if;
    v_scope:=p_actor->>'kind'||':'||coalesce(p_actor->>'id',p_actor->>'tokenHash');
    select * into v_replay from fmat.idempotency where actor_scope=v_scope and operation=p_input->>'operation' and key=p_input->>'idempotencyKey';
    if not found or v_replay.result is null then return jsonb_build_object('found',false); end if;
    if p_input->>'operation'='details_update' then
      if v_replay.input->'clientInput' is distinct from p_input->'clientInput' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    elsif ((case when p_input->>'operation'='manual_allowance_save' then v_replay.input->'clientInput' else v_replay.input end) @> (p_input->'clientInput')) is not true then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('found',true,'result',v_replay.result);
  end if;
  if p_operation='request_create' then
    select * into v_host from fmat.hosts where handle=p_input->>'handle' for share;
    if not found or not fmat.host_ready(v_host) then raise exception 'NOT_FOUND'; end if;
    if coalesce(p_input->>'tokenHash','') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INPUT'; end if;
    v_details:=fmat.normalize_details(p_input->'details');
    insert into fmat.requests(host_id,details,token_hash,status,expires_at) values(v_host.id,v_details,p_input->>'tokenHash',case when fmat.details_complete(v_details) then 'negotiating' else 'gathering' end,fmat.request_expiry(v_details,now())) returning * into v_request;
    perform fmat.audit(p_operation,p_actor,v_request.id::text);
    return fmat.request_view(v_request.id,'{"kind":"guest"}');
  elsif p_operation='requests_list' then
    return jsonb_build_object('requests',(select coalesce(jsonb_agg(fmat.request_view(id,p_actor) order by created_at desc),'[]'::jsonb) from fmat.requests where host_id=fmat.require_host(p_actor,true)));
  elsif p_operation='request_expire' then return jsonb_build_object('expired',fmat.expire_requests()); end if;
  select * into v_request from fmat.requests where id=(p_input->>'requestId')::uuid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_operation='request_read' then return fmat.request_view(v_request.id,p_actor); end if;
  if p_operation in ('contact_recover','contact_redeem') then
    if v_request.status in ('booked','withdrawn','declined','expired') or v_request.expires_at<=now() then raise exception 'NOT_FOUND'; end if;
  else
    if v_request.status in ('booked','withdrawn','declined','expired') then raise exception 'REQUEST_CLOSED'; end if;
    if v_request.expires_at<=now() and v_request.status<>'booking' then raise exception 'REQUEST_EXPIRED'; end if;
  end if;
  select * into v_host from fmat.hosts where id=v_request.host_id;
  if p_operation='evaluation_read' then
    if not fmat.host_ready(v_host) then raise exception 'RECONNECT_REQUIRED'; end if;
    return jsonb_build_object('requestId',v_request.id,'hostId',v_request.host_id,'revision',v_request.revision,'details',v_request.details,'rules',v_host.rules,'rulesVersion',v_host.rules_version,'privateSchedulingContext',v_request.private_scheduling_context,
      'requesterAvailabilityMode',v_request.availability_mode,'requesterAvailabilityFailed',v_request.availability_failed,'requesterConnection',exists(select 1 from fmat.calendar_connections where principal_kind='guest' and principal_id=v_request.id and revoked_at is null));
  end if;
  if p_operation not in ('contact_recover','contact_redeem') then
    if (p_input->>'expectedRevision')::integer is distinct from v_request.revision then raise exception 'REVISION_CONFLICT'; end if;
    if v_request.status='booking' and p_operation<>'requester_withdraw' then raise exception 'BOOKING_PENDING'; end if;
  end if;
  case p_operation
  when 'preference_exception_save' then
    if p_input->>'confirmed' is distinct from 'true' or length(trim(coalesce(p_input->>'reason',''))) not between 1 and 2000 then raise exception 'INVALID_INPUT'; end if;
    if v_request.current_proposal_version is null or (p_input->>'proposalVersion')::integer is distinct from v_request.current_proposal_version then raise exception 'PROPOSAL_CONFLICT'; end if;
    if (p_input->>'rulesVersion')::integer is distinct from v_host.rules_version then raise exception 'STALE_EVALUATION'; end if;
    select details into strict v_proposal from fmat.proposals where request_id=v_request.id and version=v_request.current_proposal_version;
    update fmat.requests set private_scheduling_context=jsonb_set(private_scheduling_context,'{preferenceException}',jsonb_build_object('proposalVersion',current_proposal_version,'rulesVersion',v_host.rules_version,'proposalDetails',v_proposal,'hostId',p_actor->>'id','confirmedAt',now(),'reason',trim(p_input->>'reason'))) where id=v_request.id;
  when 'model_claim' then
    if v_request.model_calls>=8 then return jsonb_build_object('allowed',false); end if;
    update fmat.requests set model_calls=model_calls+1 where id=v_request.id;
    return jsonb_build_object('allowed',true);
  when 'assistant_message_save' then
    if length(trim(coalesce(p_input->>'text',''))) not between 1 and 10000 then raise exception 'INVALID_INPUT'; end if;
    insert into fmat.request_messages(request_id,role,audience,text,actor) values(v_request.id,'assistant','shared',trim(p_input->>'text'),p_actor);
  when 'private_context_save','manual_allowance_save' then
    if p_operation='private_context_save' then
      if jsonb_typeof(p_input->'physicalContext') is distinct from 'array' or jsonb_array_length(p_input->'physicalContext')>10
        or length(coalesce(p_input->>'candidatePhysicalLocation',''))>2000 then raise exception 'INVALID_INPUT'; end if;
      for v_details in select value from jsonb_array_elements(p_input->'physicalContext') loop
        if length(coalesce(v_details->>'location','')) not between 1 and 2000 or coalesce(v_details->>'at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'INVALID_INPUT'; end if;
      end loop;
      update fmat.requests set private_scheduling_context=jsonb_build_object('physicalContext',p_input->'physicalContext','candidatePhysicalLocation',p_input->>'candidatePhysicalLocation','manualTravelAllowances','[]'::jsonb) where id=v_request.id;
    else
      v_details:=p_input->'allowance';
      if p_input->>'confirmed' is distinct from 'true' or (p_input->>'rulesVersion')::integer is distinct from v_host.rules_version
        or v_details->>'hostId' is distinct from p_actor->>'id' or coalesce((v_details->>'durationMinutes')::integer,0) not between 1 and 1440
        or (v_details->'context'->>'rulesVersion')::integer is distinct from v_host.rules_version
        or coalesce(v_details->'context'->'slot'->>'start','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
        or coalesce(v_details->'context'->'slot'->>'end','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
        or jsonb_array_length(coalesce(v_request.private_scheduling_context->'manualTravelAllowances','[]'::jsonb))>=20 then raise exception 'INVALID_INPUT'; end if;
      update fmat.requests set private_scheduling_context=jsonb_set(private_scheduling_context,'{manualTravelAllowances}',coalesce(private_scheduling_context->'manualTravelAllowances','[]'::jsonb)||jsonb_build_array(v_details)) where id=v_request.id;
    end if;
    update fmat.requests set candidates='[]',private_diagnostics='[]',private_travel_checks='[]',current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,status='negotiating' where id=v_request.id;
  when 'message_add','private_note_save' then
    if length(trim(coalesce(p_input->>'text',''))) not between 1 and 10000 then raise exception 'INVALID_INPUT'; end if;
    insert into fmat.request_messages(request_id,role,audience,text,actor) values(v_request.id,case when p_actor->>'kind'='guest' then 'requester' else 'host' end,
      case when p_operation='private_note_save' then 'host' else 'shared' end,trim(p_input->>'text'),p_actor-'tokenHash');
    if p_operation='private_note_save' then update fmat.requests set private_notes=trim(p_input->>'text') where id=v_request.id; end if;
  when 'details_update','extraction_save' then
    if p_operation='extraction_save' and (p_input->>'rulesVersion')::integer is distinct from v_host.rules_version then raise exception 'STALE_EVALUATION'; end if;
    v_details:=fmat.normalize_details(p_input->'details');
    update fmat.requests set details=v_details,candidates='[]',private_diagnostics='[]',private_travel_checks='[]',current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,
      status=case when fmat.details_complete(v_details) then 'negotiating' else 'gathering' end,expires_at=fmat.request_expiry(v_details,created_at),
      contact_verified_email=case when v_details->>'requesterEmail'=details->>'requesterEmail' then contact_verified_email else null end where id=v_request.id;
    update fmat.contact_challenges set consumed_at=now() where request_id=v_request.id and consumed_at is null and email<>v_details->>'requesterEmail';
  when 'candidates_save' then
    if v_request.availability_mode='calendar' and (v_request.availability_failed or not exists(select 1 from fmat.calendar_connections where principal_kind='guest' and principal_id=v_request.id and revoked_at is null and guest_authority_key=v_request.token_hash and cardinality(selected_calendar_ids)>0)) then raise exception 'RECONNECT_REQUIRED'; end if;
    if (p_input->>'rulesVersion')::integer is distinct from v_host.rules_version or not fmat.host_ready(v_host) then raise exception 'STALE_EVALUATION'; end if;
    if jsonb_typeof(p_input->'candidates') is distinct from 'array' or jsonb_array_length(p_input->'candidates')>300 or jsonb_typeof(coalesce(p_input->'privateDiagnostics','[]'::jsonb)) is distinct from 'array' or jsonb_typeof(coalesce(p_input->'privateTravelChecks','[]'::jsonb)) is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
    for v_details in select value from jsonb_array_elements(p_input->'candidates') loop
      if coalesce(v_details->>'start','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(v_details->>'end','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
        or (v_details->>'start')::timestamptz<=now() or (v_details->>'end')::timestamptz-(v_details->>'start')::timestamptz<>make_interval(mins=>(v_request.details->>'durationMinutes')::integer)
        or not exists(select 1 from jsonb_array_elements(v_request.details->'windows') w where (w->>'start')::timestamptz<=(v_details->>'start')::timestamptz and (w->>'end')::timestamptz>=(v_details->>'end')::timestamptz) then raise exception 'INVALID_INPUT'; end if;
    end loop;
    update fmat.requests set candidates=(select coalesce(jsonb_agg(jsonb_build_object('start',c->>'start','end',c->>'end')),'[]'::jsonb) from jsonb_array_elements(p_input->'candidates') c),private_diagnostics=coalesce(p_input->'privateDiagnostics','[]'::jsonb)||case when p_input->>'unresolved'='true' then jsonb_build_array(jsonb_build_object('code','evaluation_unresolved')) else '[]'::jsonb end,private_travel_checks=coalesce(p_input->'privateTravelChecks','[]'::jsonb),evaluated_rules_version=v_host.rules_version,evaluated_at=now() where id=v_request.id;
    if v_request.current_proposal_version is not null and not exists(select 1 from fmat.proposals p,jsonb_array_elements(p_input->'candidates') c where p.request_id=v_request.id and p.version=v_request.current_proposal_version and (p.details->>'start')::timestamptz=(c->>'start')::timestamptz and (p.details->>'end')::timestamptz=(c->>'end')::timestamptz) then
      update fmat.requests set current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,status='negotiating' where id=v_request.id;
    end if;
  when 'proposal_create','proposal_revise' then
    if not fmat.details_complete(v_request.details) then raise exception 'DETAILS_REQUIRED'; end if;
    if p_operation='proposal_create' and (v_request.evaluated_rules_version is distinct from v_host.rules_version or v_request.evaluated_at is null or v_request.evaluated_at<now()-interval '5 minutes') then raise exception 'STALE_EVALUATION'; end if;
    v_start:=(p_input->>'start')::timestamptz; v_end:=(p_input->>'end')::timestamptz;
    if p_operation='proposal_create' and not exists(select 1 from jsonb_array_elements(v_request.candidates) c where (c->>'start')::timestamptz=v_start and (c->>'end')::timestamptz=v_end) then raise exception 'CANDIDATE_INVALID'; end if;
    v_mode:=coalesce(p_input->>'mode',v_request.details->>'mode'); v_location:=coalesce(p_input->>'location',v_request.details->>'location');
    if p_operation='proposal_revise' then
      v_details:=p_input->'validatedEvidence';
      if (v_details->>'rulesVersion')::integer is distinct from v_host.rules_version or (v_details->>'requestRevision')::integer is distinct from v_request.revision
        or (v_details->>'start')::timestamptz is distinct from v_start or (v_details->>'end')::timestamptz is distinct from v_end
        or v_details->>'mode' is distinct from v_mode or v_details->>'location' is distinct from v_location then raise exception 'STALE_EVALUATION'; end if;
      v_details:=fmat.normalize_details(v_request.details||jsonb_build_object('mode',v_mode,'location',v_location));
      if not fmat.details_complete(v_details) then raise exception 'DETAILS_REQUIRED'; end if;
      if v_end-v_start<>make_interval(mins=>(v_details->>'durationMinutes')::integer) or v_start<=now()
        or not exists(select 1 from jsonb_array_elements(v_details->'windows') w where (w->>'start')::timestamptz<=v_start and (w->>'end')::timestamptz>=v_end) then raise exception 'CANDIDATE_INVALID'; end if;
      update fmat.requests set details=v_details,candidates=jsonb_build_array(jsonb_build_object('start',v_start,'end',v_end)),evaluated_rules_version=v_host.rules_version,evaluated_at=now() where id=v_request.id;
    elsif v_mode is distinct from v_request.details->>'mode' or v_location is distinct from v_request.details->>'location' then raise exception 'STALE_EVALUATION'; end if;
    select coalesce(max(version),0)+1 into v_version from fmat.proposals where request_id=v_request.id;
    v_proposal:=jsonb_build_object('version',v_version,'start',v_start,'end',v_end,'timezone',v_request.details->>'timezone','mode',v_mode,'location',v_location,
      'requesterName',v_request.details->>'requesterName','requesterEmail',v_request.details->>'requesterEmail','purpose',v_request.details->>'purpose');
    insert into fmat.proposals(request_id,version,details,rules_version) values(v_request.id,v_version,v_proposal,v_host.rules_version);
    update fmat.requests set current_proposal_version=v_version,requester_agreed_version=null,host_approved_version=null,status='negotiating' where id=v_request.id;
  when 'requester_agree' then
    if v_request.current_proposal_version is null or (p_input->>'proposalVersion')::integer is distinct from v_request.current_proposal_version then raise exception 'PROPOSAL_CONFLICT'; end if;
    if not exists(select 1 from fmat.proposals where request_id=v_request.id and version=v_request.current_proposal_version and rules_version=v_host.rules_version) then raise exception 'STALE_EVALUATION'; end if;
    update fmat.requests set requester_agreed_version=current_proposal_version,status='awaiting_approval' where id=v_request.id;
  when 'requester_withdraw' then
    if v_request.status='booking' and not fmat.withdraw_allowed(v_request.id) then raise exception 'BOOKING_PENDING'; end if;
    update fmat.requests set status='withdrawn',token_revoked_at=now(),requester_agreed_version=null,host_approved_version=null where id=v_request.id;
  when 'host_decline' then update fmat.requests set status='declined',token_revoked_at=now(),host_approved_version=null where id=v_request.id;
  when 'request_calendar_disconnect' then
    update fmat.calendar_connections set encrypted_credential=null,revoked_at=now(),updated_at=now() where principal_kind='guest' and principal_id=v_request.id;
    update fmat.requests set candidates='[]',private_diagnostics='[]',private_travel_checks='[]',current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,status='negotiating' where id=v_request.id;
    update fmat.oauth_exchanges set expires_at=least(expires_at,now()),encrypted_verifier=null where actor->>'kind'='guest' and actor->>'requestId'=v_request.id::text and saved_at is null;
  when 'contact_start','contact_recover' then
    if p_operation='contact_recover' and lower(trim(coalesce(p_input->>'email',''))) is distinct from v_request.details->>'requesterEmail' then raise exception 'NOT_FOUND'; end if;
    if coalesce(v_request.details->>'requesterEmail','')='' then raise exception 'DETAILS_REQUIRED'; end if;
    v_purpose:=case when p_operation='contact_start' then 'verification' else 'recovery' end;
    v_hash:=case when p_operation='contact_start' then p_input->>'codeHash' else p_input->>'tokenHash' end;
    v_encrypted:=case when p_operation='contact_start' then p_input->>'encryptedCode' else p_input->>'encryptedToken' end;
    if coalesce(v_hash,'') !~ '^[0-9a-f]{64}$' or length(coalesce(v_encrypted,''))<20 then raise exception 'INVALID_INPUT'; end if;
    if exists(select 1 from fmat.contact_challenges where request_id=v_request.id and purpose=v_purpose and created_at>now()-interval '1 minute') then raise exception 'RATE_LIMITED'; end if;
    update fmat.contact_challenges set consumed_at=now() where request_id=v_request.id and purpose=v_purpose and consumed_at is null;
    insert into fmat.contact_challenges(request_id,email,purpose,secret_hash) values(v_request.id,v_request.details->>'requesterEmail',v_purpose,v_hash) returning id into v_id;
    insert into fmat.outbox(dedupe_key,audience,recipient,payload) values('contact:'||v_id::text,'requester',jsonb_build_object('email',v_request.details->>'requesterEmail'),
      jsonb_build_object('kind','contact_'||v_purpose,'requestId',v_request.id,'challengeId',v_id,'encryptedSecret',v_encrypted)) returning id into v_id;
    perform fmat.enqueue_job('contact_delivery','contact-delivery:'||v_id::text,jsonb_build_object('outboxId',v_id));
    if p_operation='contact_recover' then return jsonb_build_object('status','pending'); end if;
  when 'contact_confirm','contact_redeem' then
    v_purpose:=case when p_operation='contact_confirm' then 'verification' else 'recovery' end;
    v_hash:=case when p_operation='contact_confirm' then p_input->>'codeHash' else p_input->>'tokenHash' end;
    select * into v_challenge from fmat.contact_challenges where request_id=v_request.id and purpose=v_purpose and secret_hash=v_hash and consumed_at is null order by created_at desc limit 1 for update;
    if not found or v_challenge.expires_at<=now() or v_challenge.email is distinct from v_request.details->>'requesterEmail' then raise exception 'CONTACT_INVALID'; end if;
    update fmat.contact_challenges set consumed_at=now() where id=v_challenge.id;
    update fmat.requests set contact_verified_email=v_challenge.email where id=v_request.id;
    if p_operation='contact_redeem' then
      if coalesce(p_input->>'newTokenHash','') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INPUT'; end if;
      update fmat.requests set token_hash=p_input->>'newTokenHash',token_expires_at=now()+interval '30 days',token_revoked_at=null where id=v_request.id;
    end if;
  else raise exception 'UNKNOWN_OPERATION'; end case;
  update fmat.requests set revision=revision+1,updated_at=now() where id=v_request.id returning * into v_request;
  insert into fmat.request_history(request_id,revision,operation,actor,proposal_version) values(v_request.id,v_request.revision,p_operation,p_actor-'tokenHash',v_request.current_proposal_version);
  perform fmat.audit(p_operation,p_actor,v_request.id::text,jsonb_build_object('revision',v_request.revision,'proposalVersion',v_request.current_proposal_version));
  return fmat.request_view(v_request.id,case when p_actor->>'kind'='host' then p_actor else '{"kind":"guest"}'::jsonb end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_calendar_consent (
  p_operation  text,
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_actor jsonb; v_credential jsonb; v_exchange fmat.oauth_exchanges; v_connection fmat.calendar_connections;
  v_result jsonb; v_kind text; v_principal uuid; v_return text; v_scopes text[]; v_revision integer;
begin
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
  if p_operation in ('consume','save') then
    if p_operation='consume' then select * into v_exchange from fmat.oauth_exchanges where state_hash=p_input->>'stateHash';
    else select * into v_exchange from fmat.oauth_exchanges where id=(p_input->>'exchangeId')::uuid; end if;
    if not found or v_exchange.bound_credential is null then raise exception 'OAUTH_STATE_INVALID'; end if;
    v_credential:=v_exchange.bound_credential;
  else v_credential:=p_credential; end if;
  -- Lock authority before consent rows, matching request/host command order.
  v_actor:=fmat.calendar_actor(v_credential);
  v_kind:=v_actor->>'kind';v_principal:=coalesce(v_actor->>'id',v_actor->>'requestId')::uuid;
  v_return:=case when v_kind='host' then '/app' else '/booking/'||v_principal::text end;
  if p_operation='start' then
    if coalesce(p_input->>'stateHash','') !~ '^[a-f0-9]{64}$' or coalesce(p_input->>'bindingHash','') !~ '^[a-f0-9]{64}$'
      or length(coalesce(p_input->>'encryptedVerifier','')) not between 20 and 16384 then raise exception 'INVALID_INPUT'; end if;
    if (select count(*) from fmat.oauth_exchanges where actor->>'kind'=v_kind and coalesce(actor->>'id',actor->>'requestId')=v_principal::text and created_at>clock_timestamp()-interval '10 minutes')>=10 then raise exception 'CONSENT_LIMIT'; end if;
    -- A newer start or disconnect must fence an older in-flight callback.
    update fmat.oauth_exchanges set expires_at=least(expires_at,clock_timestamp()),encrypted_verifier=null
      where actor->>'kind'=v_kind and coalesce(actor->>'id',actor->>'requestId')=v_principal::text and saved_at is null;
    v_result:=fmat.onboarding_command('oauth_start',v_actor,p_input||jsonb_build_object('context',
      jsonb_build_object('redirectUri',p_input->>'redirectUri','returnPath',v_return)||case when v_kind='guest' then jsonb_build_object('requestId',v_principal) else '{}'::jsonb end));
    update fmat.oauth_exchanges set bound_credential=v_credential where id=(v_result->>'exchangeId')::uuid;
    return jsonb_build_object('started',true);
  elsif p_operation in ('consume','save') then
    select * into strict v_exchange from fmat.oauth_exchanges where id=v_exchange.id for update;
    if v_exchange.expires_at<=clock_timestamp() or v_exchange.saved_at is not null then raise exception 'OAUTH_STATE_INVALID'; end if;
    if p_operation='consume' then
      if v_exchange.binding_hash is distinct from p_input->>'bindingHash' or v_exchange.consumed_at is not null then raise exception 'OAUTH_STATE_INVALID'; end if;
      update fmat.oauth_exchanges set consumed_at=clock_timestamp() where id=v_exchange.id;
      return jsonb_build_object('exchangeId',v_exchange.id,'kind',v_kind,'principalId',v_principal,'returnPath',v_return,
        'redirectUri',v_exchange.context->>'redirectUri','encryptedVerifier',v_exchange.encrypted_verifier);
    end if;
    if v_exchange.consumed_at is null then raise exception 'OAUTH_STATE_INVALID'; end if;
    select array_agg(value) into v_scopes from jsonb_array_elements_text(p_input->'scopes');
    if v_kind='guest' and exists(select 1 from unnest(v_scopes) s where s not in ('openid','email','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/calendar.events.freebusy','https://www.googleapis.com/auth/calendar.calendarlist.readonly')) then raise exception 'INSUFFICIENT_SCOPES'; end if;
    v_result:=fmat.onboarding_request_dispatch('credential_save','{"kind":"worker","id":"calendar-consent"}',p_input);
    update fmat.calendar_connections set generation=gen_random_uuid(),selected_calendar_ids='{}',guest_authority_key=case when v_kind='guest' then v_credential->>'tokenHash' else null end where id=(v_result->>'connectionId')::uuid;
    if v_kind='guest' then update fmat.requests set availability_mode='calendar',availability_failed=false where id=v_principal; end if;
    return jsonb_build_object('connected',true);
  elsif p_operation='disconnect' then
    if v_kind='host' then perform fmat.onboarding_command('calendar_disconnect',v_actor,'{}');
    else
      select revision into v_revision from fmat.requests where id=v_principal;
      perform fmat.request_command('request_calendar_disconnect',v_actor,jsonb_build_object('requestId',v_principal,'expectedRevision',v_revision));
    end if;
  elsif p_operation<>'status' then raise exception 'FORBIDDEN'; end if;
  select * into v_connection from fmat.calendar_connections where principal_kind=v_kind and principal_id=v_principal and revoked_at is null;
  return jsonb_build_object('connected',coalesce(v_connection.id is not null and (v_kind='host' or v_connection.guest_authority_key=v_credential->>'tokenHash'),false),
    'kind',v_kind,'selected',case when v_kind='host' then exists(select 1 from fmat.hosts where id=v_principal and cardinality(conflict_calendar_ids)>0 and booking_calendar_id is not null) else false end);
end;
$function$;

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
    return jsonb_build_object('revision',v_request.revision,'mode',v_request.availability_mode,'failed',v_request.availability_failed,'connected',v_connection.id is not null,'selectedCalendarIds',to_jsonb(coalesce(v_connection.selected_calendar_ids,'{}')),'timezone',coalesce(v_request.details->>'timezone',''),'windows',coalesce(v_request.details->'windows','[]'));
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

REVOKE ALL ON FUNCTION "public"."fmat_requester_availability"(text, jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."booking_identities"
  ADD CONSTRAINT "booking_identities_event_id_check" CHECK ((((length(event_id) >= 5) AND (length(event_id) <= 1024)) AND (event_id ~ '^[0-9a-v]+$'::text)));

ALTER TABLE "fmat"."requests"
  ADD CONSTRAINT "requests_availability_mode_check" CHECK ((availability_mode = ANY (ARRAY['manual'::text, 'calendar'::text])));

CREATE TRIGGER close_requester_calendar
  AFTER UPDATE OF status, token_hash, token_revoked_at ON fmat.requests
  FOR EACH ROW
  EXECUTE FUNCTION fmat.close_requester_calendar();

REVOKE ALL ON FUNCTION "fmat"."close_requester_calendar"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_requester_availability"(text, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_requester_availability"(text, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_requester_availability"(text, jsonb, jsonb) TO "service_role";
