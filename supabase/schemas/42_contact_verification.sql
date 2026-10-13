create table fmat.contact_verifications (
 id uuid primary key,
 request_id uuid not null references fmat.requests(id),
 token_hash text not null check(token_hash ~ '^[a-f0-9]{64}$'),
 key uuid not null,
 email text not null,
 request_revision integer not null,
 code_hash text not null check(code_hash ~ '^[a-f0-9]{64}$'),
 encrypted_code text not null,
 failed_attempts integer not null default 0 check(failed_attempts between 0 and 5),
 expires_at timestamptz not null,
 consumed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 outbox_id uuid references fmat.outbox(id),
 unique(request_id,token_hash,key)
);
create index contact_verifications_request_idx on fmat.contact_verifications(request_id,created_at desc);
create index contact_verifications_outbox_idx on fmat.contact_verifications(outbox_id);
alter table fmat.contact_verifications enable row level security;
revoke all on fmat.contact_verifications from public,anon,authenticated,service_role;
create table fmat.contact_confirmations (
 request_id uuid not null references fmat.requests(id),
 token_hash text not null,
 key uuid not null,
 challenge_id uuid not null references fmat.contact_verifications(id),
 code_hash text not null,
 outcome text not null check(outcome in ('verified','invalid_code','locked','expired','superseded')),
 created_at timestamptz not null default clock_timestamp(),
 primary key(request_id,token_hash,key)
);
create index contact_confirmations_challenge_idx on fmat.contact_confirmations(challenge_id);
alter table fmat.contact_confirmations enable row level security;
revoke all on fmat.contact_confirmations from public,anon,authenticated,service_role;
create trigger contact_confirmations_immutable before update on fmat.contact_confirmations for each row execute function fmat.reject_candidate_evaluation_update();

create or replace function fmat.contact_verification_view(p_request fmat.requests)
returns jsonb language plpgsql set search_path='' as $$
declare c fmat.contact_verifications; state text; next_send timestamptz; fifth timestamptz;
begin
 select * into c from fmat.contact_verifications where request_id=p_request.id and token_hash=p_request.token_hash and email=p_request.details->>'requesterEmail' order by created_at desc,id desc limit 1;
 select max(created_at)+interval '1 minute' into next_send from fmat.contact_verifications where request_id=p_request.id;
 select created_at+interval '1 hour' into fifth from fmat.contact_verifications where request_id=p_request.id and created_at>clock_timestamp()-interval '1 hour' order by created_at desc offset 4 limit 1;
 next_send:=greatest(next_send,fifth);
 state:=case when p_request.contact_verified_email=p_request.details->>'requesterEmail' then 'verified'
  when c.id is null then 'unverified' when c.consumed_at is not null then 'superseded'
  when c.failed_attempts>=5 then 'locked' when c.expires_at<=clock_timestamp() then 'expired' else 'pending' end;
 return jsonb_build_object('requestId',p_request.id,'revision',p_request.revision,'email',p_request.details->>'requesterEmail','status',state,
  'challengeId',c.id,'expiresAt',c.expires_at,'attemptsRemaining',case when c.id is null then 5 else 5-c.failed_attempts end,
  'nextSendAt',case when next_send>clock_timestamp() then next_send else null end,
  'deliveryStatus',(select status from fmat.outbox where id=c.outbox_id));
end;
$$;

