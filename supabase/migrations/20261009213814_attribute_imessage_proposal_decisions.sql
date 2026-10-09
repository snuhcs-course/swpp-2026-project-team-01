SET local check_function_bodies = off;

ALTER TABLE "fmat"."host_approvals"
  DROP CONSTRAINT "host_approvals_source_check";

CREATE TABLE "fmat"."photon_proposal_decisions" (
  "review_id"       uuid                     NOT NULL,
  "inbox_id"        uuid                     NOT NULL,
  "request_id"      uuid                     NOT NULL,
  "host_id"         uuid                     NOT NULL,
  "link_id"         uuid                     NOT NULL,
  "operation"       text                     NOT NULL,
  "approval_id"     uuid,
  "result_revision" integer                  NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "photon_proposal_decisions_approval_id_key" UNIQUE (approval_id),
  CONSTRAINT "photon_proposal_decisions_check" CHECK (((operation = 'approve'::text) = (approval_id IS NOT NULL))),
  CONSTRAINT "photon_proposal_decisions_inbox_id_key" UNIQUE (inbox_id),
  CONSTRAINT "photon_proposal_decisions_operation_check" CHECK ((operation = ANY (ARRAY['approve'::text, 'decline'::text]))),
  CONSTRAINT "photon_proposal_decisions_pkey" PRIMARY KEY (review_id),
  CONSTRAINT "photon_proposal_decisions_result_revision_check" CHECK ((result_revision > 0))
);

ALTER TABLE "fmat"."photon_proposal_decisions"
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
    if exists(select 1 from fmat.approval_attributions where approval_id=v_attempt.approval_id) then raise exception 'FEASIBILITY_STALE';end if;
    update fmat.booking_attempts set phase='dispatched',dispatched_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_attempt.id;
    perform fmat.audit(p_operation,p_actor,v_attempt.id::text);
    return jsonb_build_object('dispatched',true);
  end if;

  if exists(select 1 from fmat.approval_attributions where approval_id=v_attempt.approval_id) then raise exception 'FORBIDDEN';end if;
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

