SET local check_function_bodies = off;

CREATE TABLE "fmat"."booking_deliveries" (
  "outbox_id"            uuid                     NOT NULL,
  "request_id"           uuid                     NOT NULL,
  "basis"                text                     NOT NULL,
  "encrypted_prepared"   text                     NOT NULL,
  "receipt_token_hash"   text,
  "parent_token_hash"    text,
  "receipt_expires_at"   timestamp with time zone,
  "dispatched_at"        timestamp with time zone,
  "dispatch_job_id"      uuid,
  "dispatch_lease_token" uuid,
  "created_at"           timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "booking_deliveries_check1" CHECK ((((dispatched_at IS NULL) AND (dispatch_job_id IS NULL) AND (dispatch_lease_token IS NULL)) OR ((dispatched_at IS
    NOT NULL) AND (dispatch_job_id IS NOT NULL) AND (dispatch_lease_token IS NOT NULL)))),
  CONSTRAINT "booking_deliveries_check" CHECK ((((receipt_token_hash IS NULL) AND (parent_token_hash IS NULL) AND (receipt_expires_at IS NULL)) OR ((receipt_token_hash IS
    NOT NULL) AND (parent_token_hash IS NOT NULL) AND (receipt_token_hash ~ '^[a-f0-9]{64}$'::text) AND (parent_token_hash ~ '^[a-f0-9]{64}$'::text) AND (receipt_expires_at IS
    NOT NULL)))),
  CONSTRAINT "booking_deliveries_pkey" PRIMARY KEY (outbox_id),
  CONSTRAINT "booking_deliveries_receipt_token_hash_key" UNIQUE (receipt_token_hash)
);

