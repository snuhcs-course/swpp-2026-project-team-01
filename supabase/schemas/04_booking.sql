create table fmat.host_approvals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references fmat.requests(id),
  proposal_version integer not null,
  host_id uuid not null references fmat.hosts(id),
  source text not null check(source='authenticated_web'),
  approved_revision integer not null,
  created_at timestamptz not null default now(),
  foreign key(request_id,proposal_version) references fmat.proposals(request_id,version)
);
create index host_approvals_request_idx on fmat.host_approvals(request_id,proposal_version);
alter table fmat.host_approvals enable row level security;

-- A request retains one provider-valid event identity across conclusively noncreating attempts.
create table fmat.booking_identities (
  request_id uuid primary key references fmat.requests(id),
  event_id text not null unique check(length(event_id) between 5 and 1024 and event_id ~ '^[0-9a-v]+$'),
  created_at timestamptz not null default now()
);
alter table fmat.booking_identities enable row level security;

create table fmat.booking_attempts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references fmat.booking_identities(request_id),
  host_id uuid not null references fmat.hosts(id),
  proposal_version integer not null,
  approval_id uuid not null references fmat.host_approvals(id),
  expected_revision integer not null,
  rules_version integer not null,
  connection_id uuid not null references fmat.calendar_connections(id),
  connection_provider_subject text not null,
  calendar_id text not null,
  event_id text not null,
  payload jsonb not null,
  payload_fingerprint text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  phase text not null default 'prepared' check(phase in ('prepared','dispatched','uncertain','confirmed','noncreating','blocked','conflict')),
  dispatched_at timestamptz,
  confirmed_at timestamptz,
  reconciliation_count integer not null default 0,
  reason text,
  provider_evidence jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now(),
  foreign key(request_id,proposal_version) references fmat.proposals(request_id,version),
  check(starts_at<ends_at)
);
create unique index booking_attempts_active_request_idx on fmat.booking_attempts(request_id) where phase not in ('noncreating','blocked');
create index booking_attempts_host_interval_idx on fmat.booking_attempts(host_id,starts_at,ends_at) where phase='confirmed';
alter table fmat.booking_attempts enable row level security;

create table fmat.host_reservations (
  host_id uuid primary key references fmat.hosts(id),
  attempt_id uuid not null unique references fmat.booking_attempts(id),
  created_at timestamptz not null default now()
);
alter table fmat.host_reservations enable row level security;

-- Freeze every provider-visible field; even a new owner cannot mutate a possibly sent payload.
create or replace function fmat.protect_booking_snapshot()
returns trigger language plpgsql set search_path='' as $$
begin
  if row(new.request_id,new.host_id,new.proposal_version,new.approval_id,new.expected_revision,new.rules_version,new.connection_id,new.connection_provider_subject,new.calendar_id,new.event_id,new.payload,new.payload_fingerprint,new.starts_at,new.ends_at)
    is distinct from row(old.request_id,old.host_id,old.proposal_version,old.approval_id,old.expected_revision,old.rules_version,old.connection_id,old.connection_provider_subject,old.calendar_id,old.event_id,old.payload,old.payload_fingerprint,old.starts_at,old.ends_at)
    then raise exception 'BOOKING_SNAPSHOT_IMMUTABLE'; end if;
  if old.phase in ('dispatched','uncertain','conflict') and new.phase in ('prepared','blocked') then raise exception 'BOOKING_UNCERTAIN'; end if;
  if old.phase='confirmed' and new.phase<>'confirmed' then raise exception 'BOOKING_TERMINAL'; end if;
  return new;
end;
$$;
create trigger protect_booking_snapshot before update on fmat.booking_attempts for each row execute function fmat.protect_booking_snapshot();

create or replace function fmat.withdraw_allowed(p_request_id uuid)
returns boolean language sql stable set search_path='' as $$
  select not exists(select 1 from fmat.booking_attempts where request_id=p_request_id and phase in ('dispatched','uncertain','conflict','confirmed'));
$$;

