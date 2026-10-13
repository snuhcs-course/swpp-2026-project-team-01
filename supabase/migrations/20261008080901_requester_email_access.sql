SET local check_function_bodies = off;

CREATE TABLE "fmat"."requester_email_evidence" (
  "receipt_id"   uuid                     NOT NULL,
  "link_id"      uuid                     NOT NULL,
  "inbox_id"     text                     NOT NULL,
  "author_email" text                     NOT NULL,
  "raw_hash"     text                     NOT NULL,
  "signature_id" text                     NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "requester_email_evidence_inbox_id_signature_id_key" UNIQUE (inbox_id, signature_id),
  CONSTRAINT "requester_email_evidence_pkey" PRIMARY KEY (receipt_id),
  CONSTRAINT "requester_email_evidence_raw_hash_check" CHECK ((raw_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "requester_email_evidence_signature_id_check" CHECK ((signature_id ~ '^[0-9a-f]{64}$'::text))
);

ALTER TABLE "fmat"."requester_email_evidence"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."requester_email_links" (
  "id"                   uuid                     NOT NULL,
  "request_id"           uuid                     NOT NULL,
  "token_hash"           text                     NOT NULL,
  "email"                text                     NOT NULL,
  "inbox_id"             text                     NOT NULL,
  "receiver_id"          uuid                     NOT NULL,
  "operation_key"        uuid                     NOT NULL,
  "request_revision"     integer                  NOT NULL,
  "proof_hash"           text                     NOT NULL,
  "encrypted_proof"      text,
  "state"                text                     NOT NULL DEFAULT 'pending'::text,
  "thread_id"            text,
  "bound_receipt_id"     uuid,
  "created_at"           timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "challenge_expires_at" timestamp with time zone NOT NULL,
  "expires_at"           timestamp with time zone NOT NULL,
  "bound_at"             timestamp with time zone,
  "revoked_at"           timestamp with time zone,
  CONSTRAINT "requester_email_links_bound_receipt_id_key" UNIQUE (bound_receipt_id),
  CONSTRAINT "requester_email_links_check" CHECK (((state <> 'linked'::text) OR ((thread_id IS NOT NULL) AND (bound_receipt_id IS NOT NULL) AND (bound_at IS
    NOT NULL) AND (encrypted_proof IS NULL)))),
  CONSTRAINT "requester_email_links_pkey" PRIMARY KEY (id),
  CONSTRAINT "requester_email_links_proof_hash_check" CHECK ((proof_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "requester_email_links_request_id_token_hash_operation_key_key" UNIQUE (request_id, token_hash, operation_key),
  CONSTRAINT "requester_email_links_state_check" CHECK ((state = ANY (ARRAY['pending'::text, 'linked'::text, 'revoked'::text])))
);

ALTER TABLE "fmat"."requester_email_links"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.invalidate_requester_email_links()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
 if new.details->>'requesterEmail' is distinct from old.details->>'requesterEmail'
  or new.contact_verified_email is distinct from old.contact_verified_email or new.token_hash is distinct from old.token_hash
  or new.token_revoked_at is distinct from old.token_revoked_at or new.status in ('booked','withdrawn','declined','expired') then
  update fmat.requester_email_links set state='revoked',encrypted_proof=null,revoked_at=clock_timestamp() where request_id=new.id and state in ('pending','linked');
 end if;
 return new;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.requester_email_view (
  r         fmat.requests,
  l         fmat.requester_email_links,
  available boolean
)
  RETURNS jsonb
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
 select jsonb_build_object('requestId',r.id,'revision',r.revision,'email',r.contact_verified_email,
  'status',case when not available then 'unavailable' when l.id is null then 'unlinked' when l.state='revoked' then 'revoked'
   when l.expires_at<=clock_timestamp() or (l.state='pending' and l.challenge_expires_at<=clock_timestamp()) then 'expired' else l.state end,
  'linkId',l.id,'inboxId',case when available then l.inbox_id else null end,
  'expiresAt',case when l.state='pending' then l.challenge_expires_at else l.expires_at end,
  'encryptedProof',case when available and l.state='pending' and least(l.expires_at,l.challenge_expires_at)>clock_timestamp() then l.encrypted_proof else null end);
$function$;

CREATE OR REPLACE FUNCTION public.fmat_requester_email_link (
  p_operation   text,
  p_credential  jsonb,
  p_receiver_id uuid,
  p_inbox_id    text,
  p_input       jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_requester_email_link"(text, jsonb, uuid, text, jsonb) FROM PUBLIC, "anon", "authenticated";

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
 if p_input-array['receiptId','linkId','proofHash','authorEmail','rawHash','signatureId']<>'{}'::jsonb
  or coalesce(p_input->>'rawHash','') !~ '^[0-9a-f]{64}$' or coalesce(p_input->>'signatureId','') !~ '^[0-9a-f]{64}$'
  or coalesce(p_input->>'authorEmail','')='' then raise exception 'INVALID_INPUT';end if;
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
 end if;
 select * into prior from fmat.requester_email_evidence where receipt_id=receipt.id;
 if found then
  if prior.link_id<>l.id or prior.author_email<>p_input->>'authorEmail' or prior.raw_hash<>p_input->>'rawHash' or prior.signature_id<>p_input->>'signatureId' then raise exception 'IDEMPOTENCY_CONFLICT';end if;
 else
  if exists(select 1 from fmat.requester_email_evidence where inbox_id=p_inbox_id and signature_id=p_input->>'signatureId') then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  insert into fmat.requester_email_evidence(receipt_id,link_id,inbox_id,author_email,raw_hash,signature_id) values(receipt.id,l.id,p_inbox_id,p_input->>'authorEmail',p_input->>'rawHash',p_input->>'signatureId');
 end if;
 if p_operation='bind' then return jsonb_build_object('status','linked','linkId',l.id);end if;
 -- Receipt-scoped references only. Downstream commands must recheck this link; never mint a general guest credential.
 return jsonb_build_object('requestId',r.id,'linkId',l.id,'receiptId',receipt.id);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_requester_email_receipt"(text, uuid, text, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."requester_email_evidence"
  ADD CONSTRAINT "requester_email_evidence_receipt_id_fkey" FOREIGN KEY (receipt_id) REFERENCES fmat.agentmail_inbox(id);

ALTER TABLE "fmat"."requester_email_links"
  ADD CONSTRAINT "requester_email_links_bound_receipt_id_fkey" FOREIGN KEY (bound_receipt_id) REFERENCES fmat.agentmail_inbox(id);

ALTER TABLE "fmat"."requester_email_links"
  ADD CONSTRAINT "requester_email_links_inbox_id_fkey" FOREIGN KEY (inbox_id) REFERENCES fmat.agentmail_receivers(inbox_id);

ALTER TABLE "fmat"."requester_email_evidence"
  ADD CONSTRAINT "requester_email_evidence_link_id_fkey" FOREIGN KEY (link_id) REFERENCES fmat.requester_email_links(id);

ALTER TABLE "fmat"."requester_email_links"
  ADD CONSTRAINT "requester_email_links_request_id_fkey" FOREIGN KEY (request_id) REFERENCES fmat.requests(id);

CREATE UNIQUE INDEX requester_email_links_active_request_idx ON fmat.requester_email_links USING btree (request_id)
  WHERE (state = ANY (ARRAY['pending'::text, 'linked'::text]));

CREATE INDEX requester_email_links_recent_idx ON fmat.requester_email_links USING btree (request_id, created_at DESC);

CREATE UNIQUE INDEX requester_email_links_thread_idx ON fmat.requester_email_links USING btree (inbox_id, thread_id)
  WHERE (state = 'linked'::text);

CREATE TRIGGER invalidate_requester_email_links
  AFTER UPDATE OF details, contact_verified_email, token_hash, token_revoked_at, status ON fmat.requests
  FOR EACH ROW
  EXECUTE FUNCTION fmat.invalidate_requester_email_links();

REVOKE ALL ON FUNCTION "public"."fmat_requester_email_link"(text, jsonb, uuid, text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_requester_email_link"(text, jsonb, uuid, text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_requester_email_link"(text, jsonb, uuid, text, jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fmat_requester_email_receipt"(text, uuid, text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_requester_email_receipt"(text, uuid, text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_requester_email_receipt"(text, uuid, text, jsonb) TO "service_role";