ALTER TABLE "fmat"."booking_deliveries"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.confirmed_booking_receipt (
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare r fmat.requests; a fmat.booking_attempts; p fmat.proposals;
begin
 select * into r from fmat.requests where id=p_request_id;
 if r.status is distinct from 'booked' then return null;end if;
 select * into a from fmat.booking_attempts where request_id=r.id and phase='confirmed' order by confirmed_at desc,id desc limit 1;
 if not found or a.confirmed_at is null or a.provider_evidence->>'eventId' is distinct from a.event_id
  or a.provider_evidence->>'calendarId' is distinct from a.calendar_id or a.provider_evidence->>'payloadFingerprint' is distinct from a.payload_fingerprint
  or r.event->>'id' is distinct from a.event_id then return null;end if;
 select * into strict p from fmat.proposals where request_id=r.id and version=a.proposal_version;
 return jsonb_build_object('confirmedAt',a.confirmed_at,'title',a.payload->>'summary','purpose',p.details->>'purpose',
  'start',a.payload->'start'->>'dateTime','end',a.payload->'end'->>'dateTime','timezone',a.payload->'start'->>'timeZone',
  'organizer',coalesce(a.provider_evidence->'organizer','null'::jsonb),'mode',p.details->>'mode','location',a.payload->>'location','participants',a.payload->'attendees',
  'calendarUrl',case when a.provider_evidence->>'eventUrl' ~ '^https://www\.google\.com/calendar/' then a.provider_evidence->>'eventUrl' else null end);
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
  if v_outbox.payload->>'type'='booking_confirmed' and exists(select 1 from fmat.web_approval_decisions where request_id=(v_outbox.payload->>'requestId')::uuid) then raise exception 'FORBIDDEN';end if;
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

CREATE OR REPLACE FUNCTION fmat.protect_booking_delivery()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
 if (new.outbox_id,new.request_id,new.basis,new.encrypted_prepared,new.receipt_token_hash,new.parent_token_hash,new.receipt_expires_at,new.created_at)
  is distinct from (old.outbox_id,old.request_id,old.basis,old.encrypted_prepared,old.receipt_token_hash,old.parent_token_hash,old.receipt_expires_at,old.created_at)
  or (old.dispatched_at is not null and (new.dispatched_at,new.dispatch_job_id,new.dispatch_lease_token) is distinct from (old.dispatched_at,old.dispatch_job_id,old.dispatch_lease_token)) then raise exception 'IMMUTABLE_DELIVERY';end if;
 return new;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.require_booking_delivery_lease (
  p_actor       jsonb,
  p_job_id      uuid,
  p_lease_token uuid
)
  RETURNS fmat.jobs
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare j fmat.jobs;
begin
 if p_actor->>'kind' is distinct from 'worker' or coalesce(p_actor->>'id','')='' then raise exception 'FORBIDDEN';end if;
 select * into j from fmat.jobs where id=p_job_id for update;
 if not found or j.status<>'running' or j.lease_token is distinct from p_lease_token or j.worker_id is distinct from p_actor->>'id'
  or j.lease_until<=clock_timestamp() then raise exception 'LEASE_LOST';end if;
 if j.kind<>'delivery' then raise exception 'FORBIDDEN';end if;
 return j;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.wake_booking_delivery()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare url text; secret text;
begin
 if not exists(select 1 from fmat.jobs j join fmat.outbox o on o.id::text=j.payload->>'outboxId' where j.kind='delivery' and o.payload->>'type'='booking_confirmed'
  and ((j.status='pending' and j.available_at<=clock_timestamp()) or (j.status='running' and j.lease_until<=clock_timestamp()))) then return null;end if;
 select decrypted_secret into url from vault.decrypted_secrets where name='fmat_booking_delivery_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='fmat_runtime_dispatch_secret';
 if url is null or secret is null then return null;end if;
 if url !~ '^https://[^/]+/api/internal/booking/delivery$' or secret !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_DISPATCH_CONFIGURATION';end if;
 return net.http_post(url:=url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),body:='{}',timeout_milliseconds:=120000);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_booking_delivery (
  p_operation text,
  p_lease     jsonb,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare j fmat.jobs; o fmat.outbox; r fmat.requests; h fmat.hosts; d fmat.booking_deliveries;
 actor jsonb; receipt jsonb; basis text; valid boolean; outcome text;
begin
 if p_operation is null or p_operation not in ('claim','load','prepare','dispatch','record','retry','complete') or jsonb_typeof(p_input) is distinct from 'object'
  or jsonb_typeof(p_lease) is distinct from 'object' or length(coalesce(p_lease->>'workerId','')) not between 1 and 200 then raise exception 'INVALID_INPUT';end if;
 actor:=jsonb_build_object('kind','worker','id',p_lease->>'workerId');
 if p_operation='claim' then
  if p_input<>'{}' or exists(select 1 from jsonb_object_keys(p_lease) k where k<>'workerId') then raise exception 'INVALID_INPUT';end if;
  select * into j from fmat.jobs job where kind='delivery' and ((status='pending' and available_at<=clock_timestamp()) or (status='running' and lease_until<=clock_timestamp()))
   and exists(select 1 from fmat.outbox item where item.id::text=job.payload->>'outboxId' and item.payload->>'type'='booking_confirmed')
   order by available_at,created_at,id limit 1 for update skip locked;
  if not found then return jsonb_build_object('job',null);end if;
  -- One recovery claim beyond the limit may resolve a crashed last attempt.
  -- Below, unsent work becomes failed; previously dispatched work only recovers.
  update fmat.jobs set status='running',attempts=attempts+1,worker_id=actor->>'id',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp() where id=j.id returning * into j;
  return jsonb_build_object('job',jsonb_build_object('workerId',j.worker_id,'jobId',j.id,'leaseToken',j.lease_token));
 end if;
 if not(p_lease ?& array['jobId','leaseToken']) or exists(select 1 from jsonb_object_keys(p_lease) k where k not in ('workerId','jobId','leaseToken')) then raise exception 'INVALID_INPUT';end if;
 j:=fmat.require_booking_delivery_lease(actor,(p_lease->>'jobId')::uuid,(p_lease->>'leaseToken')::uuid);
 if j.kind<>'delivery' then raise exception 'FORBIDDEN';end if;
 select * into o from fmat.outbox where id=(j.payload->>'outboxId')::uuid;
 if not found or o.payload->>'type' is distinct from 'booking_confirmed' then raise exception 'NOT_FOUND';end if;
 select * into r from fmat.requests where id=(o.payload->>'requestId')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 select * into h from fmat.hosts where id=r.host_id for update;
 perform 1 from auth.users where id=h.id for share;
 select * into o from fmat.outbox where id=o.id for update;
 select * into d from fmat.booking_deliveries where outbox_id=o.id for update;
 perform fmat.require_booking_delivery_lease(actor,j.id,j.lease_token);
 if p_operation in ('load','dispatch','complete') and p_input<>'{}' then raise exception 'INVALID_INPUT';end if;
 if d.dispatched_at is null and o.status in ('pending','sending')
  and (j.attempts>j.max_attempts or (p_operation='retry' and j.attempts>=j.max_attempts)) then
  update fmat.outbox set status='failed',payload=payload||'{"deliveryReason":"retry_exhausted"}',updated_at=clock_timestamp() where id=o.id;
  perform fmat.audit('booking_delivery_exhausted',actor,o.id::text);
  perform fmat.foundation_command('jobs_complete',actor,jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'result','{"outcome":"failed"}'::jsonb));
  return jsonb_build_object('phase','failed');
 end if;
 if p_operation='complete' then
  if o.status not in ('sent','failed','suppressed','uncertain') then raise exception 'INVALID_INPUT';end if;
  return fmat.foundation_command('jobs_complete',actor,jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'result',jsonb_build_object('outcome',o.status)));
 elsif p_operation='retry' then
  if p_input<>'{}' or d.dispatched_at is not null then raise exception 'DELIVERY_RECONCILIATION_REQUIRED';end if;
  return fmat.foundation_command('jobs_fail',actor,jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'errorCode','PROVIDER_UNAVAILABLE'));
 elsif p_operation='record' then
  outcome:=p_input->>'outcome';
  if outcome is null or outcome not in ('sent','failed','suppressed','uncertain') or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('outcome','reason','providerReference'))
   or d.dispatched_at is null then raise exception 'INVALID_INPUT';end if;
  if o.status in ('sent','failed','suppressed','uncertain') then
   perform fmat.foundation_command('jobs_complete',actor,jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'result',jsonb_build_object('outcome',o.status)));return jsonb_build_object('recorded',true);
  end if;
  -- A duplicate job must not erase a still-running sender's eventual evidence.
  -- Read the other lease without taking its job lock after the request lock.
  if (d.dispatch_job_id,d.dispatch_lease_token) is distinct from (j.id,j.lease_token)
   and exists(select 1 from fmat.jobs original where original.id=d.dispatch_job_id and original.status='running'
    and original.lease_token=d.dispatch_lease_token and original.lease_until>clock_timestamp()) then raise exception 'LEASE_LOST';end if;
  if outcome<>'uncertain' and (d.dispatch_job_id<>j.id or d.dispatch_lease_token<>j.lease_token) then raise exception 'LEASE_LOST';end if;
  if (outcome='sent' and length(coalesce(p_input->>'providerReference','')) not between 1 and 500)
   or (outcome<>'sent' and coalesce(p_input->>'reason','') not in ('provider_rejected','recipient_bounced','recipient_suppressed','provider_response_unavailable','acceptance_unverified','prior_dispatch_uncertain')) then raise exception 'INVALID_PROVIDER_EVIDENCE';end if;
  update fmat.outbox set status=outcome,provider_reference=case when outcome='sent' then p_input->>'providerReference' else null end,
   payload=payload||jsonb_build_object('deliveryReason',p_input->>'reason'),updated_at=clock_timestamp() where id=o.id;
  perform fmat.audit('booking_email_'||outcome,actor,o.id::text);
  perform fmat.foundation_command('jobs_complete',actor,jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'result',jsonb_build_object('outcome',outcome)));
  return jsonb_build_object('recorded',true);
 end if;
 -- A saved dispatch can never return another permission to send, even if the
 -- first worker stopped before HTTP. Recover only the known local outcome.
 if o.status in ('sent','failed','suppressed','uncertain') then return jsonb_build_object('phase',o.status);end if;
 if d.dispatched_at is not null then
  if (d.dispatch_job_id,d.dispatch_lease_token) is distinct from (j.id,j.lease_token)
   and exists(select 1 from fmat.jobs original where original.id=d.dispatch_job_id and original.status='running'
    and original.lease_token=d.dispatch_lease_token and original.lease_until>clock_timestamp()) then
   perform fmat.foundation_command('jobs_fail',actor,jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'errorCode','DELIVERY_BUSY'));
   return jsonb_build_object('phase','busy');
  end if;
  return jsonb_build_object('phase','dispatched');
 end if;
 receipt:=fmat.confirmed_booking_receipt(r.id);
 valid:=receipt is not null and o.audience in ('host','requester') and o.payload->>'eventId'=r.event->>'id'
  and exists(select 1 from jsonb_array_elements(receipt->'participants') p where lower(p->>'email')=lower(o.recipient->>'email'));
 if o.audience='host' then
  valid:=valid and h.revoked_at is null and lower(h.email)=lower(o.recipient->>'email') and exists(select 1 from auth.users where id=h.id and deleted_at is null and email_confirmed_at is not null and lower(email)=lower(h.email) and (banned_until is null or banned_until<=clock_timestamp()));
 else
  valid:=valid and lower(r.contact_verified_email)=lower(o.recipient->>'email') and r.token_expires_at>clock_timestamp();
 end if;
 basis:=encode(sha256(convert_to(jsonb_build_object('receipt',receipt,'audience',o.audience,'recipient',o.recipient,'token',case when o.audience='requester' then r.token_hash end,'expires',case when o.audience='requester' then r.token_expires_at end)::text,'UTF8')),'hex');
 if valid is not true or (d.outbox_id is not null and d.basis<>basis) then
  update fmat.outbox set status='suppressed',payload=payload||'{"deliveryReason":"recipient_or_content_changed"}',updated_at=clock_timestamp() where id=o.id;
  perform fmat.audit('booking_email_suppressed',actor,o.id::text);
  perform fmat.foundation_command('jobs_complete',actor,jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'result','{"outcome":"suppressed"}'::jsonb));
  return jsonb_build_object('phase','suppressed');
 end if;
 if p_operation='prepare' then
   if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('basis','encryptedPrepared','receiptTokenHash')) or p_input->>'basis' is distinct from basis
    or length(coalesce(p_input->>'encryptedPrepared','')) not between 20 and 131072
    or (o.audience='requester' and coalesce(p_input->>'receiptTokenHash','') !~ '^[a-f0-9]{64}$')
    or (o.audience='host' and p_input->>'receiptTokenHash' is not null) then raise exception 'INVALID_INPUT';end if;
  if d.outbox_id is null then
   insert into fmat.booking_deliveries(outbox_id,request_id,basis,encrypted_prepared,receipt_token_hash,parent_token_hash,receipt_expires_at)
    values(o.id,r.id,basis,p_input->>'encryptedPrepared',p_input->>'receiptTokenHash',case when o.audience='requester' then r.token_hash end,case when o.audience='requester' then r.token_expires_at end) returning * into d;
  end if;
 elsif p_operation='dispatch' then
  if d.outbox_id is null then raise exception 'INVALID_INPUT';end if;
  perform fmat.require_booking_delivery_lease(actor,j.id,j.lease_token);
  update fmat.booking_deliveries set dispatched_at=clock_timestamp(),dispatch_job_id=j.id,dispatch_lease_token=j.lease_token where outbox_id=o.id;
  update fmat.outbox set status='sending',updated_at=clock_timestamp() where id=o.id;
  return jsonb_build_object('phase','dispatch','encryptedPrepared',d.encrypted_prepared,'id',o.id);
 elsif p_operation<>'load' then raise exception 'INVALID_INPUT';end if;
 return jsonb_build_object('phase',case when d.outbox_id is null then 'pending' else 'prepared' end,'id',o.id,'requestId',r.id,'audience',o.audience,
  'recipient',o.recipient->>'email','receipt',receipt,'basis',basis,'expiresAt',case when o.audience='requester' then r.token_expires_at end,'encryptedPrepared',d.encrypted_prepared);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_booking_delivery"(text, jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fmat_booking_receipt (
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare r fmat.requests; actor jsonb; state jsonb; receipt jsonb; delivery text; viewer_audience text;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or not(p_input ? 'requestId') or exists(select 1 from jsonb_object_keys(p_input) k where k<>'requestId') then raise exception 'INVALID_INPUT';end if;
 select * into r from fmat.requests where id=(p_input->>'requestId')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if p_credential->>'kind'='host' then
  actor:=fmat.calendar_actor(p_credential);
  if actor->>'id' is distinct from r.host_id::text then raise exception 'NOT_FOUND';end if;
  viewer_audience:='host';
 elsif p_credential->>'kind'='booking_receipt' then
  if r.status<>'booked' or p_credential->>'requestId' is distinct from r.id::text or not exists(
   select 1 from fmat.booking_deliveries d join fmat.outbox o on o.id=d.outbox_id where d.request_id=r.id and d.receipt_token_hash=p_credential->>'tokenHash'
    and d.dispatched_at is not null and d.parent_token_hash=r.token_hash and d.receipt_expires_at>clock_timestamp() and r.token_expires_at>clock_timestamp()
    and o.audience='requester' and lower(o.recipient->>'email')=lower(r.contact_verified_email) and o.status in ('sending','sent','uncertain')) then raise exception 'NOT_FOUND';end if;
  viewer_audience:='requester';
 elsif p_credential->>'kind'='guest' then
  if p_credential->>'requestId' is distinct from r.id::text or p_credential->>'tokenHash' is distinct from r.token_hash or r.token_expires_at<=clock_timestamp()
   or (r.token_revoked_at is not null and r.status not in ('booked','declined','withdrawn','expired')) then raise exception 'NOT_FOUND';end if;
  viewer_audience:='requester';
 else raise exception 'UNAUTHORIZED';end if;
 state:=fmat.request_lifecycle_view(r.id,p_credential->>'kind');
 receipt:=fmat.confirmed_booking_receipt(r.id);
 if receipt is not null then
  select o.status into delivery from fmat.outbox o where o.dedupe_key='booking-confirmed:'||r.id::text||':'||viewer_audience;
 end if;
 return jsonb_build_object('requestId',r.id,'revision',r.revision,'status',state->>'status','closed',state->'closed','receipt',receipt,'emailStatus',case when receipt is null then null else coalesce(delivery,'pending') end);
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