CREATE OR REPLACE FUNCTION fmat.commit_host_approval (
  p_request fmat.requests,
  p_actor   jsonb,
  p_source  text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare r fmat.requests:=p_request; actor jsonb:=p_actor; approval uuid; attempt uuid; operation text;
begin
 if p_source is null or p_source not in ('authenticated_web','verified_imessage') or p_actor->>'kind' is distinct from 'host' or p_actor->>'id' is distinct from r.host_id::text then raise exception 'FORBIDDEN';end if;
 operation:=case when p_source='authenticated_web' then 'web_host_approve' else 'imessage_host_approve' end;
   update fmat.requests set host_approved_version=current_proposal_version,status='booking',revision=revision+1,updated_at=clock_timestamp() where id=r.id returning * into r;
   insert into fmat.host_approvals(request_id,proposal_version,host_id,source,approved_revision) values(r.id,r.current_proposal_version,r.host_id,p_source,r.revision) returning id into approval;
   attempt:=fmat.prepare_booking(r,approval);
   insert into fmat.request_history(request_id,revision,operation,actor,proposal_version) values(r.id,r.revision,operation,actor,r.current_proposal_version);
   perform fmat.audit(operation,actor,r.id::text,jsonb_build_object('approvalId',approval,'attemptId',attempt));
 return jsonb_build_object('approvalId',approval,'attemptId',attempt,'revision',r.revision);
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.commit_request_closure (
  p_request   fmat.requests,
  p_actor     jsonb,
  p_scope     text,
  p_operation text,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare r fmat.requests:=p_request; actor jsonb:=p_actor; scope text:=p_scope; state jsonb;
begin
 if p_operation not in ('withdraw','decline') or (p_operation='decline' and actor->>'kind' is distinct from 'host')
  or (p_operation='withdraw' and actor->>'kind' is distinct from 'guest') then raise exception 'FORBIDDEN';end if;
 state:=fmat.request_lifecycle_view(r.id,actor->>'kind');
 if (state->>'closed')::boolean then raise exception 'REQUEST_CLOSED';end if;
 if not (state->>(case when p_operation='decline' then 'canDecline' else 'canWithdraw' end))::boolean then raise exception 'BOOKING_PENDING';end if;
 if (p_input->>'revision')::integer is distinct from r.revision then raise exception 'REVISION_CONFLICT';end if;
 update fmat.booking_attempts set phase='blocked',reason='request_'||p_operation||'_before_dispatch',updated_at=clock_timestamp()
  where request_id=r.id and phase='prepared';
 delete from fmat.host_reservations where attempt_id in(select id from fmat.booking_attempts where request_id=r.id and phase='blocked');
 update fmat.requests set status=case when p_operation='withdraw' then 'withdrawn' else 'declined' end,
  token_revoked_at=clock_timestamp(),candidates='[]',candidate_publication_id=null,current_proposal_version=null,
  requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,
  availability_check_id=null,availability_check_started_at=null,revision=revision+1,updated_at=clock_timestamp()
  where id=r.id returning * into r;
 insert into fmat.request_closures(request_id,actor_scope,key,operation,input,result_revision) values(r.id,scope,(p_input->>'idempotencyKey')::uuid,p_operation,p_input,r.revision);
 insert into fmat.request_history(request_id,revision,operation,actor,proposal_version) values(r.id,r.revision,'request_'||p_operation,actor,null);
 perform fmat.audit('request_'||p_operation,actor,r.id::text);
 return fmat.request_lifecycle_view(r.id,actor->>'kind');
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.delivery_command (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_job fmat.jobs; v_outbox fmat.outbox; v_challenge fmat.contact_challenges; v_request fmat.requests; v_outcome text; v_inactive boolean:=false;
begin
  perform fmat.delivery_authorize(p_actor);
  select * into v_job from fmat.jobs where id=(p_input->>'jobId')::uuid for update;
  if not found or v_job.status<>'running' or v_job.worker_id is distinct from p_actor->>'id'
    or v_job.lease_token is distinct from (p_input->>'leaseToken')::uuid or v_job.lease_until<=now()
    or v_job.payload->>'outboxId' is distinct from p_input->>'outboxId' or v_job.kind not in ('contact_delivery','delivery') then raise exception 'LEASE_LOST'; end if;
  select * into v_outbox from fmat.outbox where id=(p_input->>'outboxId')::uuid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_outbox.payload->>'type'='booking_confirmed' and exists(select 1 from fmat.approval_attributions where request_id=(v_outbox.payload->>'requestId')::uuid) then raise exception 'FORBIDDEN';end if;
  if v_outbox.payload->>'kind' in ('contact_verification','contact_recovery') then
    select * into v_challenge from fmat.contact_challenges where id=(v_outbox.payload->>'challengeId')::uuid;
    select * into v_request from fmat.requests where id=v_challenge.request_id;
    if v_outbox.status not in ('sent','suppressed') and (v_challenge.id is null or v_challenge.consumed_at is not null or v_challenge.expires_at<=now()
      or v_request.id is null or v_request.status in ('booked','declined','withdrawn','expired') or v_request.expires_at<=now()
      or v_challenge.email is distinct from v_request.details->>'requesterEmail' or v_outbox.recipient->>'email' is distinct from v_challenge.email) then
      v_inactive:=true;
      update fmat.outbox set status=case when payload ? 'firstDispatchAt' then 'uncertain' else 'suppressed' end,updated_at=now(),payload=payload||jsonb_build_object('errorCode','CONTACT_EXPIRED') where id=v_outbox.id returning * into v_outbox;
    end if;
  end if;
  case p_operation
  when 'delivery_load' then null;
  when 'delivery_dispatch' then
    if not v_inactive and v_outbox.status not in ('sent','suppressed','failed') then
      if v_outbox.payload ? 'firstDispatchAt' and (v_outbox.payload->>'firstDispatchAt')::timestamptz<now()-interval '24 hours' then raise exception 'DELIVERY_RECONCILIATION_REQUIRED'; end if;
      if not(v_outbox.payload ? 'firstDispatchAt') and (length(coalesce(p_input->>'encryptedPrepared',''))<20 or length(coalesce(p_input->>'providerInboxId','')) not between 1 and 300) then raise exception 'INVALID_INPUT'; end if;
      update fmat.outbox set status='sending',updated_at=now(),payload=payload||jsonb_build_object('firstDispatchAt',coalesce(payload->>'firstDispatchAt',now()::text),'encryptedPrepared',coalesce(payload->>'encryptedPrepared',p_input->>'encryptedPrepared'),'providerInboxId',coalesce(payload->>'providerInboxId',p_input->>'providerInboxId')) where id=v_outbox.id returning * into v_outbox;
    end if;
  when 'delivery_record' then
    v_outcome:=p_input->>'outcome';
    if v_outcome not in ('sent','uncertain','failed','suppressed') or v_outcome is null or length(coalesce(p_input->>'providerReference',''))>500 or length(coalesce(p_input->>'errorCode',''))>100 then raise exception 'INVALID_INPUT'; end if;
    if not v_inactive and v_outbox.status not in ('sent','suppressed') then
      if v_outcome in ('sent','uncertain') and not(v_outbox.payload ? 'firstDispatchAt') then raise exception 'INVALID_INPUT'; end if;
      update fmat.outbox set status=v_outcome,provider_reference=p_input->>'providerReference',updated_at=now(),payload=payload||jsonb_build_object('errorCode',p_input->>'errorCode') where id=v_outbox.id returning * into v_outbox;
    end if;
  else raise exception 'UNKNOWN_OPERATION'; end case;
  return jsonb_build_object('actionable',not v_inactive,'id',v_outbox.id,'dedupeKey',v_outbox.dedupe_key,'status',v_outbox.status,'recipientEmail',v_outbox.recipient->>'email','payload',v_outbox.payload,'firstDispatchAt',v_outbox.payload->>'firstDispatchAt','providerReference',v_outbox.provider_reference,'encryptedPrepared',v_outbox.payload->>'encryptedPrepared','providerInboxId',v_outbox.payload->>'providerInboxId');
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
      or not exists(select 1 from fmat.approval_attributions d join fmat.host_approvals a on a.id=d.approval_id
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

CREATE OR REPLACE FUNCTION fmat.photon_proposal_decide (
  p_inbox uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare i fmat.photon_inbox; access jsonb; state jsonb; r fmat.requests; review fmat.photon_proposal_reviews;
 prior fmat.photon_proposal_decisions; command text; operation text; ref uuid; approval uuid; result jsonb; reply text;
begin
 select * into i from fmat.photon_inbox where id=p_inbox;
 if not found then raise exception 'UNAUTHORIZED';end if;
 access:=public.fmat_conversation_check(i.execution_grant_id,i.conversation_id);
 if not exists(select 1 from fmat.conversation_grants where id=i.execution_grant_id and credential->>'kind'='photon'
   and credential->>'inboxId'=i.id::text) then raise exception 'FORBIDDEN';end if;
 command:=lower(btrim(i.text));
 if access->>'audience' is distinct from 'host_private' then return 'Select a request and send "review" before making a proposal decision.';end if;
 if command !~ '^(approve|decline)[[:space:]]+[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
  return fmat.photon_scoped_reply(i.conversation_id,'No decision was recorded. Send "review", read the complete proposal, then use its exact approve or decline command.');
 end if;
 -- Accept any whitespace in the authored command boundary, never prose.
 operation:=substring(command from '^(approve|decline)');
 ref:=regexp_replace(command,'^(approve|decline)[[:space:]]+','')::uuid;
 select * into strict r from fmat.requests where id=(access->>'requestId')::uuid for update;
 select * into review from fmat.photon_proposal_reviews where id=ref;
 if review.id is null or review.link_id is distinct from i.link_id or review.receiver_id is distinct from i.receiver_id or review.request_id is distinct from r.id then raise exception 'REVISION_CONFLICT';end if;
 select * into prior from fmat.photon_proposal_decisions where review_id=ref;
 if prior.review_id is not null then
  if prior.operation<>operation or prior.link_id is distinct from i.link_id or prior.host_id::text is distinct from access->'actor'->>'id' then raise exception 'REVISION_CONFLICT';end if;
  return fmat.photon_scoped_reply(i.conversation_id,'Your '||operation||' decision was already recorded. Current request status: '||(fmat.request_lifecycle_view(r.id,'host')->>'status')||'.');
 end if;
 -- A reference is attributable only after the original authored text crossed
 -- the provider boundary. Its nonce is never available to the model.
 if not exists(select 1 from fmat.photon_replies where inbox_id=review.inbox_id and status in ('accepted','delivered','uncertain')) then raise exception 'REVISION_CONFLICT';end if;
 state:=fmat.photon_proposal_review_check(i.id,ref);
 if operation='approve' then
  if not (state->>'canApprove')::boolean then raise exception 'REVISION_CONFLICT';end if;
  result:=fmat.commit_host_approval(r,access->'actor','verified_imessage');
  approval:=(result->>'approvalId')::uuid;
  reply:='Approval recorded for proposal '||review.proposal_version||'. Booking is pending; an event is not yet confirmed. Open your host workspace for the current outcome.';
 else
  if not (state->>'canDecline')::boolean then raise exception 'BOOKING_PENDING';end if;
  perform 1 from fmat.booking_attempts where request_id=r.id order by id for update;
  -- Recheck the decision deadline and both grants after possible waits.
  perform fmat.photon_proposal_review_check(i.id,ref);
  result:=fmat.commit_request_closure(r,access->'actor','photon:'||i.link_id::text,'decline',
   jsonb_build_object('requestId',r.id,'revision',r.revision,'confirmed',true,'idempotencyKey',i.id));
  reply:='Declined proposal '||review.proposal_version||'. This request is closed and no booking was created by this decision.';
 end if;
 insert into fmat.photon_proposal_decisions(review_id,inbox_id,request_id,host_id,link_id,operation,approval_id,result_revision)
 values(ref,i.id,r.id,r.host_id,i.link_id,operation,approval,(result->>'revision')::integer);
 return fmat.photon_scoped_reply(i.conversation_id,reply);
exception when raise_exception then
 -- This block rolls back all partial domain effects before the authored reply.
 if sqlerrm in ('REVISION_CONFLICT','REQUEST_CLOSED','BOOKING_PENDING','RECONNECT_REQUIRED','FEASIBILITY_STALE','CONTACT_NOT_VERIFIED','HOST_BUSY') then
  return fmat.photon_scoped_reply(i.conversation_id,'No new decision was recorded. This review is unavailable or has changed. Send "review" again, or open your host workspace for the current status.');
 else raise;end if;
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
 body:=body||case when (state->>'canApprove')::boolean then 'To approve this exact proposal, reply: approve '||review_id::text||E'\n' else 'Approval is unavailable until requester agreement and contact verification are current.'||E'\n' end;
 body:=body||case when (state->>'canDecline')::boolean then 'To decline, reply: decline '||review_id::text||E'\n' else '' end||'Review alone does not approve or book. You can also decide in your host workspace.';
 if length(body)>4000 then return fmat.photon_scoped_reply(i.conversation_id,'This proposal is too long for a complete message. Open your host workspace to review every detail.');end if;
 if (state->>'expiresAt')::timestamptz<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
 insert into fmat.photon_proposal_reviews(id,inbox_id,link_id,receiver_id,request_id,revision,proposal_version,proposal,context_basis,requester_agreed,can_approve,can_decline,text,expires_at)
 values(review_id,i.id,i.link_id,i.receiver_id,(state->>'requestId')::uuid,(state->>'revision')::integer,(state->>'proposalVersion')::integer,p,state->>'contextBasis',
  (state->>'requesterAgreed')::boolean,(state->>'canApprove')::boolean,(state->>'canDecline')::boolean,body,(state->>'expiresAt')::timestamptz);
 return body;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.wake_booking_worker()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare url text; secret text;
begin
 if not exists(select 1 from fmat.jobs j where kind in ('booking','booking_reconcile')
  and ((status='pending' and available_at<=clock_timestamp()) or (status='running' and lease_until<=clock_timestamp()))
  and exists(select 1 from fmat.booking_attempts a join fmat.approval_attributions d on d.approval_id=a.approval_id where a.id::text=j.payload->>'attemptId' and a.request_id::text=j.payload->>'requestId')) then return null;end if;
 select decrypted_secret into url from vault.decrypted_secrets where name='fmat_booking_dispatch_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='fmat_runtime_dispatch_secret';
 if url is null or secret is null then return null;end if;
 if url !~ '^https://[^/]+/api/internal/booking/dispatch$' or secret !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_DISPATCH_CONFIGURATION';end if;
 return net.http_post(url:=url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),body:='{}',timeout_milliseconds:=120000);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_booking_approval (
  p_operation  text,
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare r fmat.requests; actor jsonb; proposal jsonb; context text; blocker text:='none'; approved boolean:=false; agreed boolean:=false;
 prior fmat.web_approval_decisions; approval uuid; attempt uuid; result jsonb; state text;
begin
 if p_operation is null or p_operation not in ('read','approve') or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 if p_credential->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN';end if;
 select * into r from fmat.requests where id=(p_input->>'requestId')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 actor:=fmat.calendar_actor(p_credential);perform fmat.require_request(actor,r.id);
 if p_operation='read' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k<>'requestId') then raise exception 'INVALID_INPUT';end if;
 else
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','revision','proposalVersion','confirmed','idempotencyKey'))
   or p_input->'confirmed' is distinct from 'true'::jsonb or p_input->>'idempotencyKey' is null then raise exception 'INVALID_INPUT';end if;
  select * into prior from fmat.web_approval_decisions where request_id=r.id and host_id=r.host_id and session_id=(p_credential->>'sessionId')::uuid and key=(p_input->>'idempotencyKey')::uuid;
  if prior.approval_id is not null and prior.input is distinct from p_input then raise exception 'IDEMPOTENCY_CONFLICT';end if;
 end if;
 state:=fmat.request_lifecycle_view(r.id,'host')->>'status';
 select details into proposal from fmat.proposals where request_id=r.id and version=r.current_proposal_version;
 approved:=coalesce(r.host_approved_version=r.current_proposal_version,false) and exists(select 1 from fmat.approval_attributions d join fmat.host_approvals a on a.id=d.approval_id where d.request_id=r.id and a.proposal_version=r.current_proposal_version);
 if state in ('booked','withdrawn','declined','expired') then blocker:='closed';proposal:=null;
 elsif state='booking' then blocker:='booking_pending';
 elsif proposal is null then blocker:='proposal_required';
 else
  begin context:=public.fmat_availability_evaluation('current_context',p_credential,jsonb_build_object('requestId',r.id,'revision',r.revision))->>'travelBasis';
  exception when raise_exception then if sqlerrm='RECONNECT_REQUIRED' then blocker:='reconnect_required';else raise;end if;end;
  if blocker='none' then
   if not exists(select 1 from fmat.proposal_evidence where request_id=r.id and proposal_version=r.current_proposal_version and context_basis=context)
    or (proposal->>'start')::timestamptz<=clock_timestamp() or r.token_revoked_at is not null or r.token_expires_at<=clock_timestamp() then blocker:='proposal_stale';
   elsif r.host_availability_failed or (r.availability_mode='calendar' and r.availability_failed) then blocker:='reconnect_required';
   elsif r.requester_agreed_version is distinct from r.current_proposal_version then blocker:='agreement_required';
   elsif r.contact_verified_email is distinct from lower(proposal->>'requesterEmail') then blocker:='contact_verification_required';end if;
  end if;
 end if;
 agreed:=proposal is not null and coalesce(r.requester_agreed_version=r.current_proposal_version,false) and blocker not in ('proposal_stale','reconnect_required');
 if p_operation='approve' then
  if prior.approval_id is not null then
   if prior.result_revision<>r.revision or not approved or state<>'booking' then raise exception 'REVISION_CONFLICT';end if;
  else
   if (p_input->>'revision')::integer is distinct from r.revision or (p_input->>'proposalVersion')::integer is distinct from r.current_proposal_version then raise exception 'REVISION_CONFLICT';end if;
   if blocker='booking_pending' then raise exception 'BOOKING_PENDING';end if;
   if blocker='closed' then raise exception 'REQUEST_CLOSED';end if;
   if blocker='reconnect_required' then raise exception 'RECONNECT_REQUIRED';end if;
   if blocker='contact_verification_required' then raise exception 'CONTACT_NOT_VERIFIED';end if;
   if blocker<>'none' then raise exception 'REVISION_CONFLICT';end if;
   -- Authority/context helpers hold request, host, current Auth session and
   -- connection locks. Check wall-clock validity once more before the write.
   if r.expires_at<=clock_timestamp() then raise exception 'REQUEST_CLOSED';end if;
   if (p_credential->>'expiresAt')::timestamptz<=clock_timestamp() then raise exception 'UNAUTHORIZED';end if;
   result:=fmat.commit_host_approval(r,actor,'authenticated_web');
   approval:=(result->>'approvalId')::uuid;attempt:=(result->>'attemptId')::uuid;
   select * into strict r from fmat.requests where id=r.id;
   insert into fmat.web_approval_decisions(request_id,host_id,session_id,key,input,approval_id,result_revision) values(r.id,r.host_id,(p_credential->>'sessionId')::uuid,(p_input->>'idempotencyKey')::uuid,p_input,approval,r.revision);
   approved:=true;state:='booking';blocker:='booking_pending';
  end if;
 end if;
 return jsonb_build_object('requestId',r.id,'revision',r.revision,'status',state,'proposal',proposal,'requesterAgreed',agreed,'approved',approved,'canApprove',blocker='none','blocker',blocker);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_booking_worker (
  p_operation text,
  p_lease     jsonb,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare j fmat.jobs; r fmat.requests; h fmat.hosts; a fmat.booking_attempts; c fmat.calendar_connections;
 actor jsonb; outcome text; evidence jsonb; recipient jsonb; outbox_id uuid;
begin
 if p_operation is null or p_operation not in ('claim','load','access','refresh','record','complete','retry')
  or jsonb_typeof(p_lease) is distinct from 'object' or jsonb_typeof(p_input) is distinct from 'object'
  or length(coalesce(p_lease->>'workerId','')) not between 1 and 200 then raise exception 'INVALID_INPUT';end if;
 actor:=jsonb_build_object('kind','worker','id',p_lease->>'workerId');
 if p_operation='claim' then
  if p_input<>'{}' or exists(select 1 from jsonb_object_keys(p_lease) k where k<>'workerId') then raise exception 'INVALID_INPUT';end if;
  select * into j from fmat.jobs job where kind in ('booking','booking_reconcile')
   and ((status='pending' and available_at<=clock_timestamp()) or (status='running' and lease_until<=clock_timestamp()))
   and exists(select 1 from fmat.booking_attempts attempt join fmat.approval_attributions decision on decision.approval_id=attempt.approval_id
     where attempt.id::text=job.payload->>'attemptId' and attempt.request_id::text=job.payload->>'requestId')
   order by available_at,created_at,id limit 1 for update skip locked;
  if not found then return jsonb_build_object('job',null);end if;
  if j.attempts>=j.max_attempts then
   update fmat.jobs set status='dead',lease_token=null,lease_until=null,worker_id=null,last_error='RETRY_EXHAUSTED',updated_at=clock_timestamp() where id=j.id;
   perform fmat.audit('booking_job_exhausted',actor,j.id::text);
   return jsonb_build_object('job',null);
  end if;
  update fmat.jobs set status='running',attempts=attempts+1,worker_id=actor->>'id',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp() where id=j.id returning * into j;
  return jsonb_build_object('job',jsonb_build_object('workerId',j.worker_id,'jobId',j.id,'leaseToken',j.lease_token));
 end if;
 if not(p_lease ?& array['jobId','leaseToken']) or exists(select 1 from jsonb_object_keys(p_lease) k where k not in ('workerId','jobId','leaseToken')) then raise exception 'INVALID_INPUT';end if;
 j:=fmat.require_job_lease(actor,(p_lease->>'jobId')::uuid,(p_lease->>'leaseToken')::uuid);
 select * into r from fmat.requests where id=(j.payload->>'requestId')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 select * into h from fmat.hosts where id=r.host_id for update;
 select * into a from fmat.booking_attempts where id=(j.payload->>'attemptId')::uuid and request_id=r.id;
 if not found or not exists(select 1 from fmat.approval_attributions where approval_id=a.approval_id and request_id=r.id and host_id=h.id) then raise exception 'FORBIDDEN';end if;
 if p_operation in ('access','refresh') then
  if a.phase not in ('prepared','dispatched','uncertain','conflict') then raise exception 'BOOKING_UNCERTAIN';end if;
  perform 1 from auth.users where id=h.id for share;
  if h.revoked_at is not null or not exists(select 1 from auth.users where id=h.id and deleted_at is null and email_confirmed_at is not null and (banned_until is null or banned_until<=clock_timestamp())) then raise exception 'RECONNECT_REQUIRED';end if;
  select * into c from fmat.calendar_connections where principal_kind='host' and principal_id=h.id and revoked_at is null for update;
  if not found or c.provider_subject<>a.connection_provider_subject or (a.phase='prepared' and c.id<>a.connection_id)
   or not(c.scopes @> array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events']) then raise exception 'RECONNECT_REQUIRED';end if;
 end if;
 -- All paths share job -> request -> host -> account/connection -> attempt.
 select * into a from fmat.booking_attempts where id=a.id for update;
 perform fmat.require_job_lease(actor,j.id,j.lease_token);
 if p_operation in ('load','access','complete') and p_input<>'{}' then raise exception 'INVALID_INPUT';end if;
 if p_operation='load' then return fmat.booking_snapshot(a);end if;
 if p_operation='access' then
  return jsonb_build_object('hostId',h.id,'connectionId',c.id,'providerSubject',c.provider_subject,'encryptedCredential',c.encrypted_credential);
 elsif p_operation='refresh' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('connectionId','previousCredential','encryptedCredential'))
   or c.id is distinct from (p_input->>'connectionId')::uuid or c.encrypted_credential is distinct from p_input->>'previousCredential' then raise exception 'REVISION_CONFLICT';end if;
  if length(coalesce(p_input->>'encryptedCredential','')) not between 20 and 131072 then raise exception 'INVALID_INPUT';end if;
  update fmat.calendar_connections set encrypted_credential=p_input->>'encryptedCredential',updated_at=clock_timestamp() where id=c.id;
  return jsonb_build_object('refreshed',true);
 elsif p_operation='retry' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k<>'errorCode') or coalesce(p_input->>'errorCode','') not in ('PROVIDER_UNAVAILABLE','RECONNECT_REQUIRED','BOOKING_BUSY','STALE_REVISION','INTERNAL_ERROR') then raise exception 'INVALID_INPUT';end if;
  return fmat.foundation_command('jobs_fail',actor,p_input||jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token));
 elsif p_operation='complete' then
  if a.phase not in ('confirmed','blocked','noncreating') then raise exception 'BOOKING_UNCERTAIN';end if;
  return fmat.foundation_command('jobs_complete',actor,jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'result',jsonb_build_object('outcome',a.phase)));
 end if;
 if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('outcome','reason','evidence')) then raise exception 'INVALID_INPUT';end if;
 outcome:=p_input->>'outcome';evidence:=p_input->'evidence';
 if outcome='blocked' then
  if a.phase<>'prepared' or coalesce(p_input->>'reason','') not in ('checks_conflict','checks_clarification','stale_preconditions','authority_unavailable') then raise exception 'BOOKING_UNCERTAIN';end if;
  update fmat.booking_attempts set phase='blocked',reason=p_input->>'reason',updated_at=clock_timestamp() where id=a.id;
  delete from fmat.host_reservations where attempt_id=a.id;
  if r.status='booking' then
   update fmat.requests set status=case when fmat.details_complete(details) then 'negotiating' else 'gathering' end,revision=revision+1,
    current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,availability_check_id=null,availability_check_started_at=null,updated_at=clock_timestamp() where id=r.id;
  end if;
 else
  if a.phase not in ('dispatched','uncertain','conflict') or not exists(select 1 from fmat.booking_dispatches where attempt_id=a.id) then raise exception 'BOOKING_UNCERTAIN';end if;
  if outcome='noncreating' then
   if a.phase<>'dispatched' or coalesce(p_input->>'reason','') not in ('provider_bad_request','permission_denied','calendar_not_found')
    or not exists(select 1 from fmat.booking_dispatches where attempt_id=a.id and job_id=j.id and lease_token=j.lease_token) then raise exception 'INVALID_PROVIDER_EVIDENCE';end if;
   update fmat.booking_attempts set phase='noncreating',reason=p_input->>'reason',updated_at=clock_timestamp() where id=a.id;
   delete from fmat.host_reservations where attempt_id=a.id;
   update fmat.requests set status='awaiting_approval',revision=revision+1,updated_at=clock_timestamp() where id=r.id;
  elsif outcome in ('uncertain','conflict') then
   if length(coalesce(p_input->>'reason','')) not between 1 and 100 then raise exception 'INVALID_INPUT';end if;
   update fmat.booking_attempts set phase=outcome,reason=p_input->>'reason',reconciliation_count=reconciliation_count+1,updated_at=clock_timestamp() where id=a.id returning * into a;
   if outcome='uncertain' and a.reconciliation_count<=20 then
    perform fmat.enqueue_job('booking_reconcile','reconcile:'||a.id::text||':'||a.reconciliation_count::text,jsonb_build_object('requestId',r.id,'attemptId',a.id),clock_timestamp()+make_interval(secs=>least(3600,(15*power(2,least(a.reconciliation_count,8)))::integer)));
   end if;
  elsif outcome='confirmed' then
   if jsonb_typeof(evidence) is distinct from 'object' or exists(select 1 from jsonb_object_keys(evidence) k where k not in ('calendarId','eventId','payloadFingerprint','eventUrl','etag','organizer'))
    or evidence->>'calendarId' is distinct from a.calendar_id or evidence->>'eventId' is distinct from a.event_id or evidence->>'payloadFingerprint' is distinct from a.payload_fingerprint
    or length(coalesce(evidence->>'etag','')) not between 1 and 1024
    or jsonb_typeof(evidence->'organizer') is distinct from 'object' or coalesce(evidence->'organizer'->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or exists(select 1 from jsonb_object_keys(evidence->'organizer') k where k<>'email')
    or (evidence->>'eventUrl' is not null and evidence->>'eventUrl' !~ '^https://www\.google\.com/calendar/') then raise exception 'INVALID_PROVIDER_EVIDENCE';end if;
   update fmat.booking_attempts set phase='confirmed',confirmed_at=clock_timestamp(),provider_evidence=evidence,updated_at=clock_timestamp() where id=a.id;
   update fmat.requests set status='booked',event=jsonb_build_object('id',a.event_id,'url',evidence->>'eventUrl'),revision=revision+1,updated_at=clock_timestamp() where id=r.id;
   delete from fmat.host_reservations where attempt_id=a.id;
   for recipient in select jsonb_build_object('audience','requester','email',r.contact_verified_email) union all select jsonb_build_object('audience','host','email',h.email) loop
    insert into fmat.outbox(dedupe_key,audience,recipient,payload) values('booking-confirmed:'||r.id::text||':'||(recipient->>'audience'),recipient->>'audience',jsonb_build_object('email',recipient->>'email'),
     jsonb_build_object('type','booking_confirmed','requestId',r.id,'proposalVersion',a.proposal_version,'eventId',a.event_id,'eventUrl',evidence->>'eventUrl')) on conflict(dedupe_key) do nothing returning id into outbox_id;
    if outbox_id is not null then perform fmat.enqueue_job('delivery','delivery:'||outbox_id::text,jsonb_build_object('outboxId',outbox_id));end if;
   end loop;
  else raise exception 'INVALID_INPUT';end if;
 end if;
 insert into fmat.request_history(request_id,revision,operation,actor,proposal_version) select id,revision,'booking_'||outcome,actor,a.proposal_version from fmat.requests where id=r.id;
 perform fmat.audit('booking_'||outcome,actor,a.id::text,jsonb_build_object('reason',p_input->>'reason'));
 -- Outcome, follow-up work and acknowledgment commit together. Expiry rolls
 -- back all local changes, leaving the frozen attempt for another owner.
 perform fmat.foundation_command('jobs_complete',actor,jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'result',jsonb_build_object('outcome',outcome)));
 return jsonb_build_object('recorded',true);
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
 target uuid; command text; notice text; navigation boolean; decision boolean; chosen fmat.requests; access jsonb;
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
  decision:=command~'^(approve|decline)([[:space:]]|$)' or command in ('yes','ok','okay','네','승인','거절');
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
  if navigation or decision or command='review' or (access->>'readOnly')::boolean then
   perform fmat.conversation_budget_charge('host',l.host_id);
   -- The quota lock may have waited; revalidate all time-based authority.
   perform public.fmat_conversation_check(g.id,s.id);
   if decision then
    notice:=fmat.photon_proposal_decide(i.id);
   elsif command='review' then
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

CREATE OR REPLACE FUNCTION public.fmat_request_lifecycle (
  p_operation  text,
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare r fmat.requests; actor jsonb; scope text; prior fmat.request_closures; result jsonb;
begin
 if p_operation is null or p_operation not in ('read','withdraw','decline') or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 if (p_operation='withdraw' and p_credential->>'kind' is distinct from 'guest') or (p_operation='decline' and p_credential->>'kind' is distinct from 'host') then raise exception 'FORBIDDEN';end if;
 select * into r from fmat.requests where id=(p_input->>'requestId')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if p_credential->>'kind'='host' then
  actor:=fmat.calendar_actor(p_credential);perform fmat.require_request(actor,r.id);
  scope:='host:'||(p_credential->>'subject')||':'||(p_credential->>'sessionId');
 elsif p_credential->>'kind'='guest' then
  -- Closure revokes mutation authority but preserves an unexpired, same-token
  -- minimal receipt. Wall-clock checks run after acquiring the request lock.
  if p_credential->>'requestId' is distinct from r.id::text or p_credential->>'tokenHash' is distinct from r.token_hash or r.token_expires_at<=clock_timestamp()
   or (r.token_revoked_at is not null and r.status not in ('booked','declined','withdrawn','expired')) then raise exception 'NOT_FOUND';end if;
  actor:=jsonb_build_object('kind','guest','requestId',r.id);scope:='guest:'||(p_credential->>'tokenHash');
 else raise exception 'UNAUTHORIZED';end if;
 if p_operation='read' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k<>'requestId') then raise exception 'INVALID_INPUT';end if;
  return fmat.request_lifecycle_view(r.id,p_credential->>'kind');
 end if;
 if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','revision','confirmed','idempotencyKey')) or p_input->'confirmed' is distinct from 'true'::jsonb or p_input->>'idempotencyKey' is null then raise exception 'INVALID_INPUT';end if;
 select * into prior from fmat.request_closures where request_id=r.id;
 if prior.request_id is not null and prior.actor_scope=scope and prior.key=(p_input->>'idempotencyKey')::uuid then
  if prior.operation<>p_operation or prior.input is distinct from p_input then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  if prior.result_revision<>r.revision or r.status<>(case when p_operation='withdraw' then 'withdrawn' else 'declined' end) then raise exception 'REVISION_CONFLICT';end if;
  return fmat.request_lifecycle_view(r.id,p_credential->>'kind');
 end if;
 -- Request locking serializes closure with dispatch. Never lock jobs here:
 -- the worker owns its job before waiting for this request.
 perform 1 from fmat.hosts where id=r.host_id for update;
 perform 1 from fmat.booking_attempts where request_id=r.id order by id for update;
 if p_credential->>'kind'='host' then perform fmat.calendar_actor(p_credential);
 elsif r.token_expires_at<=clock_timestamp() then raise exception 'NOT_FOUND';end if;
 result:=fmat.request_lifecycle_view(r.id,p_credential->>'kind');
 if result->>'status'='booking' and not (result->>(case when p_operation='withdraw' then 'canWithdraw' else 'canDecline' end))::boolean then raise exception 'BOOKING_PENDING';end if;
 if (result->>'closed')::boolean then raise exception 'REQUEST_CLOSED';end if;
 if (p_input->>'revision')::integer is distinct from r.revision then raise exception 'REVISION_CONFLICT';end if;
 return fmat.commit_request_closure(r,actor,scope,p_operation,p_input);
end;
$function$;

ALTER TABLE "fmat"."host_approvals"
  ADD CONSTRAINT "host_approvals_source_check" CHECK ((source = ANY (ARRAY['authenticated_web'::text, 'verified_imessage'::text])));

ALTER TABLE "fmat"."photon_proposal_decisions"
  ADD CONSTRAINT "photon_proposal_decisions_approval_id_fkey" FOREIGN KEY (approval_id) REFERENCES fmat.host_approvals(id);

ALTER TABLE "fmat"."photon_proposal_decisions"
  ADD CONSTRAINT "photon_proposal_decisions_host_id_fkey" FOREIGN KEY (host_id) REFERENCES fmat.hosts(id);

ALTER TABLE "fmat"."photon_proposal_decisions"
  ADD CONSTRAINT "photon_proposal_decisions_inbox_id_fkey" FOREIGN KEY (inbox_id) REFERENCES fmat.photon_inbox(id);

ALTER TABLE "fmat"."photon_proposal_decisions"
  ADD CONSTRAINT "photon_proposal_decisions_link_id_fkey" FOREIGN KEY (link_id) REFERENCES fmat.photon_links(id);

ALTER TABLE "fmat"."photon_proposal_decisions"
  ADD CONSTRAINT "photon_proposal_decisions_request_id_fkey" FOREIGN KEY (request_id) REFERENCES fmat.requests(id);

ALTER TABLE "fmat"."photon_proposal_decisions"
  ADD CONSTRAINT "photon_proposal_decisions_review_id_fkey" FOREIGN KEY (review_id) REFERENCES fmat.photon_proposal_reviews(id);

CREATE VIEW "fmat"."approval_attributions" WITH (security_invoker=true) AS  SELECT d.approval_id,
    d.request_id,
    d.host_id,
    d.result_revision
   FROM (fmat.web_approval_decisions d
     JOIN fmat.host_approvals a ON ((a.id = d.approval_id)))
  WHERE ((a.source = 'authenticated_web'::text) AND (a.request_id = d.request_id) AND (a.host_id = d.host_id) AND (a.approved_revision = d.result_revision))
UNION ALL
 SELECT d.approval_id,
    d.request_id,
    d.host_id,
    d.result_revision
   FROM (((fmat.photon_proposal_decisions d
     JOIN fmat.host_approvals a ON ((a.id = d.approval_id)))
     JOIN fmat.photon_proposal_reviews r ON ((r.id = d.review_id)))
     JOIN fmat.photon_inbox i ON ((i.id = d.inbox_id)))
  WHERE ((d.operation = 'approve'::text) AND (a.source = 'verified_imessage'::text) AND (a.request_id = d.request_id) AND (a.host_id = d.host_id) AND (a.approved_revision = d.result_revision) AND (r.request_id = d.request_id) AND (r.proposal_version = a.proposal_version) AND ((r.revision + 1) = d.result_revision) AND r.can_approve AND r.requester_agreed AND (d.created_at <= r.expires_at) AND (r.link_id = d.link_id) AND (i.link_id = d.link_id) AND (i.receiver_id = r.receiver_id));

CREATE INDEX photon_proposal_decisions_host_idx ON fmat.photon_proposal_decisions USING btree (host_id);

CREATE INDEX photon_proposal_decisions_link_idx ON fmat.photon_proposal_decisions USING btree (link_id);

CREATE INDEX photon_proposal_decisions_request_idx ON fmat.photon_proposal_decisions USING btree (request_id);

CREATE TRIGGER photon_proposal_decisions_immutable
  BEFORE UPDATE ON fmat.photon_proposal_decisions
  FOR EACH ROW
  EXECUTE FUNCTION fmat.reject_candidate_evaluation_update();

REVOKE ALL ON FUNCTION "fmat"."commit_host_approval"(fmat.requests, jsonb, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."commit_request_closure"(fmat.requests, jsonb, text, text, jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."photon_proposal_decide"(uuid) FROM PUBLIC;
