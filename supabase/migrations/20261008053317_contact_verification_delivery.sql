SET local check_function_bodies = off;

CREATE TABLE "fmat"."contact_verification_deliveries" (
  "outbox_id"            uuid                     NOT NULL,
  "request_id"           uuid                     NOT NULL,
  "basis"                text                     NOT NULL,
  "encrypted_prepared"   text                     NOT NULL,
  "challenge_id"         uuid                     NOT NULL,
  "dispatched_at"        timestamp with time zone,
  "dispatch_job_id"      uuid,
  "dispatch_lease_token" uuid,
  "created_at"           timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "contact_verification_deliveries_check" CHECK ((((dispatched_at IS NULL) AND (dispatch_job_id IS NULL) AND (dispatch_lease_token IS NULL)) OR ((dispatched_at IS
    NOT NULL) AND (dispatch_job_id IS NOT NULL) AND (dispatch_lease_token IS NOT NULL)))),
  CONSTRAINT "contact_verification_deliveries_pkey" PRIMARY KEY (outbox_id)
);

ALTER TABLE "fmat"."contact_verification_deliveries"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.protect_contact_verification_delivery()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
 if (new.outbox_id,new.request_id,new.basis,new.encrypted_prepared,new.challenge_id,new.created_at)
  is distinct from (old.outbox_id,old.request_id,old.basis,old.encrypted_prepared,old.challenge_id,old.created_at)
  or (old.dispatched_at is not null and (new.dispatched_at,new.dispatch_job_id,new.dispatch_lease_token) is distinct from (old.dispatched_at,old.dispatch_job_id,old.dispatch_lease_token)) then raise exception 'IMMUTABLE_DELIVERY';end if;
 return new;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.require_contact_verification_delivery_lease (
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
 if j.kind<>'contact_verification_delivery' then raise exception 'FORBIDDEN';end if;
 return j;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.wake_contact_verification_delivery()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare url text; secret text;
begin
 if not exists(select 1 from fmat.jobs j join fmat.outbox o on o.id::text=j.payload->>'outboxId' where j.kind='contact_verification_delivery' and o.payload->>'type'='contact_verification'
  and ((j.status='pending' and j.available_at<=clock_timestamp()) or (j.status='running' and j.lease_until<=clock_timestamp()))) then return null;end if;
 select decrypted_secret into url from vault.decrypted_secrets where name='fmat_contact_verification_delivery_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='fmat_runtime_dispatch_secret';
 if url is null or secret is null then return null;end if;
 if url !~ '^https://[^/]+/api/internal/contact/delivery$' or secret !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_DISPATCH_CONFIGURATION';end if;
 return net.http_post(url:=url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),body:='{}',timeout_milliseconds:=120000);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_contact_verification_delivery (
  p_operation text,
  p_lease     jsonb,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare j fmat.jobs; o fmat.outbox; r fmat.requests; c fmat.contact_verifications; d fmat.contact_verification_deliveries;
 actor jsonb; basis text; valid boolean; outcome text;
begin
 if p_operation is null or p_operation not in ('claim','load','prepare','dispatch','record','retry','complete') or jsonb_typeof(p_input) is distinct from 'object'
  or jsonb_typeof(p_lease) is distinct from 'object' or length(coalesce(p_lease->>'workerId','')) not between 1 and 200 then raise exception 'INVALID_INPUT';end if;
 actor:=jsonb_build_object('kind','worker','id',p_lease->>'workerId');
 if p_operation='claim' then
  if p_input<>'{}' or exists(select 1 from jsonb_object_keys(p_lease) k where k<>'workerId') then raise exception 'INVALID_INPUT';end if;
  select * into j from fmat.jobs job where kind='contact_verification_delivery' and ((status='pending' and available_at<=clock_timestamp()) or (status='running' and lease_until<=clock_timestamp()))
   and exists(select 1 from fmat.outbox item where item.id::text=job.payload->>'outboxId' and item.payload->>'type'='contact_verification')
   order by available_at,created_at,id limit 1 for update skip locked;
  if not found then return jsonb_build_object('job',null);end if;
  -- One recovery claim beyond the limit may resolve a crashed last attempt.
  -- Below, unsent work becomes failed; previously dispatched work only recovers.
  update fmat.jobs set status='running',attempts=attempts+1,worker_id=actor->>'id',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp() where id=j.id returning * into j;
  return jsonb_build_object('job',jsonb_build_object('workerId',j.worker_id,'jobId',j.id,'leaseToken',j.lease_token));
 end if;
 if not(p_lease ?& array['jobId','leaseToken']) or exists(select 1 from jsonb_object_keys(p_lease) k where k not in ('workerId','jobId','leaseToken')) then raise exception 'INVALID_INPUT';end if;
 j:=fmat.require_contact_verification_delivery_lease(actor,(p_lease->>'jobId')::uuid,(p_lease->>'leaseToken')::uuid);
 if j.kind<>'contact_verification_delivery' then raise exception 'FORBIDDEN';end if;
 select * into o from fmat.outbox where id=(j.payload->>'outboxId')::uuid;
 if not found or o.payload->>'type' is distinct from 'contact_verification' then raise exception 'NOT_FOUND';end if;
 select * into r from fmat.requests where id=(o.payload->>'requestId')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 select * into c from fmat.contact_verifications where id=(o.payload->>'challengeId')::uuid for update;
 select * into o from fmat.outbox where id=o.id for update;
 select * into d from fmat.contact_verification_deliveries where outbox_id=o.id for update;
 perform fmat.require_contact_verification_delivery_lease(actor,j.id,j.lease_token);
 if p_operation in ('load','dispatch','complete') and p_input<>'{}' then raise exception 'INVALID_INPUT';end if;
 if d.dispatched_at is null and o.status in ('pending','sending')
  and (j.attempts>j.max_attempts or (p_operation='retry' and j.attempts>=j.max_attempts)) then
  update fmat.outbox set status='failed',payload=payload||'{"deliveryReason":"retry_exhausted"}',updated_at=clock_timestamp() where id=o.id;
  perform fmat.audit('contact_verification_delivery_exhausted',actor,o.id::text);
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
  perform fmat.audit('contact_verification_email_'||outcome,actor,o.id::text);
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
 valid:=c.id is not null and c.request_id=r.id and c.outbox_id=o.id and o.audience='requester'
  and c.email=r.details->>'requesterEmail' and c.email=o.recipient->>'email'
  and c.token_hash=r.token_hash and c.consumed_at is null and c.failed_attempts<5 and c.expires_at>clock_timestamp()
  and r.token_revoked_at is null and r.token_expires_at>clock_timestamp() and r.expires_at>clock_timestamp()
  and r.status in ('gathering','negotiating','awaiting_approval');
 basis:=encode(sha256(convert_to(jsonb_build_object('request',r.id,'challenge',c.id,'recipient',c.email,'token',c.token_hash,'expires',c.expires_at,'code',c.encrypted_code)::text,'UTF8')),'hex');
 if valid is not true or (d.outbox_id is not null and d.basis<>basis) then
  update fmat.outbox set status='suppressed',payload=payload||'{"deliveryReason":"recipient_or_content_changed"}',updated_at=clock_timestamp() where id=o.id;
  perform fmat.audit('contact_verification_email_suppressed',actor,o.id::text);
  perform fmat.foundation_command('jobs_complete',actor,jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'result','{"outcome":"suppressed"}'::jsonb));
  return jsonb_build_object('phase','suppressed');
 end if;
 if p_operation='prepare' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('basis','encryptedPrepared')) or p_input->>'basis' is distinct from basis
   or length(coalesce(p_input->>'encryptedPrepared','')) not between 20 and 131072 then raise exception 'INVALID_INPUT';end if;
  if d.outbox_id is null then
   insert into fmat.contact_verification_deliveries(outbox_id,request_id,challenge_id,basis,encrypted_prepared)
    values(o.id,r.id,c.id,basis,p_input->>'encryptedPrepared') returning * into d;
  end if;
 elsif p_operation='dispatch' then
  if d.outbox_id is null then raise exception 'INVALID_INPUT';end if;
  perform fmat.require_contact_verification_delivery_lease(actor,j.id,j.lease_token);
  update fmat.contact_verification_deliveries set dispatched_at=clock_timestamp(),dispatch_job_id=j.id,dispatch_lease_token=j.lease_token where outbox_id=o.id;
  update fmat.outbox set status='sending',updated_at=clock_timestamp() where id=o.id;
  return jsonb_build_object('phase','dispatch','encryptedPrepared',d.encrypted_prepared,'id',o.id);
 elsif p_operation<>'load' then raise exception 'INVALID_INPUT';end if;
 return jsonb_build_object('phase',case when d.outbox_id is null then 'pending' else 'prepared' end,'id',o.id,'requestId',r.id,'challengeId',c.id,
  'recipient',c.email,'encryptedCode',c.encrypted_code,'basis',basis,'expiresAt',c.expires_at,'encryptedPrepared',d.encrypted_prepared);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_contact_verification_delivery"(text, jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."contact_verification_deliveries"
  ADD CONSTRAINT "contact_verification_deliveries_challenge_id_fkey" FOREIGN KEY (challenge_id) REFERENCES fmat.contact_verifications(id);

