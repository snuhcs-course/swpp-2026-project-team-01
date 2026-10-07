SET local check_function_bodies = off;

CREATE TABLE "fmat"."booking_dispatches" (
  "attempt_id"    uuid                     NOT NULL,
  "job_id"        uuid                     NOT NULL,
  "lease_token"   uuid                     NOT NULL,
  "evaluation_id" uuid                     NOT NULL,
  "check_id"      uuid                     NOT NULL,
  "dispatched_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "booking_dispatches_pkey" PRIMARY KEY (attempt_id)
);

ALTER TABLE "fmat"."booking_dispatches"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.booking_command (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_request fmat.requests; v_host fmat.hosts; v_proposal fmat.proposals; v_attempt fmat.booking_attempts;
  v_job fmat.jobs; v_connection fmat.calendar_connections; v_approval_id uuid; v_id uuid; v_outcome text; v_recipient jsonb; v_outbox_id uuid;
  v_job_request_id uuid; v_existing_attempt_id uuid;
begin
  perform fmat.booking_authorize(p_operation,p_actor,p_input);
  if p_operation='host_approve' then
    v_request:=fmat.require_request(p_actor,(p_input->>'requestId')::uuid);
    select * into strict v_request from fmat.requests where id=v_request.id for update;
    if p_actor->>'confirmationSource' is distinct from 'authenticated_web' or (p_input->>'confirmed')::boolean is distinct from true then raise exception 'HUMAN_CONFIRMATION_REQUIRED'; end if;
    if v_request.revision is distinct from (p_input->>'expectedRevision')::integer then raise exception 'STALE_REVISION'; end if;
    if v_request.status not in ('negotiating','awaiting_approval') or v_request.expires_at<=now() then raise exception 'REQUEST_CLOSED'; end if;
    if v_request.current_proposal_version is null or v_request.current_proposal_version is distinct from (p_input->>'proposalVersion')::integer
      or v_request.requester_agreed_version is distinct from v_request.current_proposal_version then raise exception 'PROPOSAL_STALE'; end if;
    select * into strict v_proposal from fmat.proposals where request_id=v_request.id and version=v_request.current_proposal_version;
    if v_request.contact_verified_email is distinct from lower(v_proposal.details->>'requesterEmail') then raise exception 'CONTACT_NOT_VERIFIED'; end if;
    if exists(select 1 from fmat.booking_attempts where request_id=v_request.id and phase not in ('blocked','noncreating')) then raise exception 'BOOKING_UNCERTAIN'; end if;
    update fmat.requests set host_approved_version=current_proposal_version,status='booking',revision=revision+1,updated_at=now() where id=v_request.id returning * into v_request;
    insert into fmat.host_approvals(request_id,proposal_version,host_id,source,approved_revision)
      values(v_request.id,v_request.current_proposal_version,v_request.host_id,'authenticated_web',v_request.revision) returning id into v_approval_id;
    v_id:=fmat.prepare_booking(v_request,v_approval_id);
    insert into fmat.request_history(request_id,revision,operation,actor,proposal_version) values(v_request.id,v_request.revision,p_operation,p_actor-'tokenHash',v_request.current_proposal_version);
    perform fmat.audit(p_operation,p_actor,v_request.id::text,jsonb_build_object('proposalVersion',v_request.current_proposal_version,'attemptId',v_id));
    return fmat.request_view(v_request.id,p_actor);
  elsif p_operation in ('booking_retry','booking_reconcile') then
    select * into v_request from fmat.requests where id=(p_input->>'requestId')::uuid for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    select * into v_attempt from fmat.booking_attempts where request_id=v_request.id order by created_at desc limit 1 for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if p_operation='booking_reconcile' then
      if v_attempt.phase not in ('dispatched','uncertain','conflict') then raise exception 'BOOKING_TERMINAL'; end if;
      if v_attempt.phase='conflict' then update fmat.booking_attempts set phase='uncertain',updated_at=now() where id=v_attempt.id; end if;
      perform fmat.enqueue_job('booking_reconcile','operator-reconcile:'||v_attempt.id::text||':'||(p_input->>'idempotencyKey'),jsonb_build_object('requestId',v_request.id,'attemptId',v_attempt.id));
    else
      if v_attempt.phase='prepared' then
        -- A worker may have died after reserving a host or exhausted retries while
        -- another attempt owns the host. Retirement is safe only before dispatch.
        if v_attempt.dispatched_at is not null or v_attempt.provider_evidence is not null then raise exception 'BOOKING_UNCERTAIN'; end if;
        if exists(select 1 from fmat.jobs j where j.payload->>'attemptId'=v_attempt.id::text and j.kind in ('booking','booking_reconcile')
          and (j.status='pending' or (j.status='running' and j.lease_until>now()))) then raise exception 'JOB_STILL_ACTIVE'; end if;
        update fmat.booking_attempts set phase='blocked',reason='operator_retired_undispatched',updated_at=now() where id=v_attempt.id;
        delete from fmat.host_reservations where attempt_id=v_attempt.id;
        if v_request.status in ('booked','withdrawn','declined','expired') or v_request.expires_at<=now() then
          if v_request.expires_at<=now() and v_request.status='booking' then
            update fmat.requests set status='expired',token_revoked_at=now(),requester_agreed_version=null,host_approved_version=null,revision=revision+1,updated_at=now() where id=v_request.id;
          end if;
          perform fmat.audit('booking_retire',p_actor,v_request.id::text,jsonb_build_object('attemptId',v_attempt.id,'reason','request_closed'));
          return jsonb_build_object('ok',true,'retired',true,'attemptId',v_attempt.id);
        end if;
        -- Lock the host while deciding whether the original approval still permits
        -- recreation. Invalid prerequisites commit retirement without a failed
        -- prepare rolling back the reservation release.
        select * into strict v_host from fmat.hosts where id=v_request.host_id for share;
        select * into v_connection from fmat.calendar_connections where id=v_attempt.connection_id for share;
        select * into v_proposal from fmat.proposals where request_id=v_request.id and version=v_request.current_proposal_version;
        if v_request.status<>'booking' or v_request.revision<>v_attempt.expected_revision
          or v_request.current_proposal_version is distinct from v_attempt.proposal_version
          or v_request.host_approved_version is distinct from v_attempt.proposal_version
          or v_request.requester_agreed_version is distinct from v_attempt.proposal_version
          or not fmat.host_ready(v_host) or v_host.rules_version<>v_attempt.rules_version
          or v_proposal.rules_version is distinct from v_host.rules_version
          or v_host.booking_calendar_id is distinct from v_attempt.calendar_id
          or v_request.contact_verified_email is distinct from lower(v_proposal.details->>'requesterEmail')
          or v_connection.id is null or v_connection.revoked_at is not null or v_connection.provider_subject is distinct from v_attempt.connection_provider_subject then
          update fmat.requests set status='negotiating',candidates='[]',private_diagnostics='[]',private_travel_checks='[]',current_proposal_version=null,
            requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,revision=revision+1,updated_at=now() where id=v_request.id;
          perform fmat.audit('booking_retire',p_actor,v_request.id::text,jsonb_build_object('attemptId',v_attempt.id,'reason','prerequisites_changed'));
          return jsonb_build_object('ok',true,'retired',true,'attemptId',v_attempt.id,'nextAction','review_proposal');
        end if;
      elsif v_attempt.phase not in ('blocked','noncreating') then raise exception 'BOOKING_UNCERTAIN'; end if;
      if v_request.status in ('booked','withdrawn','declined','expired') or v_request.expires_at<=now()
        or v_request.host_approved_version is distinct from v_request.current_proposal_version or v_request.requester_agreed_version is distinct from v_request.current_proposal_version then raise exception 'PROPOSAL_STALE'; end if;
      select id into v_approval_id from fmat.host_approvals where request_id=v_request.id and proposal_version=v_request.current_proposal_version order by created_at desc limit 1;
      if v_approval_id is null then raise exception 'HUMAN_CONFIRMATION_REQUIRED'; end if;
      delete from fmat.host_reservations where attempt_id=v_attempt.id;
      update fmat.requests set status='booking',revision=revision+1,updated_at=now() where id=v_request.id returning * into v_request;
      v_id:=fmat.prepare_booking(v_request,v_approval_id);
    end if;
    perform fmat.audit(p_operation,p_actor,v_request.id::text,jsonb_build_object('priorAttemptId',v_attempt.id,'newAttemptId',v_id));
    return jsonb_build_object('ok',true);
  end if;

  v_job:=fmat.require_job_lease(p_actor,(p_input->>'jobId')::uuid,(p_input->>'leaseToken')::uuid);
  v_job_request_id:=(v_job.payload->>'requestId')::uuid;
  select * into v_request from fmat.requests where id=v_job_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_attempt from fmat.booking_attempts where id=(v_job.payload->>'attemptId')::uuid and request_id=v_request.id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  -- A request/attempt lock can outlive the lease acquired above.
  perform fmat.require_job_lease(p_actor,v_job.id,v_job.lease_token);
  if p_operation='booking_load' then
    if (p_input->>'requestId')::uuid is distinct from v_request.id then raise exception 'FORBIDDEN'; end if;
    if v_attempt.phase='prepared' then
      insert into fmat.host_reservations(host_id,attempt_id) values(v_attempt.host_id,v_attempt.id) on conflict(host_id) do nothing;
      select attempt_id into v_existing_attempt_id from fmat.host_reservations where host_id=v_attempt.host_id for update;
      if v_existing_attempt_id<>v_attempt.id then raise exception 'HOST_BUSY'; end if;
    end if;
    -- Reservation contention can also consume the remaining lease.
    perform fmat.require_job_lease(p_actor,v_job.id,v_job.lease_token);
    return fmat.booking_snapshot(v_attempt);
  end if;
  if (p_input->>'attemptId')::uuid is distinct from v_attempt.id then raise exception 'FORBIDDEN'; end if;
  if p_operation='booking_dispatch' then
    if v_attempt.phase<>'prepared' then return jsonb_build_object('dispatched',false); end if;
    if v_request.status<>'booking' or v_request.expires_at<=now() or v_request.revision<>v_attempt.expected_revision
      or v_request.revision is distinct from (p_input->>'expectedRevision')::integer then raise exception 'STALE_REVISION'; end if;
    if v_request.current_proposal_version<>v_attempt.proposal_version or v_request.requester_agreed_version is distinct from v_attempt.proposal_version
      or v_request.host_approved_version is distinct from v_attempt.proposal_version then raise exception 'PROPOSAL_STALE'; end if;
    select * into strict v_host from fmat.hosts where id=v_attempt.host_id for share;
    select * into v_connection from fmat.calendar_connections where id=v_attempt.connection_id for share;
    if not fmat.host_ready(v_host) or v_host.booking_calendar_id is distinct from v_attempt.calendar_id
      or v_connection.id is null or v_connection.principal_kind<>'host' or v_connection.principal_id<>v_host.id or v_connection.revoked_at is not null
      or v_connection.provider_subject is distinct from v_attempt.connection_provider_subject then raise exception 'RECONNECT_REQUIRED'; end if;
    if v_connection.updated_at is distinct from (p_input->>'connectionUpdatedAt')::timestamptz
      or v_connection.provider_subject is distinct from p_input->>'providerSubject' then raise exception 'FEASIBILITY_STALE'; end if;
    if v_host.rules_version<>v_attempt.rules_version or v_host.rules_version is distinct from (p_input->>'rulesVersion')::integer
      or v_attempt.connection_id is distinct from (p_input->>'connectionId')::uuid or v_attempt.starts_at<=now() then raise exception 'FEASIBILITY_STALE'; end if;
    if v_request.contact_verified_email is distinct from lower(v_attempt.payload->'attendees'->0->>'email')
      and not exists(select 1 from jsonb_array_elements(v_attempt.payload->'attendees') a where a->>'email'=v_request.contact_verified_email) then raise exception 'CONTACT_NOT_VERIFIED'; end if;
    if (p_input->'feasibility'->>'valid')::boolean is distinct from true or (p_input->'feasibility'->>'checkedAt')::timestamptz is null
      or (p_input->'feasibility'->>'checkedAt')::timestamptz<now()-interval '30 seconds'
      or (p_input->'feasibility'->>'checkedAt')::timestamptz>now()+interval '5 seconds' then raise exception 'FEASIBILITY_STALE'; end if;
    if not exists(select 1 from fmat.host_reservations where host_id=v_attempt.host_id and attempt_id=v_attempt.id) then raise exception 'HOST_BUSY'; end if;
    if exists(select 1 from fmat.booking_attempts a where a.host_id=v_attempt.host_id and a.phase='confirmed' and a.id<>v_attempt.id
      and a.starts_at-make_interval(mins=>(v_host.rules->>'bufferMinutes')::integer)<v_attempt.ends_at
      and a.ends_at+make_interval(mins=>(v_host.rules->>'bufferMinutes')::integer)>v_attempt.starts_at) then raise exception 'CALENDAR_CONFLICT'; end if;
    -- Recheck after all locks, immediately before the irreversible dispatch cutoff.
    perform fmat.require_job_lease(p_actor,v_job.id,v_job.lease_token);
    if v_request.expires_at<=clock_timestamp() or v_attempt.starts_at<=clock_timestamp()
      or (p_input->'feasibility'->>'checkedAt')::timestamptz<clock_timestamp()-interval '30 seconds'
      then raise exception 'FEASIBILITY_STALE'; end if;
    -- Rebuilt web approvals must consume saved lease-bound evidence through
    -- fmat_booking_dispatch; a caller-supplied feasibility flag is insufficient.
    if exists(select 1 from fmat.web_approval_decisions where approval_id=v_attempt.approval_id) then raise exception 'FEASIBILITY_STALE';end if;
    update fmat.booking_attempts set phase='dispatched',dispatched_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_attempt.id;
    perform fmat.audit(p_operation,p_actor,v_attempt.id::text);
    return jsonb_build_object('dispatched',true);
  end if;

  v_outcome:=p_input->>'outcome';
  if v_attempt.phase='confirmed' then
    if v_outcome='confirmed' then return jsonb_build_object('ok',true); end if;
    raise exception 'BOOKING_TERMINAL';
  end if;
  if v_outcome='blocked' then
    if v_attempt.phase<>'prepared' then raise exception 'BOOKING_UNCERTAIN'; end if;
    update fmat.booking_attempts set phase='blocked',reason=left(p_input->>'reason',100),updated_at=now() where id=v_attempt.id;
    delete from fmat.host_reservations where attempt_id=v_attempt.id;
    if v_request.status='booking' then update fmat.requests set status='awaiting_approval',revision=revision+1,updated_at=now() where id=v_request.id; end if;
  elsif v_outcome='noncreating' then
    if v_attempt.phase<>'dispatched' then raise exception 'BOOKING_UNCERTAIN'; end if;
    if coalesce(p_input->>'reason','') not in ('provider_rejected','permission_denied','calendar_not_found','invalid_event','invalid_request','provider_bad_request','calendar_insert_rejected') then raise exception 'INVALID_PROVIDER_EVIDENCE'; end if;
    update fmat.booking_attempts set phase='noncreating',reason=left(p_input->>'reason',100),updated_at=now() where id=v_attempt.id;
    delete from fmat.host_reservations where attempt_id=v_attempt.id;
    if v_request.status='booking' then update fmat.requests set status='awaiting_approval',revision=revision+1,updated_at=now() where id=v_request.id; end if;
  elsif v_outcome in ('uncertain','conflict') then
    if v_attempt.phase not in ('dispatched','uncertain','conflict') then raise exception 'INVALID_PROVIDER_EVIDENCE'; end if;
    update fmat.booking_attempts set phase=v_outcome,reason=left(p_input->>'reason',100),reconciliation_count=reconciliation_count+1,updated_at=now() where id=v_attempt.id returning * into v_attempt;
    if v_outcome='uncertain' and v_attempt.reconciliation_count<=20 then
      perform fmat.enqueue_job('booking_reconcile','reconcile:'||v_attempt.id::text||':'||v_attempt.reconciliation_count::text,
        jsonb_build_object('requestId',v_request.id,'attemptId',v_attempt.id),now()+make_interval(secs=>least(3600,(15*power(2,least(v_attempt.reconciliation_count,8)))::integer)));
    end if;
    -- Reservation stays occupied even when the retry budget is exhausted.
  elsif v_outcome='confirmed' then
    if v_attempt.phase not in ('dispatched','uncertain','conflict') then raise exception 'INVALID_PROVIDER_EVIDENCE'; end if;
    if p_input->'evidence'->>'calendarId' is distinct from v_attempt.calendar_id or p_input->'evidence'->>'eventId' is distinct from v_attempt.event_id
      or p_input->'evidence'->>'payloadFingerprint' is distinct from v_attempt.payload_fingerprint then raise exception 'INVALID_PROVIDER_EVIDENCE'; end if;
    if p_input->'evidence'->>'eventUrl' is not null and p_input->'evidence'->>'eventUrl' !~ '^https://www\.google\.com/' then raise exception 'INVALID_PROVIDER_EVIDENCE'; end if;
    update fmat.booking_attempts set phase='confirmed',confirmed_at=now(),provider_evidence=p_input->'evidence',updated_at=now() where id=v_attempt.id;
    update fmat.requests set status='booked',event=jsonb_build_object('id',v_attempt.event_id,'url',p_input->'evidence'->>'eventUrl'),revision=revision+1,updated_at=now() where id=v_request.id;
    insert into fmat.request_history(request_id,revision,operation,actor,proposal_version)
      select id,revision,'booking_confirmed',p_actor-'tokenHash',current_proposal_version from fmat.requests where id=v_request.id;
    delete from fmat.host_reservations where attempt_id=v_attempt.id;
    select * into strict v_host from fmat.hosts where id=v_attempt.host_id;
    for v_recipient in select jsonb_build_object('audience','requester','email',v_request.contact_verified_email)
      union all select jsonb_build_object('audience','host','email',v_host.email)
    loop
      insert into fmat.outbox(dedupe_key,audience,recipient,payload) values('booking-confirmed:'||v_request.id::text||':'||(v_recipient->>'audience'),v_recipient->>'audience',jsonb_build_object('email',v_recipient->>'email'),
        jsonb_build_object('type','booking_confirmed','requestId',v_request.id,'proposalVersion',v_attempt.proposal_version,'eventId',v_attempt.event_id,'eventUrl',p_input->'evidence'->>'eventUrl'))
        on conflict(dedupe_key) do nothing returning id into v_outbox_id;
      if v_outbox_id is not null then perform fmat.enqueue_job('delivery','delivery:'||v_outbox_id::text,jsonb_build_object('outboxId',v_outbox_id)); end if;
    end loop;
  else raise exception 'INVALID_INPUT'; end if;
  perform fmat.audit('booking_'||v_outcome,p_actor,v_attempt.id::text,jsonb_build_object('reason',left(p_input->>'reason',100)));
  return jsonb_build_object('ok',true);
end;
$function$;

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
  v_evaluation fmat.candidate_evaluations; v_evidence jsonb; v_candidate jsonb; v_candidate_key text; v_status text; v_expires timestamptz; v_now timestamptz; v_private_context jsonb;
begin
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
  -- Workers lock their lease first. All evaluation paths then lock request,
  -- host, account and connections; workers take attempt/reservation last.
  if p_booking_lease is not null then
    v_actor:=jsonb_build_object('kind','worker','id',p_booking_lease->>'workerId');
    v_job:=fmat.require_job_lease(v_actor,(p_booking_lease->>'jobId')::uuid,(p_booking_lease->>'leaseToken')::uuid);
    if v_job.kind<>'booking' or v_job.payload->>'requestId' is distinct from p_input->>'requestId' then raise exception 'FORBIDDEN';end if;
  end if;
  select * into v_request from fmat.requests where id=(p_input->>'requestId')::uuid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_booking_lease is null then
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
        and d.result_revision=v_attempt.expected_revision and a.proposal_version=v_attempt.proposal_version)
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

