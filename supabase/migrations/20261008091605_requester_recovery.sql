SET local check_function_bodies = off;

CREATE TABLE "fmat"."requester_recoveries" (
  "id"              uuid                     NOT NULL,
  "request_id"      uuid                     NOT NULL,
  "key"             uuid                     NOT NULL,
  "email"           text                     NOT NULL,
  "old_token_hash"  text                     NOT NULL,
  "proof_hash"      text                     NOT NULL,
  "encrypted_proof" text                     NOT NULL,
  "expires_at"      timestamp with time zone NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "invalidated_at"  timestamp with time zone,
  "redeemed_at"     timestamp with time zone,
  "new_token_hash"  text,
  "outbox_id"       uuid,
  CONSTRAINT "requester_recoveries_check" CHECK (((redeemed_at IS NULL) = (new_token_hash IS NULL))),
  CONSTRAINT "requester_recoveries_new_token_hash_check" CHECK ((new_token_hash ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "requester_recoveries_old_token_hash_check" CHECK ((old_token_hash ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "requester_recoveries_pkey" PRIMARY KEY (id),
  CONSTRAINT "requester_recoveries_proof_hash_check" CHECK ((proof_hash ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "requester_recoveries_request_id_key_key" UNIQUE (request_id, key)
);

ALTER TABLE "fmat"."requester_recoveries"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.invalidate_requester_recovery()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
 if new.contact_verified_email is distinct from old.contact_verified_email or new.details->>'requesterEmail' is distinct from old.details->>'requesterEmail'
  or new.token_revoked_at is not null or new.status not in ('gathering','negotiating','awaiting_approval') then
  update fmat.requester_recoveries set invalidated_at=coalesce(invalidated_at,clock_timestamp()) where request_id=new.id;
 elsif new.token_hash is distinct from old.token_hash then
  update fmat.requester_recoveries set invalidated_at=coalesce(invalidated_at,clock_timestamp()) where request_id=new.id and (redeemed_at is null or new_token_hash is distinct from new.token_hash);
 end if;
 return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_requester_recovery (
  p_operation text,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_requester_recovery"(text, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."requester_recoveries"
  ADD CONSTRAINT "requester_recoveries_outbox_id_fkey" FOREIGN KEY (outbox_id) REFERENCES fmat.outbox(id);

ALTER TABLE "fmat"."requester_recoveries"
  ADD CONSTRAINT "requester_recoveries_request_id_fkey" FOREIGN KEY (request_id) REFERENCES fmat.requests(id);

CREATE INDEX requester_recoveries_outbox_idx ON fmat.requester_recoveries USING btree (outbox_id);

CREATE INDEX requester_recoveries_request_idx ON fmat.requester_recoveries USING btree (request_id, created_at DESC);

CREATE TRIGGER requester_recovery_invalidation
  AFTER UPDATE ON fmat.requests
  FOR EACH ROW
  EXECUTE FUNCTION fmat.invalidate_requester_recovery();

REVOKE ALL ON FUNCTION "fmat"."invalidate_requester_recovery"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_requester_recovery"(text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_requester_recovery"(text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_requester_recovery"(text, jsonb) TO "service_role";
