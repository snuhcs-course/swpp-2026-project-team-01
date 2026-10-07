-- Public onboarding continuation for an authenticated private transport sender.
-- This is not a host/session credential and never executes the original text.
create table fmat.photon_handoffs (
 id uuid primary key,
 inbox_id uuid not null unique references fmat.photon_inbox(id),
 project_id uuid not null references fmat.photon_receivers(project_id),
 token_hash text not null unique check(token_hash~'^[a-f0-9]{64}$'),
 encrypted_token text,
 status text not null default 'prepared' check(status in ('prepared','uncertain','accepted','delivered','failed')),
 provider_reference text check(length(provider_reference) between 1 and 512),
 lease_token uuid,
 lease_until timestamptz,
 checked_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 check((lease_token is null)=(lease_until is null)),
 check(expires_at>created_at and expires_at<=created_at+interval '15 minutes')
);
create index photon_handoffs_due_idx on fmat.photon_handoffs(project_id,checked_at,created_at) where revoked_at is null and status in ('prepared','uncertain','accepted');
alter table fmat.photon_handoffs enable row level security;
revoke all on fmat.photon_handoffs from public,anon,authenticated,service_role;
alter table fmat.photon_inbox drop constraint photon_inbox_processing_outcome_check;
alter table fmat.photon_inbox add constraint photon_inbox_processing_outcome_check check(processing_outcome in ('accepted','revoked','limited','handoff'));

