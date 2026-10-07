create or replace function public.fmat_booking_worker(p_operation text,p_lease jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
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
   and exists(select 1 from fmat.booking_attempts attempt join fmat.web_approval_decisions decision on decision.approval_id=attempt.approval_id
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
 if not found or not exists(select 1 from fmat.web_approval_decisions where approval_id=a.approval_id and request_id=r.id and host_id=h.id) then raise exception 'FORBIDDEN';end if;
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
   if jsonb_typeof(evidence) is distinct from 'object' or exists(select 1 from jsonb_object_keys(evidence) k where k not in ('calendarId','eventId','payloadFingerprint','eventUrl','etag'))
    or evidence->>'calendarId' is distinct from a.calendar_id or evidence->>'eventId' is distinct from a.event_id or evidence->>'payloadFingerprint' is distinct from a.payload_fingerprint
    or length(coalesce(evidence->>'etag','')) not between 1 and 1024
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
$$;
revoke all on function public.fmat_booking_worker(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_booking_worker(text,jsonb,jsonb) to service_role;

create or replace function fmat.wake_booking_worker()
returns bigint language plpgsql security definer set search_path='' as $$
declare url text; secret text;
begin
 if not exists(select 1 from fmat.jobs j where kind in ('booking','booking_reconcile')
  and ((status='pending' and available_at<=clock_timestamp()) or (status='running' and lease_until<=clock_timestamp()))
  and exists(select 1 from fmat.booking_attempts a join fmat.web_approval_decisions d on d.approval_id=a.approval_id where a.id::text=j.payload->>'attemptId' and a.request_id::text=j.payload->>'requestId')) then return null;end if;
 select decrypted_secret into url from vault.decrypted_secrets where name='fmat_booking_dispatch_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='fmat_runtime_dispatch_secret';
 if url is null or secret is null then return null;end if;
 if url !~ '^https://[^/]+/api/internal/booking/dispatch$' or secret !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_DISPATCH_CONFIGURATION';end if;
 return net.http_post(url:=url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),body:='{}',timeout_milliseconds:=120000);
end;
$$;
revoke all on function fmat.wake_booking_worker() from public,anon,authenticated,service_role;
select cron.schedule('fmat-booking-dispatch','* * * * *','select fmat.wake_booking_worker();');