ALTER TABLE "fmat"."booking_deliveries"
  ADD CONSTRAINT "booking_deliveries_dispatch_job_id_fkey" FOREIGN KEY (dispatch_job_id) REFERENCES fmat.jobs(id);

ALTER TABLE "fmat"."booking_deliveries"
  ADD CONSTRAINT "booking_deliveries_outbox_id_fkey" FOREIGN KEY (outbox_id) REFERENCES fmat.outbox(id);

ALTER TABLE "fmat"."booking_deliveries"
  ADD CONSTRAINT "booking_deliveries_request_id_fkey" FOREIGN KEY (request_id) REFERENCES fmat.requests(id);

CREATE INDEX booking_deliveries_request_idx ON fmat.booking_deliveries USING btree (request_id);

CREATE TRIGGER booking_deliveries_immutable
  BEFORE UPDATE ON fmat.booking_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION fmat.protect_booking_delivery();

REVOKE ALL ON FUNCTION "fmat"."protect_booking_delivery"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."require_booking_delivery_lease"(jsonb, uuid, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."wake_booking_delivery"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_booking_delivery"(text, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_booking_delivery"(text, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_booking_delivery"(text, jsonb, jsonb) TO "service_role";

SELECT cron.schedule_in_database('fmat-booking-delivery', '* * * * *', 'select fmat.wake_booking_delivery();', 'postgres', NULL, true);