create or replace function public.fmat_photon_handoff(p_operation text,p_project_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i fmat.photon_inbox; j fmat.jobs; h fmat.photon_handoffs; r fmat.photon_receivers; publication record; outcome text; action text; valid boolean;
begin
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 if p_operation='prepare' then
  select j0.* into j from fmat.jobs j0 join fmat.photon_inbox i0 on j0.dedupe_key='photon-ingress:'||i0.id::text and j0.kind='photon_ingress'
   where i0.project_id=p_project_id and i0.link_id is null and i0.processed_at is null
    and ((j0.status='pending' and j0.available_at<=clock_timestamp()) or (j0.status='running' and j0.lease_until<=clock_timestamp()))
   order by i0.received_order limit 1 for update of j0 skip locked;
  if not found then return jsonb_build_object('outcome','idle');end if;
  select * into strict i from fmat.photon_inbox where id=(j.payload->>'inboxId')::uuid;
 else
  if p_operation='claim' then
   select * into h from fmat.photon_handoffs where project_id=p_project_id and revoked_at is null and status in ('prepared','uncertain','accepted')
    and (lease_until is null or lease_until<=clock_timestamp()) and (checked_at is null or checked_at<=clock_timestamp()-interval '30 seconds')
    order by coalesce(checked_at,created_at),id limit 1;
   if not found then return jsonb_build_object('action','idle');end if;
  else
   select * into h from fmat.photon_handoffs where id=(p_input->>'handoffId')::uuid and project_id=p_project_id;
   if not found then raise exception 'NOT_FOUND';end if;
  end if;
  select * into strict i from fmat.photon_inbox where id=h.inbox_id;
 end if;
 if p_operation<>'finish' then
  -- Receiver -> phone advisory -> handoff. Future host binding takes its host
  -- lock first and must preserve this order when starting the fresh challenge.
  select * into r from fmat.photon_receivers where project_id=p_project_id for share;
  perform pg_advisory_xact_lock(hashtextextended('photon-link:'||p_project_id::text||':'||i.sender_id,0));
  valid:=r.enabled and r.receiver_id is not distinct from i.receiver_id
   and i.sender_id~'^\+[1-9][0-9]{7,14}$' and i.space_id='any;-;'||i.sender_id
   and i.link_id is null and i.occurred_at>=i.received_at-interval '5 minutes' and i.occurred_at<=i.received_at+interval '5 minutes'
   and not exists(select 1 from fmat.photon_links where project_id=p_project_id and phone=i.sender_id and revoked_at is null);
 end if;
 if p_operation='prepare' then
  if not coalesce(valid,false) or i.received_at+interval '15 minutes'<=clock_timestamp() then outcome:='revoked';
  elsif exists(select 1 from fmat.photon_handoffs prior join fmat.photon_inbox pi on pi.id=prior.inbox_id
    where prior.project_id=p_project_id and pi.sender_id=i.sender_id and prior.created_at>clock_timestamp()-interval '5 minutes')
   or (select count(*) from fmat.photon_handoffs prior join fmat.photon_inbox pi on pi.id=prior.inbox_id
    where prior.project_id=p_project_id and pi.sender_id=i.sender_id and prior.created_at>clock_timestamp()-interval '1 hour')>=5 then outcome:='limited';
  else
   if coalesce(p_input->>'tokenHash','')!~'^[a-f0-9]{64}$' or length(coalesce(p_input->>'encryptedToken','')) not between 30 and 2048 then raise exception 'INVALID_INPUT';end if;
   insert into fmat.photon_handoffs(id,inbox_id,project_id,token_hash,encrypted_token,expires_at)
    values((p_input->>'handoffId')::uuid,i.id,p_project_id,p_input->>'tokenHash',p_input->>'encryptedToken',i.received_at+interval '15 minutes');
   outcome:='handoff';
  end if;
  update fmat.photon_inbox set processed_at=clock_timestamp(),processing_outcome=outcome where id=i.id;
  update fmat.jobs set status='complete',lease_token=null,lease_until=null,worker_id=null,last_error=null,result=jsonb_build_object('outcome',outcome),updated_at=clock_timestamp() where id=j.id;
  for publication in select message_id from fmat.queue_publications where job_id=j.id and acknowledged_at is null loop
   perform pgmq.archive('fmat_jobs',publication.message_id);
  end loop;
  update fmat.queue_publications set acknowledged_at=clock_timestamp() where job_id=j.id and acknowledged_at is null;
  return jsonb_build_object('outcome',outcome);
 end if;
 select * into h from fmat.photon_handoffs where id=h.id for update;
 if p_operation='resolve' then
  if not coalesce(valid,false) or h.revoked_at is not null or h.expires_at<=clock_timestamp()
   or h.status not in ('uncertain','accepted','delivered') or h.token_hash is distinct from p_input->>'tokenHash' then raise exception 'CHALLENGE_INVALID';end if;
  -- Server-only projection; browser adapters must expose masked metadata and
  -- bind a browser proof before requesting a fresh authenticated challenge.
  return jsonb_build_object('handoffId',h.id,'phone',i.sender_id,'line',i.line,'spaceId',i.space_id,'expiresAt',h.expires_at);
 elsif p_operation='claim' then
  if h.revoked_at is not null or h.status not in ('prepared','uncertain','accepted') or h.lease_until>clock_timestamp()
   or h.checked_at>clock_timestamp()-interval '30 seconds' then return jsonb_build_object('action','idle');end if;
  if not coalesce(valid,false) or h.expires_at<=clock_timestamp() then
   update fmat.photon_handoffs set revoked_at=clock_timestamp(),encrypted_token=null,lease_token=null,lease_until=null where id=h.id;
   return jsonb_build_object('action','suppressed');
  end if;
  action:=case when h.status='prepared' then 'send' else 'reconcile' end;
  update fmat.photon_handoffs set status=case when action='send' then 'uncertain' else status end,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',checked_at=clock_timestamp()
   where id=h.id returning * into h;
  return jsonb_build_object('action',action,'handoffId',h.id,'projectId',h.project_id,'phone',i.sender_id,'line',i.line,'spaceId',i.space_id,
   'encryptedToken',case when action='send' then h.encrypted_token else null end,'providerReference',h.provider_reference,'leaseToken',h.lease_token);
 end if;
 if h.lease_token is null or h.lease_token is distinct from (p_input->>'leaseToken')::uuid or h.lease_until<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
 if p_operation='authorize' then
  if not coalesce(valid,false) or h.revoked_at is not null or h.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN';end if;
  return '{}'::jsonb;
 elsif p_operation='finish' then
  if p_input->>'status' is null or p_input->>'status' not in ('uncertain','accepted','delivered','failed','revoked') then raise exception 'INVALID_INPUT';end if;
  if h.provider_reference is not null and p_input->>'providerReference' is not null and h.provider_reference<>p_input->>'providerReference' then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  update fmat.photon_handoffs set status=case when p_input->>'status'='revoked' then status when status='accepted' and p_input->>'status'='uncertain' then status else p_input->>'status' end,
   provider_reference=coalesce(p_input->>'providerReference',provider_reference),
   revoked_at=case when p_input->>'status'='revoked' then coalesce(revoked_at,clock_timestamp()) else revoked_at end,
   encrypted_token=case when p_input->>'status' in ('delivered','failed','revoked') then null else encrypted_token end,lease_token=null,lease_until=null where id=h.id;
  return '{}'::jsonb;
 end if;
 raise exception 'INVALID_INPUT';
end;
$$;
revoke all on function public.fmat_photon_handoff(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_photon_handoff(text,uuid,jsonb) to service_role;
