create table fmat.booking_deliveries (
 outbox_id uuid primary key references fmat.outbox(id),
 request_id uuid not null references fmat.requests(id),
 basis text not null,
 encrypted_prepared text not null,
 receipt_token_hash text unique,
 parent_token_hash text,
 receipt_expires_at timestamptz,
 dispatched_at timestamptz,
 dispatch_job_id uuid references fmat.jobs(id),
 dispatch_lease_token uuid,
 created_at timestamptz not null default clock_timestamp(),
 check((receipt_token_hash is null and parent_token_hash is null and receipt_expires_at is null) or
  (receipt_token_hash is not null and parent_token_hash is not null and receipt_token_hash ~ '^[a-f0-9]{64}$' and parent_token_hash ~ '^[a-f0-9]{64}$' and receipt_expires_at is not null)),
 check((dispatched_at is null and dispatch_job_id is null and dispatch_lease_token is null) or
  (dispatched_at is not null and dispatch_job_id is not null and dispatch_lease_token is not null))
);
alter table fmat.booking_deliveries enable row level security;
revoke all on fmat.booking_deliveries from public,anon,authenticated,service_role;
create index booking_deliveries_request_idx on fmat.booking_deliveries(request_id);
create or replace function fmat.protect_booking_delivery()
returns trigger language plpgsql set search_path='' as $$
begin
 if (new.outbox_id,new.request_id,new.basis,new.encrypted_prepared,new.receipt_token_hash,new.parent_token_hash,new.receipt_expires_at,new.created_at)
  is distinct from (old.outbox_id,old.request_id,old.basis,old.encrypted_prepared,old.receipt_token_hash,old.parent_token_hash,old.receipt_expires_at,old.created_at)
  or (old.dispatched_at is not null and (new.dispatched_at,new.dispatch_job_id,new.dispatch_lease_token) is distinct from (old.dispatched_at,old.dispatch_job_id,old.dispatch_lease_token)) then raise exception 'IMMUTABLE_DELIVERY';end if;
 return new;
end;
$$;
revoke all on function fmat.protect_booking_delivery() from public,anon,authenticated,service_role;
create trigger booking_deliveries_immutable before update on fmat.booking_deliveries for each row execute function fmat.protect_booking_delivery();

-- Delivery leases cannot be used as Calendar booking authority.
create or replace function fmat.require_booking_delivery_lease(p_actor jsonb,p_job_id uuid,p_lease_token uuid)
returns fmat.jobs language plpgsql set search_path='' as $$
declare j fmat.jobs;
begin
 if p_actor->>'kind' is distinct from 'worker' or coalesce(p_actor->>'id','')='' then raise exception 'FORBIDDEN';end if;
 select * into j from fmat.jobs where id=p_job_id for update;
 if not found or j.status<>'running' or j.lease_token is distinct from p_lease_token or j.worker_id is distinct from p_actor->>'id'
  or j.lease_until<=clock_timestamp() then raise exception 'LEASE_LOST';end if;
 if j.kind<>'delivery' then raise exception 'FORBIDDEN';end if;
 return j;
end;
$$;
revoke all on function fmat.require_booking_delivery_lease(jsonb,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.fmat_booking_delivery(p_operation text,p_lease jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
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
$$;
revoke all on function public.fmat_booking_delivery(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_booking_delivery(text,jsonb,jsonb) to service_role;

create or replace function fmat.wake_booking_delivery()
returns bigint language plpgsql security definer set search_path='' as $$
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
$$;
revoke all on function fmat.wake_booking_delivery() from public,anon,authenticated,service_role;
select cron.schedule('fmat-booking-delivery','* * * * *','select fmat.wake_booking_delivery();');
