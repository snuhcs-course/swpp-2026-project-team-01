create table fmat.requester_email_links (
 id uuid primary key,
 request_id uuid not null references fmat.requests(id),
 token_hash text not null,
 email text not null,
 inbox_id text not null references fmat.agentmail_receivers(inbox_id),
 receiver_id uuid not null,
 operation_key uuid not null,
 request_revision integer not null,
 proof_hash text not null check(proof_hash ~ '^[0-9a-f]{64}$'),
 encrypted_proof text,
 state text not null default 'pending' check(state in ('pending','linked','revoked')),
 thread_id text,
 bound_receipt_id uuid unique references fmat.agentmail_inbox(id),
 created_at timestamptz not null default clock_timestamp(),
 challenge_expires_at timestamptz not null,
 expires_at timestamptz not null,
 bound_at timestamptz,
 revoked_at timestamptz,
 unique(request_id,token_hash,operation_key),
 check((state<>'linked') or (thread_id is not null and bound_receipt_id is not null and bound_at is not null and encrypted_proof is null))
);
alter table fmat.requester_email_links enable row level security;
create unique index requester_email_links_active_request_idx on fmat.requester_email_links(request_id) where state in ('pending','linked');
create unique index requester_email_links_thread_idx on fmat.requester_email_links(inbox_id,thread_id) where state='linked';
create index requester_email_links_recent_idx on fmat.requester_email_links(request_id,created_at desc);
create table fmat.requester_email_evidence (
 receipt_id uuid primary key references fmat.agentmail_inbox(id),
 link_id uuid not null references fmat.requester_email_links(id),
 inbox_id text not null,
 author_email text not null,
 recipient_email text,
 parent_message_id text,
 raw_hash text not null check(raw_hash ~ '^[0-9a-f]{64}$'),
 signature_id text not null check(signature_id ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 unique(inbox_id,signature_id)
);
alter table fmat.requester_email_evidence enable row level security;

create or replace function fmat.invalidate_requester_email_links()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.details->>'requesterEmail' is distinct from old.details->>'requesterEmail'
  or new.contact_verified_email is distinct from old.contact_verified_email or new.token_hash is distinct from old.token_hash
  or new.token_revoked_at is distinct from old.token_revoked_at or new.status in ('booked','withdrawn','declined','expired') then
  update fmat.requester_email_links set state='revoked',encrypted_proof=null,revoked_at=clock_timestamp() where request_id=new.id and state in ('pending','linked');
 end if;
 return new;
end;
$$;
create trigger invalidate_requester_email_links after update of details,contact_verified_email,token_hash,token_revoked_at,status on fmat.requests for each row execute function fmat.invalidate_requester_email_links();

create or replace function fmat.requester_email_view(r fmat.requests,l fmat.requester_email_links,available boolean)
returns jsonb language sql set search_path='' as $$
 select jsonb_build_object('requestId',r.id,'revision',r.revision,'email',r.contact_verified_email,
  'status',case when not available then 'unavailable' when l.id is null then 'unlinked' when l.state='revoked' then 'revoked'
   when l.expires_at<=clock_timestamp() or (l.state='pending' and l.challenge_expires_at<=clock_timestamp()) then 'expired' else l.state end,
  'linkId',l.id,'inboxId',case when available then l.inbox_id else null end,
  'expiresAt',case when l.state='pending' then l.challenge_expires_at else l.expires_at end,
  'encryptedProof',case when available and l.state='pending' and least(l.expires_at,l.challenge_expires_at)>clock_timestamp() then l.encrypted_proof else null end);
$$;

create or replace function public.fmat_requester_email_link(p_operation text,p_credential jsonb,p_receiver_id uuid,p_inbox_id text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r fmat.requests; l fmat.requester_email_links; registration fmat.agentmail_receivers; available boolean;
begin
 if p_operation is null or p_operation not in ('read','start','revoke') or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 -- Always registry before request when both are needed. Revocation is available during outages.
 if p_operation<>'revoke' then select * into registration from fmat.agentmail_receivers where inbox_id=p_inbox_id for share;end if;
 available:=coalesce(registration.enabled and registration.receiver_id=p_receiver_id,false);
 select * into r from fmat.requests where id=(p_input->>'requestId')::uuid for update;
 if not found or p_credential->>'kind' is distinct from 'guest' or p_credential->>'requestId' is distinct from r.id::text
  or p_credential->>'tokenHash' is distinct from r.token_hash or r.token_revoked_at is not null or r.token_expires_at<=clock_timestamp()
  or r.expires_at<=clock_timestamp() or r.status not in ('gathering','negotiating','awaiting_approval') then raise exception 'NOT_FOUND';end if;
 if p_operation='read' then
  if p_input-array['requestId']<>'{}'::jsonb then raise exception 'INVALID_INPUT';end if;
  select * into l from fmat.requester_email_links where request_id=r.id and token_hash=r.token_hash order by created_at desc limit 1;
  available:=available and (l.id is null or l.receiver_id=registration.receiver_id and l.inbox_id=registration.inbox_id);
  return fmat.requester_email_view(r,l,available);
 elsif p_operation='revoke' then
  if p_input-array['requestId','linkId']<>'{}'::jsonb then raise exception 'INVALID_INPUT';end if;
  select * into l from fmat.requester_email_links where id=(p_input->>'linkId')::uuid and request_id=r.id and token_hash=r.token_hash for update;
  if not found then raise exception 'NOT_FOUND';end if;
  update fmat.requester_email_links set state='revoked',encrypted_proof=null,revoked_at=coalesce(revoked_at,clock_timestamp()) where id=l.id returning * into l;
  return fmat.requester_email_view(r,l,true);
 end if;
 if not available then raise exception 'CONFIGURATION_UNAVAILABLE';end if;
 if r.contact_verified_email is null or r.contact_verified_email is distinct from r.details->>'requesterEmail' then raise exception 'CONTACT_NOT_VERIFIED';end if;
 if p_input-array['requestId','revision','idempotencyKey','linkId','proofHash','encryptedProof']<>'{}'::jsonb
  or coalesce(p_input->>'proofHash','') !~ '^[0-9a-f]{64}$' or length(coalesce(p_input->>'encryptedProof','')) not between 20 and 4096
  or p_input->>'idempotencyKey' is null or p_input->>'linkId' is null then raise exception 'INVALID_INPUT';end if;
 select * into l from fmat.requester_email_links where request_id=r.id and token_hash=r.token_hash and operation_key=(p_input->>'idempotencyKey')::uuid;
 if found then
  if l.request_revision is distinct from (p_input->>'revision')::integer or l.inbox_id<>p_inbox_id or l.receiver_id<>p_receiver_id then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return fmat.requester_email_view(r,l,true);
 end if;
 if r.revision is distinct from (p_input->>'revision')::integer then raise exception 'REVISION_CONFLICT';end if;
 if exists(select 1 from fmat.requester_email_links where request_id=r.id and created_at>clock_timestamp()-interval '1 minute')
  or (select count(*) from fmat.requester_email_links where request_id=r.id and created_at>clock_timestamp()-interval '1 hour')>=5 then raise exception 'EMAIL_LINK_LIMIT';end if;
 update fmat.requester_email_links set state='revoked',encrypted_proof=null,revoked_at=clock_timestamp() where request_id=r.id and state in ('pending','linked');
 insert into fmat.requester_email_links(id,request_id,token_hash,email,inbox_id,receiver_id,operation_key,request_revision,proof_hash,encrypted_proof,challenge_expires_at,expires_at)
 values((p_input->>'linkId')::uuid,r.id,r.token_hash,lower(r.contact_verified_email),p_inbox_id,p_receiver_id,(p_input->>'idempotencyKey')::uuid,r.revision,p_input->>'proofHash',p_input->>'encryptedProof',least(clock_timestamp()+interval '15 minutes',r.expires_at,r.token_expires_at),least(r.expires_at,r.token_expires_at)) returning * into l;
 return fmat.requester_email_view(r,l,true);
end;
$$;
revoke all on function public.fmat_requester_email_link(text,jsonb,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_requester_email_link(text,jsonb,uuid,text,jsonb) to service_role;

create or replace function public.fmat_requester_email_receipt(p_operation text,p_receiver_id uuid,p_inbox_id text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare registration fmat.agentmail_receivers; receipt fmat.agentmail_inbox; l fmat.requester_email_links; r fmat.requests; prior fmat.requester_email_evidence; original fmat.agentmail_inbox;
begin
 if p_operation is null or p_operation not in ('read','bind','authorize') or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 select * into registration from fmat.agentmail_receivers where inbox_id=p_inbox_id for share;
 if not found or not registration.enabled or registration.receiver_id is distinct from p_receiver_id then raise exception 'CONFIGURATION_UNAVAILABLE';end if;
 select * into receipt from fmat.agentmail_inbox where id=(p_input->>'receiptId')::uuid and inbox_id=p_inbox_id and receiver_id=p_receiver_id;
 if not found then raise exception 'NOT_FOUND';end if;
 if p_operation='read' then
  if p_input-array['receiptId']<>'{}'::jsonb then raise exception 'INVALID_INPUT';end if;
  return jsonb_build_object('inboxId',receipt.inbox_id,'messageId',receipt.message_id,'threadId',receipt.thread_id,'occurredAt',receipt.occurred_at);
 end if;
 if p_input-array['receiptId','linkId','proofHash','authorEmail','rawHash','signatureId','recipientEmail','parentMessageId']<>'{}'::jsonb
  or coalesce(p_input->>'rawHash','') !~ '^[0-9a-f]{64}$' or coalesce(p_input->>'signatureId','') !~ '^[0-9a-f]{64}$'
  or coalesce(p_input->>'authorEmail','')='' or p_input->>'recipientEmail' is distinct from lower(p_inbox_id) then raise exception 'INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('requester-email-binding',p_inbox_id)::text,0));
 if p_operation='bind' then select * into l from fmat.requester_email_links where id=(p_input->>'linkId')::uuid;
 else select * into l from fmat.requester_email_links where inbox_id=p_inbox_id and thread_id=receipt.thread_id and state='linked';end if;
 if not found then raise exception 'NOT_FOUND';end if;
 select * into r from fmat.requests where id=l.request_id for update;
 select * into l from fmat.requester_email_links where id=l.id for update;
 if l.state='revoked' or l.inbox_id<>p_inbox_id or l.receiver_id<>p_receiver_id or l.expires_at<=clock_timestamp()
  or l.token_hash<>r.token_hash or r.token_revoked_at is not null or r.token_expires_at<=clock_timestamp() or r.expires_at<=clock_timestamp()
  or r.status not in ('gathering','negotiating','awaiting_approval') or r.contact_verified_email is null
  or r.contact_verified_email is distinct from r.details->>'requesterEmail' or l.email<>lower(r.contact_verified_email)
  or l.email is distinct from p_input->>'authorEmail' then raise exception 'NOT_FOUND';end if;
 if p_operation='bind' then
  if l.proof_hash is distinct from p_input->>'proofHash' then raise exception 'CHALLENGE_INVALID';end if;
  if l.state='pending' then
   if l.challenge_expires_at<=clock_timestamp() or receipt.received_at<l.created_at then raise exception 'CHALLENGE_INVALID';end if;
   if exists(select 1 from fmat.requester_email_links where inbox_id=p_inbox_id and thread_id=receipt.thread_id and state='linked' and id<>l.id) then raise exception 'EMAIL_LINK_CONFLICT';end if;
   update fmat.requester_email_links set state='linked',thread_id=receipt.thread_id,bound_receipt_id=receipt.id,bound_at=clock_timestamp(),encrypted_proof=null where id=l.id returning * into l;
  elsif l.bound_receipt_id is distinct from receipt.id or l.thread_id is distinct from receipt.thread_id then raise exception 'IDEMPOTENCY_CONFLICT';end if;
 else
  select * into original from fmat.agentmail_inbox where id=l.bound_receipt_id;
  if l.state<>'linked' or receipt.received_at<l.bound_at or receipt.received_order<=original.received_order then raise exception 'NOT_FOUND';end if;
  if not exists(select 1 from fmat.agentmail_inbox parent join fmat.requester_email_evidence e on e.receipt_id=parent.id
   where parent.inbox_id=p_inbox_id and parent.receiver_id=p_receiver_id and parent.message_id=p_input->>'parentMessageId'
    and parent.thread_id=l.thread_id and parent.received_order<receipt.received_order and e.link_id=l.id) then raise exception 'NOT_FOUND';end if;
 end if;
 select * into prior from fmat.requester_email_evidence where receipt_id=receipt.id;
 if found then
  if prior.link_id<>l.id or prior.author_email<>p_input->>'authorEmail' or prior.raw_hash<>p_input->>'rawHash' or prior.signature_id<>p_input->>'signatureId' or prior.recipient_email is distinct from p_input->>'recipientEmail' or prior.parent_message_id is distinct from p_input->>'parentMessageId' then raise exception 'IDEMPOTENCY_CONFLICT';end if;
 else
  if exists(select 1 from fmat.requester_email_evidence where inbox_id=p_inbox_id and signature_id=p_input->>'signatureId') then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  insert into fmat.requester_email_evidence(receipt_id,link_id,inbox_id,author_email,raw_hash,signature_id,recipient_email,parent_message_id) values(receipt.id,l.id,p_inbox_id,p_input->>'authorEmail',p_input->>'rawHash',p_input->>'signatureId',p_input->>'recipientEmail',p_input->>'parentMessageId');
 end if;
 if p_operation='bind' then return jsonb_build_object('status','linked','linkId',l.id);end if;
 -- Receipt-scoped references only. Downstream commands must recheck this link; never mint a general guest credential.
 return jsonb_build_object('requestId',r.id,'linkId',l.id,'receiptId',receipt.id);
end;
$$;
revoke all on function public.fmat_requester_email_receipt(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_requester_email_receipt(text,uuid,text,jsonb) to service_role;
