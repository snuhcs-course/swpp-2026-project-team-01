SET local check_function_bodies = off;

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
  v_evaluation fmat.candidate_evaluations; v_evidence jsonb; v_candidate jsonb; v_candidate_key text; v_status text; v_expires timestamptz; v_now timestamptz; v_private_context jsonb; v_agent fmat.oauth_grants; v_agent_authority fmat.oauth_grants;
begin
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
  -- Workers lock their lease first. All evaluation paths then lock request,
  -- host, account and connections; workers take attempt/reservation last.
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

CREATE OR REPLACE FUNCTION fmat.oauth_bound_grant (
  p_grant fmat.oauth_grants
)
  RETURNS fmat.oauth_grants
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_intake fmat.oauth_intakes; v_bound fmat.oauth_grants;
begin
  if p_grant.actor_kind is distinct from 'intake' then return p_grant;end if;
  select * into v_intake from fmat.oauth_intakes where id=p_grant.actor_id for update;
  if not found or v_intake.grant_id is distinct from p_grant.id
    or v_intake.host_id is distinct from p_grant.host_id
    or v_intake.authorization_id is distinct from p_grant.authorization_id
    or v_intake.request_id is null or v_intake.token_hash is null then return null;end if;
  v_bound:=p_grant;v_bound.actor_kind:='guest';v_bound.actor_id:=v_intake.request_id;
  v_bound.request_id:=v_intake.request_id;v_bound.token_hash:=v_intake.token_hash;
  return v_bound;
end$function$;

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
end$function$;

REVOKE ALL ON FUNCTION "fmat"."oauth_bound_grant"(fmat.oauth_grants) FROM PUBLIC;
