SET local check_function_bodies = off;

ALTER TABLE "fmat"."requester_email_evidence"
  ADD COLUMN "recipient_email" text;

ALTER TABLE "fmat"."requester_email_evidence"
  ADD COLUMN "parent_message_id" text;

CREATE OR REPLACE FUNCTION fmat.requester_email_execution_actor (
  credential jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare i fmat.agentmail_inbox; l fmat.requester_email_links; r fmat.requests; registration fmat.agentmail_receivers; evidence fmat.requester_email_evidence; original fmat.agentmail_inbox;
begin
 if credential->>'kind' is distinct from 'requester_email' or credential-array['kind','receiptId','linkId','receiverId']<>'{}' then raise exception 'UNAUTHORIZED';end if;
 select * into i from fmat.agentmail_inbox where id=(credential->>'receiptId')::uuid;
 if not found then raise exception 'UNAUTHORIZED';end if;
 select * into registration from fmat.agentmail_receivers where inbox_id=i.inbox_id for share;
 select * into l from fmat.requester_email_links where id=i.link_id and id=(credential->>'linkId')::uuid;
 if not found then raise exception 'UNAUTHORIZED';end if;
 select * into r from fmat.requests where id=l.request_id for update;
 select * into l from fmat.requester_email_links where id=i.link_id for share;
 select * into evidence from fmat.requester_email_evidence where receipt_id=i.id and link_id=l.id;
 select * into original from fmat.agentmail_inbox where id=l.bound_receipt_id;
 if evidence.receipt_id is null or i.verified_text is null or l.state<>'linked' or not registration.enabled
  or registration.receiver_id is distinct from i.receiver_id or i.receiver_id is distinct from (credential->>'receiverId')::uuid
  or l.receiver_id is distinct from i.receiver_id or l.inbox_id<>i.inbox_id or l.thread_id<>i.thread_id
  or l.expires_at<=clock_timestamp() or r.expires_at<=clock_timestamp() or r.token_expires_at<=clock_timestamp()
  or r.token_revoked_at is not null or r.token_hash<>l.token_hash or r.status not in ('gathering','negotiating','awaiting_approval')
  or r.contact_verified_email is null or r.contact_verified_email is distinct from r.details->>'requesterEmail'
  or lower(r.contact_verified_email)<>l.email or evidence.author_email<>l.email
  or evidence.recipient_email is distinct from lower(i.inbox_id)
  or not exists(select 1 from fmat.agentmail_inbox parent join fmat.requester_email_evidence e on e.receipt_id=parent.id where parent.inbox_id=i.inbox_id and parent.receiver_id=i.receiver_id and parent.message_id=evidence.parent_message_id and parent.thread_id=i.thread_id and parent.received_order<i.received_order and e.link_id=l.id)
  or i.received_at<l.bound_at or i.received_order<=original.received_order then raise exception 'UNAUTHORIZED';end if;
 return jsonb_build_object('kind','guest','requestId',r.id,'tokenHash',r.token_hash,'channel','email');
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_requester_email_receipt (
  p_operation   text,
  p_receiver_id uuid,
  p_inbox_id    text,
  p_input       jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