CREATE OR REPLACE FUNCTION public.fmat_booking_dispatch (
  p_lease jsonb,
  p_input jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare j fmat.jobs; r fmat.requests; a fmat.booking_attempts; actor jsonb;
begin
 if jsonb_typeof(p_lease) is distinct from 'object' or not(p_lease ?& array['workerId','jobId','leaseToken'])
  or exists(select 1 from jsonb_object_keys(p_lease) k where k not in ('workerId','jobId','leaseToken'))
  or length(coalesce(p_lease->>'workerId','')) not between 1 and 200
  or jsonb_typeof(p_input) is distinct from 'object' or not(p_input ?& array['requestId','revision','checkId','basis','evaluationId'])
  or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','revision','checkId','basis','evaluationId'))
  then raise exception 'INVALID_INPUT';end if;
 actor:=jsonb_build_object('kind','worker','id',p_lease->>'workerId');
 j:=fmat.require_job_lease(actor,(p_lease->>'jobId')::uuid,(p_lease->>'leaseToken')::uuid);
 if j.kind<>'booking' or j.payload->>'requestId' is distinct from p_input->>'requestId' then raise exception 'FORBIDDEN';end if;
 select * into r from fmat.requests where id=(j.payload->>'requestId')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 -- The request lock serializes attempt transitions. A replay never grants a
 -- second insertion, even if the first positive response was lost.
 select * into a from fmat.booking_attempts where id=(j.payload->>'attemptId')::uuid and request_id=r.id;
 if not found then raise exception 'NOT_FOUND';end if;
 perform fmat.require_job_lease(actor,j.id,j.lease_token);
 if a.phase<>'prepared' then return jsonb_build_object('dispatched',false);end if;
 return fmat.evaluate_availability('booking_dispatch',null,p_input,p_lease);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_booking_dispatch"(jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."booking_dispatches"
  ADD CONSTRAINT "booking_dispatches_attempt_id_fkey" FOREIGN KEY (attempt_id) REFERENCES fmat.booking_attempts(id);

ALTER TABLE "fmat"."booking_dispatches"
  ADD CONSTRAINT "booking_dispatches_evaluation_id_fkey" FOREIGN KEY (evaluation_id) REFERENCES fmat.candidate_evaluations(id);

ALTER TABLE "fmat"."booking_dispatches"
  ADD CONSTRAINT "booking_dispatches_job_id_fkey" FOREIGN KEY (job_id) REFERENCES fmat.jobs(id);

CREATE INDEX booking_dispatches_evaluation_idx ON fmat.booking_dispatches USING btree (evaluation_id);

CREATE INDEX booking_dispatches_job_idx ON fmat.booking_dispatches USING btree (job_id);

CREATE TRIGGER booking_dispatches_immutable
  BEFORE UPDATE ON fmat.booking_dispatches
  FOR EACH ROW
  EXECUTE FUNCTION fmat.reject_candidate_evaluation_update();

REVOKE ALL ON FUNCTION "public"."fmat_booking_dispatch"(jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_booking_dispatch"(jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_booking_dispatch"(jsonb, jsonb) TO "service_role";