create or replace function fmat.require_job_lease(p_actor jsonb,p_job_id uuid,p_lease_token uuid)
returns fmat.jobs language plpgsql set search_path='' as $$
declare v_job fmat.jobs;
begin
  if p_actor->>'kind' is distinct from 'worker' or coalesce(p_actor->>'id','')='' then raise exception 'FORBIDDEN'; end if;
  select * into v_job from fmat.jobs where id=p_job_id for update;
  if not found or v_job.status<>'running' or v_job.lease_token is distinct from p_lease_token
    or v_job.worker_id is distinct from p_actor->>'id' or v_job.lease_until<=now() then raise exception 'LEASE_LOST'; end if;
  if v_job.kind not in ('booking','booking_reconcile') then raise exception 'FORBIDDEN'; end if;
  return v_job;
end;
$$;

create or replace function fmat.booking_snapshot(p_attempt fmat.booking_attempts)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('attemptId',p_attempt.id,'requestId',p_attempt.request_id,'hostId',p_attempt.host_id,
    'proposalVersion',p_attempt.proposal_version,'calendarId',p_attempt.calendar_id,'eventId',p_attempt.event_id,'payload',p_attempt.payload,'phase',p_attempt.phase,
    'expectedRevision',p_attempt.expected_revision,'rulesVersion',p_attempt.rules_version,'connectionId',p_attempt.connection_id,'connectionProviderSubject',p_attempt.connection_provider_subject,'payloadFingerprint',p_attempt.payload_fingerprint,
    'localBookings',(select coalesce(jsonb_agg(jsonb_build_object('payload',a.payload,'startsAt',a.starts_at,'endsAt',a.ends_at,'mode',p.details->>'mode','calendarId',a.calendar_id)),'[]'::jsonb) from fmat.booking_attempts a join fmat.proposals p on p.request_id=a.request_id and p.version=a.proposal_version
      where a.host_id=p_attempt.host_id and a.phase='confirmed' and a.id<>p_attempt.id and a.ends_at>now()));
$$;

create or replace function fmat.prepare_booking(p_request fmat.requests,p_approval_id uuid)
returns uuid language plpgsql set search_path='' as $$
declare v_host fmat.hosts; v_proposal fmat.proposals; v_connection fmat.calendar_connections;
  v_id uuid:=gen_random_uuid(); v_event_id text; v_payload jsonb;
begin
  select * into strict v_host from fmat.hosts where id=p_request.host_id for share;
  select * into v_connection from fmat.calendar_connections where principal_kind='host' and principal_id=p_request.host_id and revoked_at is null for share;
  if not found then raise exception 'RECONNECT_REQUIRED'; end if;
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
$$;

create or replace function fmat.booking_authorize(p_operation text,p_actor jsonb,p_input jsonb)
returns void language plpgsql set search_path='' as $$
begin
  if p_operation='host_approve' then
    perform fmat.require_host(p_actor,true);
    perform fmat.require_request(p_actor,(p_input->>'requestId')::uuid);
  elsif p_operation in ('booking_load','booking_dispatch','booking_record_outcome') then
    if p_actor->>'kind' is distinct from 'worker' or coalesce(p_actor->>'id','')='' then raise exception 'FORBIDDEN'; end if;
  elsif p_operation in ('booking_retry','booking_reconcile') then
    if p_actor->>'kind' is distinct from 'operator' or coalesce(p_actor->>'id','')='' then raise exception 'FORBIDDEN'; end if;
  else raise exception 'UNKNOWN_OPERATION'; end if;
end;
$$;

create or replace function fmat.booking_command(p_operation text,p_actor jsonb,p_input jsonb)
returns jsonb language plpgsql set search_path='' as $$
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
  if p_operation='booking_load' then
    if (p_input->>'requestId')::uuid is distinct from v_request.id then raise exception 'FORBIDDEN'; end if;
    if v_attempt.phase='prepared' then
      insert into fmat.host_reservations(host_id,attempt_id) values(v_attempt.host_id,v_attempt.id) on conflict(host_id) do nothing;
      select attempt_id into v_existing_attempt_id from fmat.host_reservations where host_id=v_attempt.host_id for update;
      if v_existing_attempt_id<>v_attempt.id then raise exception 'HOST_BUSY'; end if;
    end if;
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
    update fmat.booking_attempts set phase='dispatched',dispatched_at=now(),updated_at=now() where id=v_attempt.id;
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
$$;

