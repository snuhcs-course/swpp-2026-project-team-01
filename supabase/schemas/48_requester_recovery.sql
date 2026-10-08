create table fmat.requester_recoveries (
 id uuid primary key,
 request_id uuid not null references fmat.requests(id),
 key uuid not null,
 email text not null,
 old_token_hash text not null check(old_token_hash ~ '^[a-f0-9]{64}$'),
 proof_hash text not null check(proof_hash ~ '^[a-f0-9]{64}$'),
 encrypted_proof text not null,
 expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 invalidated_at timestamptz,
 redeemed_at timestamptz,
 new_token_hash text check(new_token_hash ~ '^[a-f0-9]{64}$'),
 outbox_id uuid references fmat.outbox(id),
 unique(request_id,key),
 check((redeemed_at is null)=(new_token_hash is null))
);
create index requester_recoveries_request_idx on fmat.requester_recoveries(request_id,created_at desc);
create index requester_recoveries_outbox_idx on fmat.requester_recoveries(outbox_id);
alter table fmat.requester_recoveries enable row level security;
revoke all on fmat.requester_recoveries from public,anon,authenticated,service_role;

create or replace function fmat.invalidate_requester_recovery()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.contact_verified_email is distinct from old.contact_verified_email or new.details->>'requesterEmail' is distinct from old.details->>'requesterEmail'
  or new.token_revoked_at is not null or new.status not in ('gathering','negotiating','awaiting_approval') then
  update fmat.requester_recoveries set invalidated_at=coalesce(invalidated_at,clock_timestamp()) where request_id=new.id;
 elsif new.token_hash is distinct from old.token_hash then
  update fmat.requester_recoveries set invalidated_at=coalesce(invalidated_at,clock_timestamp()) where request_id=new.id and (redeemed_at is null or new_token_hash is distinct from new.token_hash);
 end if;
 return new;
end;
$$;
create trigger requester_recovery_invalidation after update on fmat.requests for each row execute function fmat.invalidate_requester_recovery();
revoke all on function fmat.invalidate_requester_recovery() from public,anon,authenticated,service_role;

create or replace function public.fmat_requester_recovery(p_operation text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r fmat.requests; c fmat.requester_recoveries; outbox uuid;
begin
 if p_operation is null or p_operation not in ('start','redeem') or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 if coalesce(p_input->>'proofHash','') !~ '^[a-f0-9]{64}$' or p_input->>'requestId' is null or p_input->>'challengeId' is null then raise exception 'INVALID_INPUT';end if;
 if p_operation='start' then
  if p_input-array['requestId','challengeId','idempotencyKey','email','proofHash','encryptedProof']<>'{}'::jsonb
   or p_input->>'idempotencyKey' is null or length(coalesce(p_input->>'encryptedProof','')) not between 20 and 4096
   or coalesce(p_input->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID_INPUT';end if;
 else
  if p_input-array['requestId','challengeId','proofHash','newTokenHash']<>'{}'::jsonb or coalesce(p_input->>'newTokenHash','') !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_INPUT';end if;
 end if;
 select * into r from fmat.requests where id=(p_input->>'requestId')::uuid for update;
 if not found or r.status not in ('gathering','negotiating','awaiting_approval') or r.expires_at<=clock_timestamp() or r.token_revoked_at is not null
  or r.contact_verified_email is null or r.contact_verified_email is distinct from r.details->>'requesterEmail' then
  if p_operation='start' then return '{"status":"accepted"}'::jsonb;end if;
  raise exception 'CHALLENGE_INVALID';
 end if;
 if p_operation='start' then
  if lower(p_input->>'email')<>lower(r.contact_verified_email) then return '{"status":"accepted"}'::jsonb;end if;
  -- All duplicate, conflicting and rate-limited requests have the same public outcome.
  if exists(select 1 from fmat.requester_recoveries where request_id=r.id and key=(p_input->>'idempotencyKey')::uuid)
   or exists(select 1 from fmat.requester_recoveries where request_id=r.id and created_at>clock_timestamp()-interval '1 minute')
   or (select count(*) from fmat.requester_recoveries where request_id=r.id and created_at>clock_timestamp()-interval '1 hour')>=5 then return '{"status":"accepted"}'::jsonb;end if;
  update fmat.requester_recoveries set invalidated_at=coalesce(invalidated_at,clock_timestamp()) where request_id=r.id;
  insert into fmat.requester_recoveries(id,request_id,key,email,old_token_hash,proof_hash,encrypted_proof,expires_at)
   values((p_input->>'challengeId')::uuid,r.id,(p_input->>'idempotencyKey')::uuid,r.contact_verified_email,r.token_hash,p_input->>'proofHash',p_input->>'encryptedProof',least(clock_timestamp()+interval '15 minutes',r.expires_at)) returning * into c;
  insert into fmat.outbox(dedupe_key,audience,recipient,payload) values('requester-recovery:'||c.id::text,'requester',jsonb_build_object('email',c.email),jsonb_build_object('type','requester_recovery','requestId',r.id,'challengeId',c.id)) returning id into outbox;
  update fmat.requester_recoveries set outbox_id=outbox where id=c.id;
  perform fmat.enqueue_job('requester_recovery_delivery','requester-recovery:'||c.id::text,jsonb_build_object('outboxId',outbox));
  perform fmat.audit('requester_recovery_requested','{"kind":"public"}',r.id::text,jsonb_build_object('challengeId',c.id));
  return '{"status":"accepted"}'::jsonb;
 end if;
 select * into c from fmat.requester_recoveries where id=(p_input->>'challengeId')::uuid and request_id=r.id for update;
 if not found or c.invalidated_at is not null or c.expires_at<=clock_timestamp() or c.email is distinct from r.contact_verified_email or c.proof_hash<>p_input->>'proofHash' then raise exception 'CHALLENGE_INVALID';end if;
 if c.redeemed_at is not null then
  if c.new_token_hash is distinct from p_input->>'newTokenHash' or c.new_token_hash<>r.token_hash or r.token_expires_at<=clock_timestamp() then raise exception 'CHALLENGE_INVALID';end if;
 else
  if c.old_token_hash<>r.token_hash or p_input->>'newTokenHash'=r.token_hash then raise exception 'CHALLENGE_INVALID';end if;
  update fmat.requester_recoveries set redeemed_at=clock_timestamp(),new_token_hash=p_input->>'newTokenHash' where id=c.id;
  update fmat.requests set token_hash=p_input->>'newTokenHash',token_expires_at=clock_timestamp()+interval '30 days',revision=revision+1,updated_at=clock_timestamp() where id=r.id returning * into r;
  insert into fmat.request_history(request_id,revision,operation,actor,proposal_version) values(r.id,r.revision,'requester_recovered','{"kind":"public"}',r.current_proposal_version);
  perform fmat.audit('requester_recovered','{"kind":"public"}',r.id::text,jsonb_build_object('challengeId',c.id));
 end if;
 return jsonb_build_object('status','recovered','requestId',r.id,'expiresAt',least(r.token_expires_at,r.expires_at));
end;
$$;
revoke all on function public.fmat_requester_recovery(text,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_requester_recovery(text,jsonb) to service_role;
