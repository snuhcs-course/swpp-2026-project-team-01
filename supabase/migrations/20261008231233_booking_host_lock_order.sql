SET local check_function_bodies = off;

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
    if v_request.status not in ('negotiating','awaiting_approval') or v_request.expires_at<=clock_timestamp() then raise exception 'REQUEST_CLOSED'; end if;
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
    -- Match worker request -> host -> attempt -> reservation ordering.
    select * into strict v_host from fmat.hosts where id=v_request.host_id for update;
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
          and (j.status='pending' or (j.status='running' and j.lease_until>clock_timestamp()))) then raise exception 'JOB_STILL_ACTIVE'; end if;
        update fmat.booking_attempts set phase='blocked',reason='operator_retired_undispatched',updated_at=now() where id=v_attempt.id;
        delete from fmat.host_reservations where attempt_id=v_attempt.id;
        if v_request.status in ('booked','withdrawn','declined','expired') or v_request.expires_at<=clock_timestamp() then
          if v_request.expires_at<=clock_timestamp() and v_request.status='booking' then
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
      if v_request.status in ('booked','withdrawn','declined','expired') or v_request.expires_at<=clock_timestamp()
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
  -- Keep retained worker commands consistent with the current worker/evaluator:
  -- job -> request -> host -> attempt -> reservation. Never hold an attempt
  -- while waiting for the host that another request's worker already owns.
  select * into strict v_host from fmat.hosts where id=v_request.host_id for update;
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

  if exists(select 1 from fmat.web_approval_decisions where approval_id=v_attempt.approval_id) then raise exception 'FORBIDDEN';end if;
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