create or replace function fmat.dispatch_command(p_operation text,p_actor jsonb,p_input jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare v_result jsonb; v_connection fmat.calendar_connections; v_host fmat.hosts; v_start timestamptz; v_end timestamptz;
begin
  if p_operation like 'jobs_%' or p_operation='foundation_ping' then return fmat.foundation_command(p_operation,p_actor,p_input); end if;
  if p_operation in ('host_approve','booking_load','booking_dispatch','booking_record_outcome','booking_retry','booking_reconcile') then return fmat.booking_command(p_operation,p_actor,p_input); end if;
  if fmat.is_delivery_operation(p_operation) then return fmat.delivery_command(p_operation,p_actor,p_input); end if;
  if fmat.is_request_operation(p_operation) then
    v_result:=fmat.request_command(p_operation,p_actor,p_input);
    if p_operation='evaluation_read' then
      select * into strict v_host from fmat.hosts where id=(v_result->>'hostId')::uuid;
      select min((w->>'start')::timestamptz)-interval '1 day',max((w->>'end')::timestamptz)+interval '1 day'
        into v_start,v_end from jsonb_array_elements(v_result->'details'->'windows') w;
      v_result:=v_result||jsonb_build_object('localBookings',(select coalesce(jsonb_agg(jsonb_build_object('payload',a.payload,
        'startsAt',a.starts_at,'endsAt',a.ends_at,'mode',p.details->>'mode','calendarId',a.calendar_id) order by a.starts_at,a.id),'[]'::jsonb)
        from fmat.booking_attempts a join fmat.proposals p on p.request_id=a.request_id and p.version=a.proposal_version
        where a.host_id=v_host.id and a.request_id<>(v_result->>'requestId')::uuid and a.phase='confirmed'
          and (a.calendar_id=any(v_host.conflict_calendar_ids) or a.calendar_id=v_host.booking_calendar_id)
          and a.starts_at<v_end and a.ends_at>v_start));
    end if;
    return v_result;
  end if;
  if p_operation='connection_read' then
    -- Keep encrypted bundle and metadata from the same credential revision.
    perform 1 from fmat.calendar_connections where principal_kind=case when p_input ? 'hostId' then 'host' else 'guest' end
      and principal_id=coalesce(p_input->>'hostId',p_input->>'requestId')::uuid for share;
  elsif p_operation='token_update' then
    select * into v_connection from fmat.calendar_connections where id=(p_input->>'connectionId')::uuid for update;
    if not found or v_connection.revoked_at is not null then raise exception 'RECONNECT_REQUIRED'; end if;
    if v_connection.provider_subject is distinct from p_input->>'providerSubject' then raise exception 'RECONNECT_REQUIRED'; end if;
    if v_connection.updated_at is distinct from (p_input->>'expectedUpdatedAt')::timestamptz then raise exception 'FEASIBILITY_STALE'; end if;
  end if;
  v_result:=fmat.onboarding_request_dispatch(p_operation,p_actor,p_input);
  if p_operation in ('connection_read','token_update') then
    select * into v_connection from fmat.calendar_connections where id=coalesce(v_result->>'connectionId',p_input->>'connectionId')::uuid;
    if found then v_result:=v_result||jsonb_build_object('updatedAt',v_connection.updated_at,'providerSubject',v_connection.provider_subject); end if;
  end if;
  return v_result;
end;
$$;
create or replace function fmat.authorize_command(p_operation text,p_actor jsonb,p_input jsonb)
returns void language plpgsql set search_path='' as $$
begin
  if p_operation like 'jobs_%' or p_operation='foundation_ping' then
    if p_actor->>'kind' not in ('worker','operator') or coalesce(p_actor->>'id','')='' then raise exception 'FORBIDDEN'; end if;
  elsif p_operation in ('host_approve','booking_load','booking_dispatch','booking_record_outcome','booking_retry','booking_reconcile') then perform fmat.booking_authorize(p_operation,p_actor,p_input);
  elsif fmat.is_delivery_operation(p_operation) then perform fmat.delivery_authorize(p_actor);
  elsif fmat.is_request_operation(p_operation) then perform fmat.request_authorize(p_operation,p_actor,p_input);
  else perform fmat.onboarding_request_authorize(p_operation,p_actor,p_input);
  end if;
end;
$$;
create or replace function public.fmat_command(p_operation text,p_actor jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_scope text; v_key text; v_record fmat.idempotency; v_result jsonb; v_identity_input jsonb;
begin
  if p_operation in ('candidates_save','proposal_create','proposal_revise','requester_agree','requester_withdraw','host_decline','manual_allowance_save','preference_exception_save')
    or (p_operation='mutation_replay' and p_input->>'operation' in ('proposal_create','proposal_revise','requester_withdraw','host_decline','manual_allowance_save','preference_exception_save')) then raise exception 'FORBIDDEN';end if;
  if jsonb_typeof(p_actor) is distinct from 'object' or jsonb_typeof(p_input) is distinct from 'object'
    or p_actor->>'kind' is null or p_actor->>'kind' not in ('host','guest','worker','operator','public') then raise exception 'INVALID_INPUT'; end if;
  perform fmat.authorize_command(p_operation,p_actor,p_input);
  if p_operation like 'jobs_%' or p_operation in ('oauth_consume','credential_save','token_update','oauth_cleanup','host_public','setup_read','calendar_read','requests_list','request_read','connection_read','evaluation_read','candidates_save','extraction_save','assistant_message_save','model_claim','request_expire','mutation_replay','delivery_load','delivery_dispatch','delivery_record','booking_load','booking_dispatch','booking_record_outcome') then return fmat.dispatch_command(p_operation,p_actor,p_input); end if;
  v_key:=p_input->>'idempotencyKey';
  if v_key is null or length(v_key) not between 1 and 200 then raise exception 'IDEMPOTENCY_REQUIRED'; end if;
  v_scope:=coalesce(p_actor->>'kind','')||':'||coalesce(p_actor->>'id',p_actor->>'tokenHash',p_actor->>'email','public');
  v_identity_input:=case when p_operation='oauth_start' then jsonb_build_object('context',p_input->'context','idempotencyKey',v_key) when p_operation='contact_start' then p_input-'encryptedCode' when p_operation='contact_recover' then p_input-'encryptedToken' when p_operation='manual_allowance_save' then jsonb_set(p_input,'{allowance}',(p_input->'allowance')-'confirmedAt') else p_input end;
  insert into fmat.idempotency(actor_scope,operation,key,input) values(v_scope,p_operation,v_key,v_identity_input) on conflict do nothing;
  select * into strict v_record from fmat.idempotency where actor_scope=v_scope and operation=p_operation and key=v_key for update;
  if v_record.input<>v_identity_input then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if v_record.result is not null then
    if p_operation='oauth_start' and not exists(select 1 from fmat.oauth_exchanges where id=(v_record.result->>'exchangeId')::uuid and consumed_at is null and expires_at>now()) then raise exception 'OAUTH_STATE_INVALID'; end if;
    if p_operation='request_create' and not exists(select 1 from fmat.requests r join fmat.hosts h on h.id=r.host_id where r.id=(v_record.result->>'id')::uuid and r.token_hash=p_input->>'tokenHash' and r.token_revoked_at is null and r.expires_at>now() and fmat.host_ready(h)) then raise exception 'REQUEST_CLOSED'; end if;
    if p_operation='contact_redeem' and not exists(select 1 from fmat.requests where id=(p_input->>'requestId')::uuid and token_hash=p_input->>'newTokenHash' and token_revoked_at is null and expires_at>now()) then raise exception 'CONTACT_INVALID'; end if;
    return v_record.result;
  end if;
  v_result:=fmat.dispatch_command(p_operation,p_actor,p_input);
  update fmat.idempotency set result=v_result where actor_scope=v_scope and operation=p_operation and key=v_key;
  return v_result;
end;
$$;
revoke all on all tables in schema fmat from public,anon,authenticated,service_role;
revoke execute on all functions in schema fmat from public,anon,authenticated,service_role;

revoke execute on function public.fmat_command(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_command(text,jsonb,jsonb) to service_role;
