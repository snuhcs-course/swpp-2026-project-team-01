SET local check_function_bodies = off;

ALTER TABLE "fmat"."requests"
  ADD COLUMN "availability_check_id" uuid;

ALTER TABLE "fmat"."requests"
  ADD COLUMN "availability_check_started_at" timestamp WITH time zone;

ALTER TABLE "fmat"."requests"
  ADD COLUMN "host_availability_failed" boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION fmat.prepare_booking (
  p_request     fmat.requests,
  p_approval_id uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_host fmat.hosts; v_proposal fmat.proposals; v_connection fmat.calendar_connections;
  v_id uuid:=gen_random_uuid(); v_event_id text; v_payload jsonb;
begin
  select * into v_connection from fmat.calendar_connections where principal_kind='host' and principal_id=p_request.host_id and revoked_at is null for share;
  if not found then raise exception 'RECONNECT_REQUIRED'; end if;
  select * into strict v_host from fmat.hosts where id=p_request.host_id for share;
  if not fmat.host_ready(v_host) or p_request.host_availability_failed or (p_request.availability_mode='calendar' and p_request.availability_failed) then raise exception 'RECONNECT_REQUIRED'; end if;
  select * into strict v_proposal from fmat.proposals where request_id=p_request.id and version=p_request.current_proposal_version;
  if v_proposal.rules_version<>v_host.rules_version then raise exception 'FEASIBILITY_STALE'; end if;
  if p_request.contact_verified_email is distinct from lower(v_proposal.details->>'requesterEmail') then raise exception 'CONTACT_NOT_VERIFIED'; end if;
  insert into fmat.booking_identities(request_id,event_id) values(p_request.id,'fmat'||replace(gen_random_uuid()::text,'-','')) on conflict(request_id) do nothing;
  select event_id into strict v_event_id from fmat.booking_identities where request_id=p_request.id;
  v_payload:=jsonb_build_object('id',v_event_id,'summary','Meeting: '||left(v_proposal.details->>'purpose',100),
    'description','Requested by '||(v_proposal.details->>'requesterName')||E'\n'||(v_proposal.details->>'purpose'),
    'location',v_proposal.details->>'location',
    'start',jsonb_build_object('dateTime',v_proposal.details->>'start','timeZone',v_proposal.details->>'timezone'),
    'end',jsonb_build_object('dateTime',v_proposal.details->>'end','timeZone',v_proposal.details->>'timezone'),
    'attendees',(select jsonb_agg(jsonb_build_object('email',e)) from (select distinct lower(v_proposal.details->>'requesterEmail') e union select lower(v_host.email)) attendees),
    'extendedProperties',jsonb_build_object('private',jsonb_build_object('fmatRequestId',p_request.id::text,'fmatAttemptId',v_id::text,'fmatProposalVersion',p_request.current_proposal_version::text)));
  insert into fmat.booking_attempts(id,request_id,host_id,proposal_version,approval_id,expected_revision,rules_version,connection_id,connection_provider_subject,calendar_id,event_id,payload,payload_fingerprint,starts_at,ends_at)
    values(v_id,p_request.id,p_request.host_id,p_request.current_proposal_version,p_approval_id,p_request.revision,v_host.rules_version,v_connection.id,v_connection.provider_subject,v_host.booking_calendar_id,v_event_id,v_payload,
      encode(sha256(convert_to(v_payload::text,'UTF8')),'hex'),(v_proposal.details->>'start')::timestamptz,(v_proposal.details->>'end')::timestamptz);
  perform fmat.enqueue_job('booking','booking:'||v_id::text,jsonb_build_object('requestId',p_request.id,'attemptId',v_id));
  return v_id;
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
    if v_request.host_availability_failed then raise exception 'RECONNECT_REQUIRED'; end if;
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
    if v_request.host_availability_failed or (v_request.availability_mode='calendar' and v_request.availability_failed) then raise exception 'RECONNECT_REQUIRED'; end if;
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

CREATE OR REPLACE FUNCTION public.fmat_availability_evaluation (
  p_operation  text,
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_actor jsonb; v_request fmat.requests; v_host fmat.hosts;
  v_host_connection fmat.calendar_connections; v_guest_connection fmat.calendar_connections; v_connection fmat.calendar_connections;
  v_basis text; v_bookings jsonb; v_check uuid;
begin
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
  -- Request -> host -> current account/session -> connections, like consent.
  select * into v_request from fmat.requests where id=(p_input->>'requestId')::uuid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_actor:=fmat.calendar_actor(p_credential);
  perform fmat.require_request(v_actor,v_request.id);
  select * into strict v_host from fmat.hosts where id=v_request.host_id for update;
  perform 1 from auth.users where id=v_host.id for share;
  if not exists(select 1 from auth.users where id=v_host.id and deleted_at is null and email_confirmed_at is not null and (banned_until is null or banned_until<=clock_timestamp())) then raise exception 'NOT_FOUND'; end if;
  if v_request.status in ('booked','declined','withdrawn','expired','booking') or v_request.expires_at<=clock_timestamp() then raise exception 'NOT_FOUND'; end if;
  if (p_input->>'revision')::integer is distinct from v_request.revision then raise exception 'REVISION_CONFLICT'; end if;
  if not fmat.host_ready(v_host) then raise exception 'RECONNECT_REQUIRED'; end if;
  select * into v_host_connection from fmat.calendar_connections where principal_kind='host' and principal_id=v_host.id and revoked_at is null for update;
  if v_host_connection.id is null then raise exception 'RECONNECT_REQUIRED'; end if;
  if v_request.availability_mode='calendar' then
    select * into v_guest_connection from fmat.calendar_connections where principal_kind='guest' and principal_id=v_request.id and revoked_at is null and guest_authority_key=v_request.token_hash for update;
    if v_guest_connection.id is null or cardinality(v_guest_connection.selected_calendar_ids)=0 then raise exception 'RECONNECT_REQUIRED'; end if;
  end if;
  -- Wall-clock expiry must be checked again after any connection lock wait.
  if v_request.expires_at<=clock_timestamp() or (p_credential->>'kind'='guest' and v_request.token_expires_at<=clock_timestamp()) then raise exception 'NOT_FOUND'; end if;
  if p_credential->>'kind'='host' and ((p_credential->>'expiresAt')::timestamptz<=clock_timestamp() or exists(select 1 from auth.sessions where id=(p_credential->>'sessionId')::uuid and not_after<=clock_timestamp())) then raise exception 'UNAUTHORIZED'; end if;
  -- Include confirmed local writes even if the provider has not returned them
  -- yet. Booking dispatch still requires its own fresh check and reservation.
  select coalesce(jsonb_agg(jsonb_build_object('start',a.starts_at,'end',a.ends_at) order by a.starts_at,a.ends_at,a.id),'[]'::jsonb) into v_bookings
    from fmat.booking_attempts a where a.host_id=v_host.id and a.request_id<>v_request.id and a.phase='confirmed'
    and (a.calendar_id=any(v_host.conflict_calendar_ids) or a.calendar_id=v_host.booking_calendar_id)
    and exists(select 1 from jsonb_array_elements(coalesce(v_request.details->'windows','[]')) w
      where a.starts_at<(w->>'end')::timestamptz+make_interval(mins=>(v_host.rules->>'bufferMinutes')::integer)
      and a.ends_at>(w->>'start')::timestamptz-make_interval(mins=>(v_host.rules->>'bufferMinutes')::integer));
  v_basis:=encode(sha256(convert_to(jsonb_build_object('revision',v_request.revision,'details',v_request.details,
    'rulesVersion',v_host.rules_version,'rules',v_host.rules,'hostConnection',v_host_connection.id,'hostGeneration',v_host_connection.generation,
    'hostCalendars',v_host.conflict_calendar_ids,'bookingCalendar',v_host.booking_calendar_id,'mode',v_request.availability_mode,
    'guestConnection',v_guest_connection.id,'guestGeneration',v_guest_connection.generation,'guestCalendars',v_guest_connection.selected_calendar_ids,
    'localBookings',v_bookings)::text,'UTF8')),'hex');
  if p_operation='start' then
    v_check:=(p_input->>'checkId')::uuid;
    if v_check is null then raise exception 'INVALID_INPUT'; end if;
    update fmat.requests set availability_check_id=v_check,availability_check_started_at=clock_timestamp() where id=v_request.id;
    return jsonb_build_object('checkId',v_check,'basis',v_basis,'revision',v_request.revision,'rulesVersion',v_host.rules_version,
      'details',v_request.details,'rules',v_host.rules,'localBookings',v_bookings,'mode',v_request.availability_mode,
      'host',jsonb_build_object('principalId',v_host.id,'providerSubject',v_host_connection.provider_subject,'encryptedCredential',v_host_connection.encrypted_credential,'calendarIds',v_host.conflict_calendar_ids),
      'guest',case when v_request.availability_mode='calendar' then jsonb_build_object('principalId',v_request.id,'providerSubject',v_guest_connection.provider_subject,'encryptedCredential',v_guest_connection.encrypted_credential,'calendarIds',v_guest_connection.selected_calendar_ids) else null end);
  end if;
  if (p_input->>'checkId')::uuid is distinct from v_request.availability_check_id or p_input->>'basis' is distinct from v_basis
    or v_request.availability_check_started_at is null or v_request.availability_check_started_at<clock_timestamp()-interval '5 minutes' then raise exception 'REVISION_CONFLICT'; end if;
  if p_operation='check' then return jsonb_build_object('current',true);
  elsif p_operation='refresh' then
    if p_input->>'party'='host' then v_connection:=v_host_connection;
    elsif p_input->>'party'='guest' then v_connection:=v_guest_connection;
    else raise exception 'INVALID_INPUT'; end if;
    if v_connection.id is null or p_input->>'previousCredential' is distinct from v_connection.encrypted_credential then raise exception 'REVISION_CONFLICT'; end if;
    if length(coalesce(p_input->>'encryptedCredential','')) not between 20 and 131072 then raise exception 'INVALID_INPUT'; end if;
    update fmat.calendar_connections set encrypted_credential=p_input->>'encryptedCredential',updated_at=clock_timestamp() where id=v_connection.id;
    return jsonb_build_object('refreshed',true);
  elsif p_operation='failure' then
    if p_input->>'party' not in ('host','guest') or p_input->>'party' is null or (p_input->>'party'='guest' and v_request.availability_mode<>'calendar') then raise exception 'INVALID_INPUT'; end if;
    update fmat.requests set host_availability_failed=host_availability_failed or p_input->>'party'='host',
      availability_failed=availability_failed or p_input->>'party'='guest',revision=revision+1,
      candidates='[]',private_diagnostics='[]',private_travel_checks='[]',current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,
      status=case when fmat.details_complete(details) then 'negotiating' else 'gathering' end,updated_at=clock_timestamp(),availability_check_id=null,availability_check_started_at=null
      where id=v_request.id returning * into v_request;
    insert into fmat.request_history(request_id,revision,operation,actor) values(v_request.id,v_request.revision,'availability_read_failed',v_actor-'tokenHash');
    perform fmat.audit('availability_read_failed',v_actor,v_request.id::text);
    return jsonb_build_object('paused',true);
  elsif p_operation='success' then
    update fmat.requests set host_availability_failed=false,availability_failed=false where id=v_request.id;
    return jsonb_build_object('checked',true,'revision',v_request.revision,'checkedAt',clock_timestamp());
  end if;
  raise exception 'FORBIDDEN';
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_availability_evaluation"(text, jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."fmat_availability_evaluation"(text, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_availability_evaluation"(text, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_availability_evaluation"(text, jsonb, jsonb) TO "service_role";
