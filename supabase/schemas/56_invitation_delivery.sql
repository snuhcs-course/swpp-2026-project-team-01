-- Lock order: own job, invitation, delivery. No network calls inside transactions.
create or replace function fmat.require_invitation_delivery_lease(p_lease jsonb)
returns fmat.jobs language plpgsql set search_path='' as $$
declare j fmat.jobs;
begin
 select * into j from fmat.jobs where id=(p_lease->>'jobId')::uuid for update;
 if not found or j.status<>'running' or j.worker_id is distinct from p_lease->>'workerId' or j.lease_token is distinct from (p_lease->>'leaseToken')::uuid or j.lease_until<=clock_timestamp() then raise exception 'LEASE_LOST';end if;
 if j.kind<>'invitation_delivery' then raise exception 'FORBIDDEN';end if;
 return j;
end$$;
revoke all on function fmat.require_invitation_delivery_lease(jsonb) from public,anon,authenticated,service_role;

create or replace function public.fmat_invitation_delivery(p_operation text,p_lease jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j fmat.jobs; i fmat.invitations; d fmat.invitation_deliveries; actor jsonb; basis text; outcome text; valid boolean;
begin
 if p_operation is null or p_operation not in ('claim','load','prepare','dispatch','record','retry','complete') or jsonb_typeof(p_input) is distinct from 'object' or jsonb_typeof(p_lease) is distinct from 'object' or length(coalesce(p_lease->>'workerId','')) not between 1 and 200 then raise exception 'INVALID_INPUT';end if;
 actor:=jsonb_build_object('kind','worker','id',p_lease->>'workerId');
 if p_operation='claim' then
  if p_input<>'{}' or exists(select 1 from jsonb_object_keys(p_lease) k where k<>'workerId') then raise exception 'INVALID_INPUT';end if;
  select * into j from fmat.jobs job where kind='invitation_delivery' and ((status='pending' and available_at<=clock_timestamp()) or (status='running' and lease_until<=clock_timestamp()))
   and exists(select 1 from fmat.invitation_deliveries item where item.invitation_id::text=job.payload->>'invitationId' and item.mode='cloudflare') order by available_at,created_at,id limit 1 for update skip locked;
  if not found then return jsonb_build_object('job',null);end if;
  update fmat.jobs set status='running',attempts=attempts+1,worker_id=actor->>'id',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp() where id=j.id returning * into j;
  return jsonb_build_object('job',jsonb_build_object('workerId',j.worker_id,'jobId',j.id,'leaseToken',j.lease_token));
 end if;
 if not(p_lease ?& array['jobId','leaseToken']) or exists(select 1 from jsonb_object_keys(p_lease) k where k not in ('workerId','jobId','leaseToken')) then raise exception 'INVALID_INPUT';end if;
 j:=fmat.require_invitation_delivery_lease(p_lease);
 select * into i from fmat.invitations where id=(j.payload->>'invitationId')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 select * into d from fmat.invitation_deliveries where invitation_id=i.id for update;
 if not found or d.mode<>'cloudflare' then raise exception 'FORBIDDEN';end if;
 perform fmat.require_invitation_delivery_lease(p_lease);
 if p_operation in ('load','dispatch','complete','retry') and p_input<>'{}' then raise exception 'INVALID_INPUT';end if;
 if d.dispatched_at is null and d.phase in ('pending','prepared') and (j.attempts>j.max_attempts or (p_operation='retry' and j.attempts>=j.max_attempts)) then
  update fmat.invitation_deliveries set phase='failed' where invitation_id=i.id;
  perform fmat.audit('invitation_delivery_exhausted',actor,i.id::text);
  perform fmat.foundation_command('jobs_complete',actor,jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'result','{"outcome":"failed"}'::jsonb));return '{"phase":"failed"}';
 end if;
 if p_operation='complete' then
  if d.phase not in ('sent','failed','suppressed','uncertain') then raise exception 'INVALID_INPUT';end if;
  return fmat.foundation_command('jobs_complete',actor,jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'result',jsonb_build_object('outcome',d.phase)));
 elsif p_operation='retry' then
  if d.dispatched_at is not null then raise exception 'DELIVERY_RECONCILIATION_REQUIRED';end if;
  return fmat.foundation_command('jobs_fail',actor,jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'errorCode','PROVIDER_UNAVAILABLE'));
 elsif p_operation='record' then
  outcome:=p_input->>'outcome';
  if outcome is null or outcome not in ('sent','failed','suppressed','uncertain') or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('outcome','reason','providerReference')) or d.dispatched_at is null then raise exception 'INVALID_INPUT';end if;
  if d.phase in ('sent','failed','suppressed','uncertain') then
   perform fmat.foundation_command('jobs_complete',actor,jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'result',jsonb_build_object('outcome',d.phase)));return '{"recorded":true}';
  end if;
  if (d.dispatch_job_id,d.dispatch_lease_token) is distinct from (j.id,j.lease_token) and exists(select 1 from fmat.jobs original where original.id=d.dispatch_job_id and original.status='running' and original.lease_token=d.dispatch_lease_token and original.lease_until>clock_timestamp()) then raise exception 'LEASE_LOST';end if;
  if outcome<>'uncertain' and (d.dispatch_job_id,d.dispatch_lease_token) is distinct from (j.id,j.lease_token) then raise exception 'LEASE_LOST';end if;
  if (outcome='sent' and length(coalesce(p_input->>'providerReference','')) not between 1 and 500) or (outcome<>'sent' and coalesce(p_input->>'reason','') not in ('provider_rejected','recipient_bounced','recipient_suppressed','provider_response_unavailable','acceptance_unverified','prior_dispatch_uncertain')) then raise exception 'INVALID_PROVIDER_EVIDENCE';end if;
  update fmat.invitation_deliveries set phase=outcome,provider_reference=case when outcome='sent' then p_input->>'providerReference' else null end where invitation_id=i.id;
  perform fmat.audit('invitation_email_'||outcome,actor,i.id::text);
  perform fmat.foundation_command('jobs_complete',actor,jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'result',jsonb_build_object('outcome',outcome)));return '{"recorded":true}';
 end if;
 if d.phase in ('sent','failed','suppressed','uncertain') then return jsonb_build_object('phase',d.phase);end if;
 if d.dispatched_at is not null then
  if (d.dispatch_job_id,d.dispatch_lease_token) is distinct from (j.id,j.lease_token) and exists(select 1 from fmat.jobs original where original.id=d.dispatch_job_id and original.status='running' and original.lease_token=d.dispatch_lease_token and original.lease_until>clock_timestamp()) then
   perform fmat.foundation_command('jobs_fail',actor,jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'errorCode','DELIVERY_BUSY'));return '{"phase":"busy"}';
  end if;
  return '{"phase":"dispatched"}';
 end if;
 valid:=i.revoked_at is null and i.redeemed_at is null and i.expires_at>clock_timestamp() and i.email=d.recipient and i.issued_by=d.operator_id;
 basis:=encode(sha256(convert_to(jsonb_build_object('invitation',i.id,'hash',i.token_hash,'expires',i.expires_at,'project',d.project,'operator',d.operator_id,'key',d.issue_key,'recipient',d.recipient,'origin',d.origin,'account',d.account_id,'template',d.template_version)::text,'UTF8')),'hex');
 if valid is not true or (d.prepared_basis is not null and d.prepared_basis<>basis) then
  update fmat.invitation_deliveries set phase='suppressed' where invitation_id=i.id;
  perform fmat.audit('invitation_email_suppressed',actor,i.id::text);
  perform fmat.foundation_command('jobs_complete',actor,jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'result','{"outcome":"suppressed"}'::jsonb));return '{"phase":"suppressed"}';
 end if;
 if p_operation='prepare' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('basis','tokenHash','fingerprint')) or p_input->>'basis' is distinct from basis or p_input->>'tokenHash' is distinct from i.token_hash or coalesce(p_input->>'fingerprint','') !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_INPUT';end if;
  if d.prepared_basis is null then update fmat.invitation_deliveries set phase='prepared',prepared_basis=basis,prepared_fingerprint=p_input->>'fingerprint' where invitation_id=i.id returning * into d;
  elsif d.prepared_fingerprint is distinct from p_input->>'fingerprint' then raise exception 'IDEMPOTENCY_CONFLICT';end if;
 elsif p_operation='dispatch' then
  if d.prepared_basis is null then raise exception 'INVALID_INPUT';end if;
  perform fmat.require_invitation_delivery_lease(p_lease);
  update fmat.invitation_deliveries set phase='dispatched',dispatched_at=clock_timestamp(),dispatch_job_id=j.id,dispatch_lease_token=j.lease_token where invitation_id=i.id;
  return jsonb_build_object('phase','dispatch','fingerprint',d.prepared_fingerprint);
 elsif p_operation<>'load' then raise exception 'INVALID_INPUT';end if;
 return jsonb_build_object('phase',d.phase,'id',i.id,'project',d.project,'operator',d.operator_id,'issueKey',d.issue_key,'recipient',d.recipient,'origin',d.origin,'accountId',d.account_id,'templateVersion',d.template_version,'tokenHash',i.token_hash,'expiresAt',i.expires_at,'basis',basis,'fingerprint',d.prepared_fingerprint);
