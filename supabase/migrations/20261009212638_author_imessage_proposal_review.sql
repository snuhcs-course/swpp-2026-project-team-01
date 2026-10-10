SET local check_function_bodies = off;

CREATE TABLE "fmat"."photon_proposal_reviews" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "inbox_id"         uuid                     NOT NULL,
  "link_id"          uuid                     NOT NULL,
  "receiver_id"      uuid                     NOT NULL,
  "request_id"       uuid                     NOT NULL,
  "revision"         integer                  NOT NULL,
  "proposal_version" integer                  NOT NULL,
  "proposal"         jsonb                    NOT NULL,
  "context_basis"    text                     NOT NULL,
  "requester_agreed" boolean                  NOT NULL,
  "can_approve"      boolean                  NOT NULL,
  "can_decline"      boolean                  NOT NULL,
  "text"             text                     NOT NULL,
  "expires_at"       timestamp with time zone NOT NULL,
  "created_at"       timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "photon_proposal_reviews_context_basis_check" CHECK ((context_basis ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "photon_proposal_reviews_inbox_id_key" UNIQUE (inbox_id),
  CONSTRAINT "photon_proposal_reviews_pkey" PRIMARY KEY (id),
  CONSTRAINT "photon_proposal_reviews_proposal_check" CHECK ((jsonb_typeof(proposal) = 'object'::text)),
  CONSTRAINT "photon_proposal_reviews_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "photon_proposal_reviews_text_check" CHECK ((length(text) <= 4000))
);

ALTER TABLE "fmat"."photon_proposal_reviews"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.evaluate_availability (
  p_operation     text,
  p_credential    jsonb,
  p_input         jsonb,
  p_booking_lease jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_job fmat.jobs; v_attempt fmat.booking_attempts; v_reservation uuid; v_actor jsonb; v_request fmat.requests; v_host fmat.hosts;
  v_host_connection fmat.calendar_connections; v_guest_connection fmat.calendar_connections; v_connection fmat.calendar_connections;
  v_basis text; v_travel_basis text; v_bookings jsonb; v_commitments jsonb; v_check uuid;
  v_evaluation fmat.candidate_evaluations; v_evidence jsonb; v_candidate jsonb; v_candidate_key text; v_status text; v_expires timestamptz; v_now timestamptz; v_private_context jsonb; v_agent fmat.oauth_grants; v_agent_authority fmat.oauth_grants; v_photon jsonb;
begin
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
  -- Workers lock their lease first. All evaluation paths then lock request,
  -- host, account and connections; workers take attempt/reservation last.
  if p_credential->>'kind'='photon_review' and (p_booking_lease is not null or p_operation is distinct from 'current_context') then raise exception 'FORBIDDEN';end if;
  if p_credential->>'kind'='agent' and (p_booking_lease is not null or p_operation is distinct from 'current_context') then raise exception 'FORBIDDEN';end if;
  if p_booking_lease is not null then
    v_actor:=jsonb_build_object('kind','worker','id',p_booking_lease->>'workerId');
    v_job:=fmat.require_job_lease(v_actor,(p_booking_lease->>'jobId')::uuid,(p_booking_lease->>'leaseToken')::uuid);
    if v_job.kind<>'booking' or v_job.payload->>'requestId' is distinct from p_input->>'requestId' then raise exception 'FORBIDDEN';end if;
  end if;
  if p_credential->>'kind'='agent' then
    select * into v_agent_authority from fmat.oauth_grants where id=(p_credential->>'grantId')::uuid;
    v_agent:=fmat.oauth_bound_grant(v_agent_authority);
    if v_agent.id is null or (v_agent.actor_kind='guest' and v_agent.request_id is distinct from (p_input->>'requestId')::uuid) then raise exception 'FORBIDDEN';end if;
  end if;
  select * into v_request from fmat.requests where id=(p_input->>'requestId')::uuid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_credential->>'kind'='agent' then
    -- The agent operation acquires request/host locks before its OAuth locks.
    -- This private branch is read-only and never accepts browser credentials.
    perform 1 from fmat.hosts where id=v_request.host_id for update;
    v_agent_authority:=fmat.oauth_lock_grant((p_credential->>'grantId')::uuid);
    v_agent:=fmat.oauth_bound_grant(v_agent_authority);
    if v_agent.id is null or v_agent.host_id is distinct from v_request.host_id
      or (v_agent.actor_kind='guest' and v_agent.request_id is distinct from v_request.id)
      or not((case when v_agent.actor_kind='host' then 'host:read' else 'request:read' end)=any(string_to_array(v_agent.scope,' ')))
      or coalesce((p_credential->>'tokenExpiresAt')::bigint,0)<=extract(epoch from clock_timestamp()) then raise exception 'FORBIDDEN';end if;
  elsif p_credential->>'kind'='photon_review' then
    v_photon:=public.fmat_conversation_check((p_credential->>'grantId')::uuid,(p_credential->>'conversationId')::uuid);
    if v_photon->>'audience' is distinct from 'host_private' or v_photon->>'requestId' is distinct from v_request.id::text
      or not exists(select 1 from fmat.conversation_grants where id=(p_credential->>'grantId')::uuid and credential->>'kind'='photon') then raise exception 'FORBIDDEN';end if;
    v_actor:=v_photon->'actor';
  elsif p_booking_lease is null then
    v_actor:=fmat.calendar_actor(p_credential);
    perform fmat.require_request(v_actor,v_request.id);
  elsif v_request.status<>'booking' or v_request.token_revoked_at is not null or v_request.token_expires_at<=clock_timestamp() then raise exception 'REQUEST_CLOSED';end if;
  select * into strict v_host from fmat.hosts where id=v_request.host_id for update;
  perform 1 from auth.users where id=v_host.id for share;
  if not exists(select 1 from auth.users where id=v_host.id and deleted_at is null and email_confirmed_at is not null and (banned_until is null or banned_until<=clock_timestamp())) then raise exception 'NOT_FOUND'; end if;
  if (v_request.status in ('booked','declined','withdrawn','expired') or (p_booking_lease is null and v_request.status='booking')) or v_request.expires_at<=clock_timestamp() then raise exception 'NOT_FOUND'; end if;
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
  if p_booking_lease is not null then
    select * into v_attempt from fmat.booking_attempts where id=(v_job.payload->>'attemptId')::uuid and request_id=v_request.id for update;
    if not found or v_attempt.phase<>'prepared' then raise exception 'BOOKING_UNCERTAIN';end if;
    if v_attempt.host_id<>v_host.id or v_attempt.expected_revision<>v_request.revision
      or v_attempt.proposal_version is distinct from v_request.current_proposal_version
      or v_request.requester_agreed_version is distinct from v_attempt.proposal_version
      or v_request.host_approved_version is distinct from v_attempt.proposal_version
      or not exists(select 1 from fmat.web_approval_decisions d join fmat.host_approvals a on a.id=d.approval_id
        where d.approval_id=v_attempt.approval_id and d.request_id=v_request.id and d.host_id=v_host.id
        -- Recovery advances request revision without fabricating a new human decision.
        -- The saved approval remains bound to its original revision and proposal;
        -- current revision/decisions and proposal context are checked separately.
        and d.result_revision=a.approved_revision and d.result_revision<=v_attempt.expected_revision
        and a.request_id=v_request.id and a.host_id=v_host.id and a.proposal_version=v_attempt.proposal_version)
      then raise exception 'PROPOSAL_STALE';end if;
    if v_attempt.rules_version<>v_host.rules_version or v_attempt.connection_id<>v_host_connection.id
      or v_attempt.connection_provider_subject<>v_host_connection.provider_subject
      or v_attempt.calendar_id is distinct from v_host.booking_calendar_id
      or v_attempt.starts_at<=clock_timestamp() then raise exception 'FEASIBILITY_STALE';end if;
    if v_request.contact_verified_email is distinct from (select lower(details->>'requesterEmail') from fmat.proposals where request_id=v_request.id and version=v_attempt.proposal_version) then raise exception 'CONTACT_NOT_VERIFIED';end if;
    if (p_operation='start' or p_input ? 'candidate') and p_input->'candidate' is distinct from
      jsonb_build_object('start',v_attempt.payload->'start'->>'dateTime','end',v_attempt.payload->'end'->>'dateTime') then raise exception 'INVALID_INPUT';end if;
    insert into fmat.host_reservations(host_id,attempt_id) values(v_host.id,v_attempt.id) on conflict(host_id) do nothing;
    select attempt_id into v_reservation from fmat.host_reservations where host_id=v_host.id for update;
    if v_reservation is distinct from v_attempt.id then raise exception 'HOST_BUSY';end if;
    perform fmat.require_job_lease(v_actor,v_job.id,v_job.lease_token);
    if v_request.expires_at<=clock_timestamp() or v_request.token_expires_at<=clock_timestamp() then raise exception 'REQUEST_CLOSED';end if;
  end if;
  -- Include confirmed local writes even if the provider has not returned them
  -- yet. Booking dispatch still requires its own fresh check and reservation.
  select coalesce(jsonb_agg(jsonb_build_object('start',a.starts_at,'end',a.ends_at) order by a.starts_at,a.ends_at,a.id),'[]'::jsonb) into v_bookings
    from fmat.booking_attempts a where a.host_id=v_host.id and a.request_id<>v_request.id and a.phase='confirmed'
    and (a.calendar_id=any(v_host.conflict_calendar_ids) or a.calendar_id=v_host.booking_calendar_id)
    and exists(select 1 from jsonb_array_elements(coalesce(v_request.details->'windows','[]')) w
      where a.starts_at<(w->>'end')::timestamptz+make_interval(mins=>(v_host.rules->>'bufferMinutes')::integer)
      and a.ends_at>(w->>'start')::timestamptz-make_interval(mins=>(v_host.rules->>'bufferMinutes')::integer));
  -- Neighbor context also needs confirmed writes outside the requested slot.
  -- A bounded read never establishes the host's location beyond its coverage.
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'calendarId',a.calendar_id,'eventId',a.event_id,
      'version',a.payload_fingerprint,'interval',jsonb_build_object('start',a.starts_at,'end',a.ends_at),
      'location',a.payload->>'location') order by a.starts_at,a.ends_at,a.id),'[]'::jsonb) into v_commitments
    from (select b.* from fmat.booking_attempts b where b.host_id=v_host.id and b.request_id<>v_request.id and b.phase='confirmed'
      and (b.calendar_id=any(v_host.conflict_calendar_ids) or b.calendar_id=v_host.booking_calendar_id)
      and exists(select 1 from jsonb_array_elements(coalesce(v_request.details->'windows','[]')) w
        where b.starts_at<(w->>'end')::timestamptz+interval '31 days'
        and b.ends_at>(w->>'start')::timestamptz-interval '31 days') limit 10001) a;
  if jsonb_array_length(v_commitments)>10000 then raise exception 'PROVIDER_UNAVAILABLE'; end if;
  v_basis:=encode(sha256(convert_to(jsonb_build_object('revision',v_request.revision,'details',v_request.details,
    'rulesVersion',v_host.rules_version,'rules',v_host.rules,'hostConnection',v_host_connection.id,'hostGeneration',v_host_connection.generation,
    'hostCalendars',v_host.conflict_calendar_ids,'bookingCalendar',v_host.booking_calendar_id,'mode',v_request.availability_mode,
    'guestConnection',v_guest_connection.id,'guestGeneration',v_guest_connection.generation,'guestCalendars',v_guest_connection.selected_calendar_ids,
    'localBookings',v_bookings,'localCommitments',v_commitments,'privateSchedulingContext',v_request.private_scheduling_context)::text,'UTF8')),'hex');
  -- Manual travel decisions bind content, not the revision advanced by their
  -- own confirmation. The ordinary basis still fences every async mutation.
  v_travel_basis:=encode(sha256(convert_to(jsonb_build_object('details',v_request.details,
    'rulesVersion',v_host.rules_version,'rules',v_host.rules,'hostConnection',v_host_connection.id,'hostGeneration',v_host_connection.generation,
    'hostCalendars',v_host.conflict_calendar_ids,'bookingCalendar',v_host.booking_calendar_id,'mode',v_request.availability_mode,
    'guestConnection',v_guest_connection.id,'guestGeneration',v_guest_connection.generation,'guestCalendars',v_guest_connection.selected_calendar_ids,
    'localBookings',v_bookings,'localCommitments',v_commitments,'privateSchedulingContext',v_request.private_scheduling_context)::text,'UTF8')),'hex');
  if p_booking_lease is not null and not exists(select 1 from fmat.proposal_evidence where request_id=v_request.id and proposal_version=v_attempt.proposal_version and context_basis=v_travel_basis) then raise exception 'PROPOSAL_STALE';end if;
  if p_credential->>'kind'='agent' and ((p_credential->>'tokenExpiresAt')::bigint<=extract(epoch from clock_timestamp()) or not fmat.oauth_authority_current(v_agent_authority)) then raise exception 'UNAUTHORIZED';end if;
  if p_credential->>'kind'='photon_review' then perform public.fmat_conversation_check((p_credential->>'grantId')::uuid,(p_credential->>'conversationId')::uuid);end if;
  if p_operation='current_context' then return jsonb_build_object('travelBasis',v_travel_basis);end if;
  if p_operation='start' then
    v_check:=(p_input->>'checkId')::uuid;
    if v_check is null then raise exception 'INVALID_INPUT'; end if;
    update fmat.requests set availability_check_id=v_check,availability_check_started_at=clock_timestamp() where id=v_request.id;
    if p_booking_lease is not null then
      insert into fmat.booking_checks(attempt_id,job_id,lease_token,check_id) values(v_attempt.id,v_job.id,v_job.lease_token,v_check)
        on conflict(attempt_id) do update set job_id=excluded.job_id,lease_token=excluded.lease_token,check_id=excluded.check_id,destination_checked_at=null;
    end if;
    return jsonb_build_object('preferenceDecisions',(select coalesce(jsonb_agg(p.value||jsonb_build_object('id',p.id,'contextFingerprint',p.context_fingerprint)),'[]'::jsonb) from fmat.preference_decisions p where p.request_id=v_request.id and p.context_basis=v_travel_basis and p.revoked_at is null),'travelBasis',v_travel_basis,'allowances',(select coalesce(jsonb_agg(a.value||jsonb_build_object('id',a.id,'contextFingerprint',a.context_fingerprint)),'[]'::jsonb) from fmat.travel_allowances a where a.request_id=v_request.id and a.travel_basis=v_travel_basis and a.revoked_at is null),'checkId',v_check,'basis',v_basis,'revision',v_request.revision,'rulesVersion',v_host.rules_version,
      'bookingCalendarId',case when p_booking_lease is not null then v_attempt.calendar_id else null end,'details',v_request.details,'rules',v_host.rules,'localBookings',v_bookings,'localCommitments',v_commitments,'mode',v_request.availability_mode,
      'host',jsonb_build_object('principalId',v_host.id,'providerSubject',v_host_connection.provider_subject,'encryptedCredential',v_host_connection.encrypted_credential,'calendarIds',v_host.conflict_calendar_ids),
      'guest',case when v_request.availability_mode='calendar' then jsonb_build_object('principalId',v_request.id,'providerSubject',v_guest_connection.provider_subject,'encryptedCredential',v_guest_connection.encrypted_credential,'calendarIds',v_guest_connection.selected_calendar_ids) else null end);
  end if;
  if p_booking_lease is not null and not exists(select 1 from fmat.booking_checks where attempt_id=v_attempt.id and job_id=v_job.id and lease_token=v_job.lease_token and check_id=v_request.availability_check_id) then raise exception 'LEASE_LOST';end if;
  if p_operation='evidence_read' then
    select * into v_evaluation from fmat.candidate_evaluations where id=(p_input->>'evaluationId')::uuid and request_id=v_request.id;
    if not found then raise exception 'NOT_FOUND'; end if;
    if v_evaluation.basis is distinct from v_basis or v_evaluation.check_id is distinct from v_request.availability_check_id
      or v_evaluation.request_revision<>v_request.revision or v_evaluation.rules_version<>v_host.rules_version
      or v_request.availability_check_started_at is null or v_request.availability_check_started_at<clock_timestamp()-interval '5 minutes'
      or v_evaluation.expires_at<=clock_timestamp() then raise exception 'REVISION_CONFLICT'; end if;
    return jsonb_build_object('evaluationId',v_evaluation.id,'requestId',v_request.id,'revision',v_request.revision,'rulesVersion',v_host.rules_version,
      'status',v_evaluation.status,'expiresAt',v_evaluation.expires_at,'complete',false);
  end if;
  if (p_input->>'checkId')::uuid is distinct from v_request.availability_check_id or p_input->>'basis' is distinct from v_basis
    or v_request.availability_check_started_at is null or v_request.availability_check_started_at<clock_timestamp()-interval '5 minutes' then raise exception 'REVISION_CONFLICT'; end if;
  if p_operation='booking_dispatch' then
    if p_booking_lease is null then raise exception 'FORBIDDEN';end if;
    select * into v_evaluation from fmat.candidate_evaluations where id=(p_input->>'evaluationId')::uuid and request_id=v_request.id;
    v_now:=clock_timestamp();
    if not found or v_evaluation.status<>'checks_passed' or v_evaluation.basis<>v_basis
      or v_evaluation.check_id is distinct from v_request.availability_check_id
      or v_evaluation.request_revision<>v_request.revision or v_evaluation.rules_version<>v_host.rules_version
      or v_evaluation.evaluated_at<v_now-interval '30 seconds' or v_evaluation.expires_at<=v_now
      or v_evaluation.candidate is distinct from jsonb_build_object('start',v_attempt.payload->'start'->>'dateTime','end',v_attempt.payload->'end'->>'dateTime')
      or not exists(select 1 from fmat.booking_checks where attempt_id=v_attempt.id and job_id=v_job.id and lease_token=v_job.lease_token
        and check_id=v_evaluation.check_id and destination_checked_at>=v_now-interval '30 seconds')
      then raise exception 'FEASIBILITY_STALE';end if;
    if v_request.host_availability_failed or (v_request.availability_mode='calendar' and v_request.availability_failed) then raise exception 'RECONNECT_REQUIRED';end if;
    if not exists(select 1 from jsonb_array_elements(v_attempt.payload->'attendees') attendee where lower(attendee->>'email')=lower(v_host.email)) then raise exception 'CONTACT_NOT_VERIFIED';end if;
    perform fmat.require_job_lease(v_actor,v_job.id,v_job.lease_token);
    if v_request.expires_at<=clock_timestamp() or v_request.token_expires_at<=clock_timestamp() or v_attempt.starts_at<=clock_timestamp() then raise exception 'REQUEST_CLOSED';end if;
    insert into fmat.booking_dispatches(attempt_id,job_id,lease_token,evaluation_id,check_id)
      values(v_attempt.id,v_job.id,v_job.lease_token,v_evaluation.id,v_evaluation.check_id);
    update fmat.booking_attempts set phase='dispatched',dispatched_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_attempt.id returning * into v_attempt;
    perform fmat.audit('booking_dispatch',v_actor,v_attempt.id::text,jsonb_build_object('evaluationId',v_evaluation.id));
    return jsonb_build_object('dispatched',true,'snapshot',jsonb_build_object('requestId',v_attempt.request_id,'attemptId',v_attempt.id,
      'proposalVersion',v_attempt.proposal_version,'calendarId',v_attempt.calendar_id,'eventId',v_attempt.event_id,'payload',v_attempt.payload,
      'payloadFingerprint',v_attempt.payload_fingerprint,'connectionProviderSubject',v_attempt.connection_provider_subject,'phase',v_attempt.phase));
  end if;
  if p_operation='destination_checked' then
    if p_booking_lease is null then raise exception 'FORBIDDEN';end if;
    update fmat.booking_checks set destination_checked_at=clock_timestamp() where attempt_id=v_attempt.id;
    return jsonb_build_object('checked',true);
  end if;
  if p_operation='check' then return jsonb_build_object('current',true);
  elsif p_operation='evidence_save' then
    if p_booking_lease is not null and not exists(select 1 from fmat.booking_checks where attempt_id=v_attempt.id and destination_checked_at is not null) then raise exception 'CALENDAR_ACCESS_INVALID';end if;
    v_candidate:=p_input->'candidate';v_evidence:=p_input->'evidence';v_now:=clock_timestamp();
    if jsonb_typeof(v_candidate) is distinct from 'object' or jsonb_typeof(v_evidence) is distinct from 'object'
      or v_evidence->'candidate' is distinct from v_candidate or v_evidence->'complete' is distinct from 'false'::jsonb
      or not ((v_evidence->>'preferences'='pending') is true or (jsonb_typeof(v_evidence->'preferences')='object') is true) or octet_length(v_evidence::text)>65536
      or exists(select 1 from jsonb_object_keys(v_candidate) k where k not in ('start','end'))
      or exists(select 1 from jsonb_object_keys(v_evidence) k where k not in ('candidate','interval','contextFingerprint','travel','travelContext','preferences','complete'))
      or coalesce(v_evidence->>'interval','') not in ('fits','conflict','clarification')
      or coalesce(v_candidate->>'start','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(v_candidate->>'end','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
      or (v_candidate->>'start')::timestamptz<=v_now or (v_candidate->>'end')::timestamptz<=(v_candidate->>'start')::timestamptz
      then raise exception 'INVALID_INPUT'; end if;
    -- Serialize precise instants as JSON strings; never round the application's
    -- nanosecond comparison into a PostgreSQL microsecond feasibility claim.
    if not(v_evidence ?& array['contextFingerprint','travel']) or (v_evidence->'travel'<>'null'::jsonb and
      (jsonb_typeof(v_evidence->'travel') is distinct from 'object' or coalesce(v_evidence->'travel'->>'status','') not in ('fits','conflict','clarification')
       or jsonb_typeof(v_evidence->'travel'->'legs') is distinct from 'array' or jsonb_array_length(v_evidence->'travel'->'legs')<>2
       or coalesce(v_evidence->>'contextFingerprint','') !~ '^[a-f0-9]{64}$')) then raise exception 'INVALID_INPUT'; end if;
    if jsonb_typeof(v_evidence->'preferences')='object' then
      if coalesce(v_evidence->'preferences'->>'contextFingerprint','') !~ '^[a-f0-9]{64}$'
       or coalesce(v_evidence->'preferences'->>'status','') not in ('satisfied','requires_confirmation')
       or jsonb_typeof(v_evidence->'preferences'->'checks') is distinct from 'array' or jsonb_array_length(v_evidence->'preferences'->'checks')<>3
       or (select count(distinct c->>'key') from jsonb_array_elements(v_evidence->'preferences'->'checks') c where c->>'key' in ('meeting_mode','location','additional'))<>3
       or exists(select 1 from jsonb_array_elements(v_evidence->'preferences'->'checks') c where coalesce(c->>'status','') not in ('satisfied','unresolved','exception'))
       or (v_evidence->'preferences'->>'status'='requires_confirmation') is distinct from exists(select 1 from jsonb_array_elements(v_evidence->'preferences'->'checks') c where c->>'status'='unresolved') then raise exception 'INVALID_INPUT';end if;
    end if;
    if v_evidence->>'interval'<>'fits' and v_evidence->'travel'<>'null'::jsonb then raise exception 'INVALID_INPUT'; end if;
    if v_request.host_availability_failed or (v_request.availability_mode='calendar' and v_request.availability_failed) then raise exception 'RECONNECT_REQUIRED'; end if;
    if (p_input->>'rulesVersion')::integer is distinct from v_host.rules_version then raise exception 'REVISION_CONFLICT'; end if;
    v_candidate_key:=encode(sha256(convert_to(v_candidate::text,'UTF8')),'hex');
    select * into v_evaluation from fmat.candidate_evaluations where request_id=v_request.id and check_id=v_request.availability_check_id and candidate_key=v_candidate_key;
    if found then
      if v_evaluation.evidence is distinct from v_evidence or v_evaluation.basis is distinct from v_basis then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      if v_evaluation.expires_at<=v_now then raise exception 'REVISION_CONFLICT'; end if;
    else
      v_status:=case when v_evidence->>'interval'='conflict' or v_evidence->'travel'->>'status'='conflict' then 'conflict'
        when v_evidence->>'interval'='fits' and v_evidence->'travel'->>'status'='fits' and v_evidence->'preferences'->>'status'='satisfied' then 'checks_passed' else 'clarification' end;
      v_expires:=least(v_request.availability_check_started_at+interval '5 minutes',(v_candidate->>'start')::timestamptz);
      if v_expires<=v_now then raise exception 'REVISION_CONFLICT'; end if;
      v_private_context:=jsonb_build_object('travelBasis',v_travel_basis,'details',v_request.details,'rules',v_host.rules,'privateSchedulingContext',v_request.private_scheduling_context,
        'hostConnection',v_host_connection.id,'hostGeneration',v_host_connection.generation,'hostCalendars',v_host.conflict_calendar_ids,'bookingCalendar',v_host.booking_calendar_id,
        'availabilityMode',v_request.availability_mode,'guestConnection',v_guest_connection.id,'guestGeneration',v_guest_connection.generation,'guestCalendars',v_guest_connection.selected_calendar_ids,
        'localBookingsFingerprint',encode(sha256(convert_to(jsonb_build_object('busy',v_bookings,'commitments',v_commitments)::text,'UTF8')),'hex'));
      insert into fmat.candidate_evaluations(request_id,check_id,request_revision,rules_version,basis,candidate_key,candidate,status,evidence,private_context,evaluated_at,expires_at)
        values(v_request.id,v_request.availability_check_id,v_request.revision,v_host.rules_version,v_basis,v_candidate_key,v_candidate,v_status,v_evidence,v_private_context,v_now,v_expires)
        returning * into v_evaluation;
    end if;
    return jsonb_build_object('evaluationId',v_evaluation.id,'requestId',v_request.id,'revision',v_request.revision,'rulesVersion',v_host.rules_version,
      'status',v_evaluation.status,'expiresAt',v_evaluation.expires_at,'complete',false);
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
    if p_booking_lease is not null then
      update fmat.booking_attempts set phase='blocked',reason='availability_read_failed',updated_at=clock_timestamp() where id=v_attempt.id;
      delete from fmat.host_reservations where attempt_id=v_attempt.id;
    end if;
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

CREATE OR REPLACE FUNCTION fmat.photon_proposal_review (
  p_inbox uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare i fmat.photon_inbox; state jsonb; p jsonb; prior fmat.photon_proposal_reviews; review_id uuid:=gen_random_uuid(); body text;
begin
 select * into i from fmat.photon_inbox where id=p_inbox;
 if not found or lower(btrim(i.text)) is distinct from 'review' then raise exception 'FORBIDDEN';end if;
 state:=fmat.photon_proposal_state(i.id);
 select * into prior from fmat.photon_proposal_reviews where inbox_id=i.id;
 -- A retry retains the exact authored text and deadline; never rebases a review.
 if prior.id is not null then return prior.text;end if;
 p:=state->'proposal';
 if p is null or p='null'::jsonb then
  return fmat.photon_scoped_reply(i.conversation_id,'There is no open proposal to review. Open your host workspace for the current request status.');
 end if;
 body:='Request '||(state->>'requestId')||E'\nProposal '||(state->>'proposalVersion')||', request revision '||(state->>'revision')||E'\n';
 body:=body||'Start: '||coalesce(p->>'start','')||E'\nEnd: '||coalesce(p->>'end','')||E'\nTimezone: '||coalesce(p->>'timezone','')||E'\n';
 -- JSON quoting keeps user-entered newlines and instruction-like text visibly
 -- within field values. Never truncate details before issuing decision context.
 body:=body||'Mode: '||coalesce(to_jsonb(p->>'mode')::text,'null')||E'\nLocation: '||coalesce(to_jsonb(p->>'location')::text,'null')||E'\n';
 body:=body||'Requester: '||coalesce(to_jsonb(p->>'requesterName')::text,'null')||E'\nContact: '||coalesce(to_jsonb(p->>'requesterEmail')::text,'null')||E'\nPurpose: '||coalesce(to_jsonb(p->>'purpose')::text,'null')||E'\n';
 body:=body||'Requester agreement: '||case when (state->>'requesterAgreed')::boolean then 'current' else 'not current' end||E'\n';
 if state->>'blocker' not in ('none','agreement_required','contact_verification_required') then
  body:=body||'Review unavailable: '||(state->>'blocker')||E'.\nOpen your host workspace to refresh the proposal.';
  if length(body)>4000 then return fmat.photon_scoped_reply(i.conversation_id,'This proposal is too long for a complete message. Open your host workspace to review every detail.');end if;
  return body;
 end if;
 body:=body||'Review reference: '||review_id::text||E'\nValid until: '||to_char((state->>'expiresAt')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||E'\n';
 body:=body||'Review does not approve or book. Complete approval or decline in your host workspace.';
 if length(body)>4000 then return fmat.photon_scoped_reply(i.conversation_id,'This proposal is too long for a complete message. Open your host workspace to review every detail.');end if;
 if (state->>'expiresAt')::timestamptz<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
 insert into fmat.photon_proposal_reviews(id,inbox_id,link_id,receiver_id,request_id,revision,proposal_version,proposal,context_basis,requester_agreed,can_approve,can_decline,text,expires_at)
 values(review_id,i.id,i.link_id,i.receiver_id,(state->>'requestId')::uuid,(state->>'revision')::integer,(state->>'proposalVersion')::integer,p,state->>'contextBasis',
  (state->>'requesterAgreed')::boolean,(state->>'canApprove')::boolean,(state->>'canDecline')::boolean,body,(state->>'expiresAt')::timestamptz);
 return body;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.photon_proposal_review_check (
  p_inbox  uuid,
  p_review uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare i fmat.photon_inbox; review fmat.photon_proposal_reviews; state jsonb;
begin
 state:=fmat.photon_proposal_state(p_inbox);
 select * into strict i from fmat.photon_inbox where id=p_inbox;
 select * into review from fmat.photon_proposal_reviews where id=p_review;
 if review.id is null or review.link_id is distinct from i.link_id or review.receiver_id is distinct from i.receiver_id
  or review.request_id::text is distinct from state->>'requestId' or review.revision is distinct from (state->>'revision')::integer
  or review.proposal_version is distinct from (state->>'proposalVersion')::integer or review.proposal is distinct from state->'proposal'
  or review.context_basis is distinct from state->>'contextBasis' or review.requester_agreed is distinct from (state->>'requesterAgreed')::boolean
  or review.can_approve is distinct from (state->>'canApprove')::boolean or review.can_decline is distinct from (state->>'canDecline')::boolean
  or review.expires_at<=clock_timestamp() or state->>'blocker' not in ('none','agreement_required','contact_verification_required')
 then raise exception 'REVISION_CONFLICT';end if;
 return state||jsonb_build_object('reviewId',review.id,'expiresAt',review.expires_at);
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.photon_proposal_state (
  p_inbox uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare i fmat.photon_inbox; r fmat.requests; access jsonb; proposal jsonb; lifecycle jsonb;
 basis text; blocker text:='none'; agreed boolean; deadline timestamptz;
begin
 select * into i from fmat.photon_inbox where id=p_inbox;
 if not found then raise exception 'UNAUTHORIZED';end if;
 access:=public.fmat_conversation_check(i.execution_grant_id,i.conversation_id);
 if access->>'audience' is distinct from 'host_private' or not exists(select 1 from fmat.conversation_grants g
  where g.id=i.execution_grant_id and g.credential->>'kind'='photon' and g.credential->>'inboxId'=i.id::text) then raise exception 'FORBIDDEN';end if;
 select * into strict r from fmat.requests where id=(access->>'requestId')::uuid for update;
 lifecycle:=fmat.request_lifecycle_view(r.id,'host');
 select details into proposal from fmat.proposals where request_id=r.id and version=r.current_proposal_version;
 if (lifecycle->>'closed')::boolean then blocker:='closed';proposal:=null;
 elsif lifecycle->>'status'='booking' then blocker:='booking_pending';
 elsif proposal is null then blocker:='proposal_required';
 else
  begin
   basis:=fmat.evaluate_availability('current_context',jsonb_build_object('kind','photon_review','grantId',i.execution_grant_id,'conversationId',i.conversation_id),
    jsonb_build_object('requestId',r.id,'revision',r.revision),null)->>'travelBasis';
  exception when raise_exception then if sqlerrm='RECONNECT_REQUIRED' then blocker:='reconnect_required';else raise;end if;end;
  if blocker='none' then
   if not exists(select 1 from fmat.proposal_evidence where request_id=r.id and proposal_version=r.current_proposal_version and context_basis=basis)
     or (proposal->>'start')::timestamptz<=clock_timestamp() or r.token_revoked_at is not null or r.token_expires_at<=clock_timestamp() then blocker:='proposal_stale';
   elsif r.host_availability_failed or (r.availability_mode='calendar' and r.availability_failed) then blocker:='reconnect_required';
   elsif r.requester_agreed_version is distinct from r.current_proposal_version then blocker:='agreement_required';
   elsif r.contact_verified_email is distinct from lower(proposal->>'requesterEmail') then blocker:='contact_verification_required';end if;
  end if;
 end if;
 -- Revalidate after all connection/host lock waits, not transaction-start time.
 perform public.fmat_conversation_check(i.execution_grant_id,i.conversation_id);
 agreed:=proposal is not null and coalesce(r.requester_agreed_version=r.current_proposal_version,false) and blocker not in ('proposal_stale','reconnect_required');
 deadline:=least(clock_timestamp()+interval '10 minutes',i.received_at+interval '1 hour',r.expires_at,r.token_expires_at,(proposal->>'start')::timestamptz);
 return jsonb_build_object('requestId',r.id,'revision',r.revision,'proposalVersion',r.current_proposal_version,'proposal',proposal,
  'contextBasis',basis,'requesterAgreed',agreed,'canApprove',blocker='none','canDecline',(lifecycle->>'canDecline')::boolean,
  'blocker',blocker,'expiresAt',deadline);
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
begin
  if p_credential->>'kind' in ('agent','photon_review') then raise exception 'FORBIDDEN';end if;
  return fmat.evaluate_availability(p_operation,p_credential,p_input,null);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_photon_dispatch (
  p_project_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare i fmat.photon_inbox; j fmat.jobs; l fmat.photon_links; s fmat.conversation_scopes;
 g fmat.conversation_grants; credential jsonb; accepted jsonb; outcome text; publication record;
 target uuid; command text; notice text; navigation boolean; chosen fmat.requests; access jsonb;
begin
 select j0.* into j from fmat.jobs j0
 join fmat.photon_inbox i0 on j0.dedupe_key='photon-ingress:'||i0.id::text and j0.kind='photon_ingress'
 join fmat.photon_links l0 on l0.id=i0.link_id
 where i0.project_id=p_project_id and i0.processed_at is null
  and ((j0.status='pending' and j0.available_at<=clock_timestamp()) or (j0.status='running' and j0.lease_until<=clock_timestamp()))
  and not exists(select 1 from fmat.photon_inbox prior where prior.project_id=i0.project_id
   and prior.line=i0.line and prior.space_id=i0.space_id and prior.link_id is not null
   and prior.processed_at is null and prior.received_order<i0.received_order)
  and not exists(select 1 from fmat.conversation_scopes cs join fmat.runtime_messages rm on rm.conversation_id=cs.id
   where cs.host_id=l0.host_id and cs.audience in ('host_setup','host_private') and rm.status='pending')
 order by i0.received_order limit 1 for update of j0 skip locked;
 if not found then return jsonb_build_object('outcome','idle'); end if;
 select * into strict i from fmat.photon_inbox where id=(j.payload->>'inboxId')::uuid;
 select * into strict l from fmat.photon_links where id=i.link_id;
 credential:=jsonb_build_object('kind','photon','linkId',l.id,'inboxId',i.id,'receiverId',i.receiver_id);
 begin
  command:=lower(btrim(i.text));
  navigation:=command='setup' or command~'^request([[:space:]]|$)';
  target:=case when navigation then null else l.selected_request_id end;
  -- Request locks precede host/FK locks, including first-scope creation.
  if target is not null then perform 1 from fmat.requests where id=target for update;end if;
  if navigation and command~'^request[[:space:]]+[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
   select * into chosen from fmat.requests where id=(regexp_replace(command,'^request[[:space:]]+',''))::uuid
    and host_id=l.host_id for update;
  end if;
  -- Navigation uses setup authority without appending to its transcript.
  insert into fmat.conversation_scopes(host_id,request_id,audience)
   values(l.host_id,target,case when target is null then 'host_setup' else 'host_private' end) on conflict do nothing;
  select * into strict s from fmat.conversation_scopes where host_id=l.host_id
   and request_id is not distinct from target and audience=case when target is null then 'host_setup' else 'host_private' end;
  -- Runtime admission normally takes this advisory lock before the request.
  -- Never wait for it while holding a request: roll back this inner attempt
  -- and let its existing runtime owner finish, then retry the same receipt.
  if not pg_try_advisory_xact_lock(hashtextextended('runtime:'||s.id::text,0)) then raise exception 'CONVERSATION_BUSY';end if;
  perform fmat.photon_execution_actor(credential);
  insert into fmat.conversation_grants(conversation_id,actor_kind,authority_key,credential,expires_at)
   values(s.id,'host','photon:'||i.id::text,credential,i.received_at+interval '1 hour')
   on conflict(conversation_id,actor_kind,authority_key) do nothing;
  select * into strict g from fmat.conversation_grants where conversation_id=s.id and actor_kind='host' and authority_key='photon:'||i.id::text;
  update fmat.photon_inbox set conversation_id=s.id,execution_grant_id=g.id where id=i.id;
  access:=public.fmat_conversation_check(g.id,s.id);
  if navigation or command='review' or (access->>'readOnly')::boolean then
   perform fmat.conversation_budget_charge('host',l.host_id);
   -- The quota lock may have waited; revalidate all time-based authority.
   perform public.fmat_conversation_check(g.id,s.id);
   if command='review' then
    notice:=case when target is null then 'Select a request first: ask to list your requests and send its exact request command.' else fmat.photon_proposal_review(i.id) end;
   elsif command='setup' then
    update fmat.photon_links set selected_request_id=null where id=l.id;
    notice:='You are back in host setup. Your next messages stay in setup. Ask to list your requests when you want to select a meeting.';
   elsif navigation then
    if chosen.id is not null and chosen.status not in ('booked','declined','withdrawn','expired')
     and (chosen.status='booking' or chosen.expires_at>clock_timestamp()) then
     update fmat.photon_links set selected_request_id=chosen.id where id=l.id;
     notice:='Selected request '||chosen.id::text||': '||to_jsonb(left(coalesce(chosen.details->>'purpose','Meeting request'),200))::text||
      E'.
Your next messages stay private to this request. Reply "setup" to return to setup. Selection is not approval.';
    else
     notice:='That request could not be selected. Your conversation is unchanged. Ask to list your requests and reply with an exact "request <reference>" choice, or reply "setup".';
    end if;
   else
    notice:=fmat.photon_scoped_reply(s.id,'This request is closed. Open your host workspace for its current status. Reply "setup", then ask to list another request.');
   end if;
   insert into fmat.photon_replies(inbox_id,project_id,text) values(i.id,i.project_id,notice) on conflict(inbox_id) do nothing;
  else
   accepted:=public.fmat_runtime_message('accept',g.id,s.id,jsonb_build_object('clientId',i.id,'text',i.text));
   update fmat.runtime_messages set next_dispatch_at=clock_timestamp() where id=(accepted->>'id')::uuid and status='pending';
  end if;
  outcome:='accepted';
 exception when raise_exception then
  if sqlerrm='CONVERSATION_RATE_LIMIT' then
   update fmat.jobs set status='pending',available_at=clock_timestamp()+interval '1 minute',
    lease_token=null,lease_until=null,worker_id=null,last_error='CONVERSATION_RATE_LIMIT',updated_at=clock_timestamp() where id=j.id;
   return jsonb_build_object('outcome','busy');
  elsif sqlerrm='CONVERSATION_BUSY' then return jsonb_build_object('outcome','busy');
  elsif sqlerrm in ('UNAUTHORIZED','NOT_FOUND','HOST_NOT_ADMITTED') then outcome:='revoked';
  elsif sqlerrm='CONVERSATION_LIMIT' then outcome:='limited';
  else raise; end if;
 end;
 update fmat.photon_inbox set processed_at=clock_timestamp(),processing_outcome=outcome,
  runtime_message_id=case when outcome='accepted' then (accepted->>'id')::uuid else null end where id=i.id;
 update fmat.jobs set status='complete',lease_token=null,lease_until=null,worker_id=null,last_error=null,
  result=jsonb_build_object('outcome',outcome),updated_at=clock_timestamp() where id=j.id;
 for publication in select message_id from fmat.queue_publications where job_id=j.id and acknowledged_at is null loop
  perform pgmq.archive('fmat_jobs',publication.message_id);
 end loop;
 update fmat.queue_publications set acknowledged_at=clock_timestamp() where job_id=j.id and acknowledged_at is null;
 return jsonb_build_object('outcome',outcome);
end;
$function$;

ALTER TABLE "fmat"."photon_proposal_reviews"
  ADD CONSTRAINT "photon_proposal_reviews_inbox_id_fkey" FOREIGN KEY (inbox_id) REFERENCES fmat.photon_inbox(id);

ALTER TABLE "fmat"."photon_proposal_reviews"
  ADD CONSTRAINT "photon_proposal_reviews_link_id_fkey" FOREIGN KEY (link_id) REFERENCES fmat.photon_links(id);

ALTER TABLE "fmat"."photon_proposal_reviews"
  ADD CONSTRAINT "photon_proposal_reviews_request_id_fkey" FOREIGN KEY (request_id) REFERENCES fmat.requests(id);

ALTER TABLE "fmat"."photon_proposal_reviews"
  ADD CONSTRAINT "photon_proposal_reviews_request_id_proposal_version_fkey" FOREIGN KEY (request_id, proposal_version) REFERENCES fmat.proposals(request_id, VERSION);

CREATE INDEX photon_proposal_reviews_link_idx ON fmat.photon_proposal_reviews USING btree (link_id);

CREATE INDEX photon_proposal_reviews_request_idx ON fmat.photon_proposal_reviews USING btree (request_id, proposal_version);

CREATE TRIGGER photon_proposal_reviews_immutable
  BEFORE UPDATE ON fmat.photon_proposal_reviews
  FOR EACH ROW
  EXECUTE FUNCTION fmat.reject_candidate_evaluation_update();

REVOKE ALL ON FUNCTION "fmat"."photon_proposal_review"(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."photon_proposal_review_check"(uuid, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."photon_proposal_state"(uuid) FROM PUBLIC;