ALTER TABLE "fmat"."contact_verification_deliveries"
  ADD CONSTRAINT "contact_verification_deliveries_dispatch_job_id_fkey" FOREIGN KEY (dispatch_job_id) REFERENCES fmat.jobs(id);

ALTER TABLE "fmat"."contact_verification_deliveries"
  ADD CONSTRAINT "contact_verification_deliveries_outbox_id_fkey" FOREIGN KEY (outbox_id) REFERENCES fmat.outbox(id);

ALTER TABLE "fmat"."contact_verification_deliveries"
  ADD CONSTRAINT "contact_verification_deliveries_request_id_fkey" FOREIGN KEY (request_id) REFERENCES fmat.requests(id);

CREATE INDEX contact_verification_deliveries_request_idx ON fmat.contact_verification_deliveries USING btree (request_id);

CREATE TRIGGER contact_verification_deliveries_immutable
  BEFORE UPDATE ON fmat.contact_verification_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION fmat.protect_contact_verification_delivery();

REVOKE ALL ON FUNCTION "fmat"."protect_contact_verification_delivery"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."require_contact_verification_delivery_lease"(jsonb, uuid, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."wake_contact_verification_delivery"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_contact_verification_delivery"(text, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_contact_verification_delivery"(text, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_contact_verification_delivery"(text, jsonb, jsonb) TO "service_role";

SELECT cron.schedule_in_database('fmat-contact-verification-delivery', '* * * * *', 'select fmat.wake_contact_verification_delivery();', 'postgres', NULL, true);