end$$;
revoke all on function public.fmat_invitation_delivery(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_invitation_delivery(text,jsonb,jsonb) to service_role;

create or replace function fmat.wake_invitation_delivery()
returns bigint language plpgsql security definer set search_path='' as $$
declare url text; secret text;
begin
 if not exists(select 1 from fmat.jobs j join fmat.invitation_deliveries d on d.invitation_id::text=j.payload->>'invitationId' where j.kind='invitation_delivery' and d.mode='cloudflare'
  and ((j.status='pending' and j.available_at<=clock_timestamp()) or (j.status='running' and j.lease_until<=clock_timestamp()))) then return null;end if;
 select decrypted_secret into url from vault.decrypted_secrets where name='fmat_runtime_dispatch_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='fmat_runtime_dispatch_secret';
 if url is null or secret is null then return null;end if;
 if url !~ '^https://[^/]+/api/internal/conversations/dispatch$' or secret !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_DISPATCH_CONFIGURATION';end if;
 return net.http_post(url:=replace(url,'/api/internal/conversations/dispatch','/api/internal/invitations/delivery'),headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),body:='{}',timeout_milliseconds:=120000);
end$$;
revoke all on function fmat.wake_invitation_delivery() from public,anon,authenticated,service_role;
select cron.schedule('fmat-invitation-delivery','* * * * *','select fmat.wake_invitation_delivery();');