create or replace function public.fmat_contact_verification(p_operation text,p_credential jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r fmat.requests; c fmat.contact_verifications; prior fmat.contact_confirmations; outcome text; outbox uuid; latest uuid;
begin
 if p_operation is null or p_operation not in ('read','start','confirm') or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 if p_credential->>'kind' is distinct from 'guest' then raise exception 'FORBIDDEN';end if;
 select * into r from fmat.requests where id=(p_input->>'requestId')::uuid for update;
 if not found or p_credential->>'requestId' is distinct from r.id::text or p_credential->>'tokenHash' is distinct from r.token_hash
  or r.token_revoked_at is not null or r.token_expires_at<=clock_timestamp() or r.expires_at<=clock_timestamp()
  or r.status not in ('gathering','negotiating','awaiting_approval') then raise exception 'NOT_FOUND';end if;
 if p_operation='read' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k<>'requestId') then raise exception 'INVALID_INPUT';end if;
  return fmat.contact_verification_view(r);
 end if;
 if p_input->>'idempotencyKey' is null or coalesce(p_input->>'codeHash','') !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_INPUT';end if;
 if p_operation='start' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','revision','email','idempotencyKey','challengeId','codeHash','encryptedCode'))
   or length(coalesce(p_input->>'encryptedCode','')) not between 20 and 4096 or p_input->>'challengeId' is null then raise exception 'INVALID_INPUT';end if;
  select * into c from fmat.contact_verifications where request_id=r.id and token_hash=r.token_hash and key=(p_input->>'idempotencyKey')::uuid;
  if c.id is not null then
   if c.email is distinct from p_input->>'email' or c.request_revision is distinct from (p_input->>'revision')::integer then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   if c.email is distinct from r.details->>'requesterEmail' then raise exception 'CHALLENGE_INVALID';end if;
   return jsonb_build_object('outcome','created','state',fmat.contact_verification_view(r));
  end if;
  if r.revision is distinct from (p_input->>'revision')::integer or p_input->>'email' is distinct from r.details->>'requesterEmail' then raise exception 'REVISION_CONFLICT';end if;
  if coalesce(r.details->>'requesterEmail','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID_INPUT';end if;
  if r.contact_verified_email=r.details->>'requesterEmail' then return jsonb_build_object('outcome','already_verified','state',fmat.contact_verification_view(r));end if;
  if exists(select 1 from fmat.contact_verifications where request_id=r.id and created_at>clock_timestamp()-interval '1 minute')
   or (select count(*) from fmat.contact_verifications where request_id=r.id and created_at>clock_timestamp()-interval '1 hour')>=5 then raise exception 'CONTACT_LIMIT';end if;
  update fmat.contact_verifications set consumed_at=clock_timestamp() where request_id=r.id and consumed_at is null;
  insert into fmat.contact_verifications(id,request_id,token_hash,key,email,request_revision,code_hash,encrypted_code,expires_at)
   values((p_input->>'challengeId')::uuid,r.id,r.token_hash,(p_input->>'idempotencyKey')::uuid,r.details->>'requesterEmail',r.revision,p_input->>'codeHash',p_input->>'encryptedCode',clock_timestamp()+interval '10 minutes') returning * into c;
  insert into fmat.outbox(dedupe_key,audience,recipient,payload) values('verify-contact:'||c.id::text,'requester',jsonb_build_object('email',c.email),jsonb_build_object('type','contact_verification','requestId',r.id,'challengeId',c.id)) returning id into outbox;
  update fmat.contact_verifications set outbox_id=outbox where id=c.id;
  perform fmat.enqueue_job('contact_verification_delivery','contact-verification:'||c.id::text,jsonb_build_object('outboxId',outbox));
  perform fmat.audit('contact_verification_requested',jsonb_build_object('kind','guest','requestId',r.id),r.id::text,jsonb_build_object('challengeId',c.id));
  outcome:='created';
 else
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','challengeId','idempotencyKey','codeHash')) or p_input->>'challengeId' is null then raise exception 'INVALID_INPUT';end if;
  select * into c from fmat.contact_verifications where id=(p_input->>'challengeId')::uuid and request_id=r.id and token_hash=r.token_hash and email=r.details->>'requesterEmail' for update;
  if not found then raise exception 'CHALLENGE_INVALID';end if;
  select * into prior from fmat.contact_confirmations where request_id=r.id and token_hash=r.token_hash and key=(p_input->>'idempotencyKey')::uuid;
  if prior.key is not null then
   if prior.challenge_id<>c.id or prior.code_hash<>p_input->>'codeHash' then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   return jsonb_build_object('outcome',prior.outcome,'state',fmat.contact_verification_view(r));
  end if;
  select id into latest from fmat.contact_verifications where request_id=r.id order by created_at desc,id desc limit 1;
  if c.consumed_at is not null or latest<>c.id then outcome:='superseded';
  elsif c.failed_attempts>=5 then outcome:='locked';
  elsif c.expires_at<=clock_timestamp() then outcome:='expired';
  elsif c.code_hash<>p_input->>'codeHash' then
   update fmat.contact_verifications set failed_attempts=failed_attempts+1 where id=c.id;
   outcome:=case when c.failed_attempts=4 then 'locked' else 'invalid_code' end;
  else
   update fmat.contact_verifications set consumed_at=clock_timestamp() where id=c.id;
   update fmat.requests set contact_verified_email=c.email,revision=revision+1,updated_at=clock_timestamp() where id=r.id returning * into r;
   insert into fmat.request_history(request_id,revision,operation,actor,proposal_version) values(r.id,r.revision,'contact_verified',jsonb_build_object('kind','guest','requestId',r.id),r.current_proposal_version);
   perform fmat.audit('contact_verified',jsonb_build_object('kind','guest','requestId',r.id),r.id::text,jsonb_build_object('challengeId',c.id));
   outcome:='verified';
  end if;
  insert into fmat.contact_confirmations(request_id,token_hash,key,challenge_id,code_hash,outcome) values(r.id,r.token_hash,(p_input->>'idempotencyKey')::uuid,c.id,p_input->>'codeHash',outcome);
 end if;
 return jsonb_build_object('outcome',outcome,'state',fmat.contact_verification_view(r));
end;
$$;
revoke all on function fmat.contact_verification_view(fmat.requests) from public,anon,authenticated,service_role;
revoke all on function public.fmat_contact_verification(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_contact_verification(text,jsonb,jsonb) to service_role;
