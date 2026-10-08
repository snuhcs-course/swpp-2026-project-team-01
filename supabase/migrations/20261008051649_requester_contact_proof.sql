SET local check_function_bodies = off;

CREATE TABLE "fmat"."contact_confirmations" (
  "request_id"   uuid                     NOT NULL,
  "token_hash"   text                     NOT NULL,
  "key"          uuid                     NOT NULL,
  "challenge_id" uuid                     NOT NULL,
  "code_hash"    text                     NOT NULL,
  "outcome"      text                     NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "contact_confirmations_outcome_check" CHECK ((outcome = ANY (ARRAY['verified'::text, 'invalid_code'::text, 'locked'::text, 'expired'::text, 'superseded'::text]))),
  CONSTRAINT "contact_confirmations_pkey" PRIMARY KEY (request_id, token_hash, key)
);

ALTER TABLE "fmat"."contact_confirmations"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."contact_verifications" (
  "id"               uuid                     NOT NULL,
  "request_id"       uuid                     NOT NULL,
  "token_hash"       text                     NOT NULL,
  "key"              uuid                     NOT NULL,
  "email"            text                     NOT NULL,
  "request_revision" integer                  NOT NULL,
  "code_hash"        text                     NOT NULL,
  "encrypted_code"   text                     NOT NULL,
  "failed_attempts"  integer                  NOT NULL DEFAULT 0,
  "expires_at"       timestamp with time zone NOT NULL,
  "consumed_at"      timestamp with time zone,
  "created_at"       timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "outbox_id"        uuid,
  CONSTRAINT "contact_verifications_code_hash_check" CHECK ((code_hash ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "contact_verifications_failed_attempts_check" CHECK (((failed_attempts >= 0) AND (failed_attempts <= 5))),
  CONSTRAINT "contact_verifications_pkey" PRIMARY KEY (id),
  CONSTRAINT "contact_verifications_request_id_token_hash_key_key" UNIQUE (request_id, token_hash, key),
  CONSTRAINT "contact_verifications_token_hash_check" CHECK ((token_hash ~ '^[a-f0-9]{64}$'::text))
);

ALTER TABLE "fmat"."contact_verifications"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.contact_verification_view (
  p_request fmat.requests
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.fmat_command (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_scope text; v_key text; v_record fmat.idempotency; v_result jsonb; v_identity_input jsonb;
begin
  if p_operation in ('contact_start','contact_confirm','candidates_save','proposal_create','proposal_revise','requester_agree','requester_withdraw','host_decline','manual_allowance_save','preference_exception_save')
    or (p_operation='mutation_replay' and p_input->>'operation' in ('contact_start','contact_confirm','proposal_create','proposal_revise','requester_withdraw','host_decline','manual_allowance_save','preference_exception_save')) then raise exception 'FORBIDDEN';end if;
  if jsonb_typeof(p_actor) is distinct from 'object' or jsonb_typeof(p_input) is distinct from 'object' or p_actor->>'kind' is null or p_actor->>'kind' not in ('host','guest','worker','operator','public') then raise exception 'INVALID_INPUT'; end if;
  perform fmat.authorize_command(p_operation,p_actor,p_input);
  if p_operation like 'jobs_%' or p_operation in ('oauth_consume','credential_save','token_update','oauth_cleanup','host_public','setup_read','calendar_read','requests_list','request_read','connection_read','evaluation_read','candidates_save','extraction_save','assistant_message_save','model_claim','request_expire','mutation_replay','delivery_load','delivery_dispatch','delivery_record','booking_load','booking_dispatch','booking_record_outcome','setup_conversation_read','setup_channel_authorize','setup_turn_lookup','setup_bridge_resume','setup_bridge_checkpoint','setup_provider_outbound_claim','setup_provider_outbound_authorize') then return fmat.dispatch_command(p_operation,p_actor,p_input); end if;
  v_key:=p_input->>'idempotencyKey';
  if v_key is null or length(v_key) not between 1 and 200 then raise exception 'IDEMPOTENCY_REQUIRED'; end if;
  v_scope:=coalesce(p_actor->>'kind','')||':'||coalesce(p_actor->>'id',p_actor->>'tokenHash',p_actor->>'email','public');
  v_identity_input:=case
    when p_operation='oauth_start' then jsonb_build_object('context',p_input->'context','idempotencyKey',v_key)
    when p_operation='contact_start' then p_input-'encryptedCode'
    when p_operation='contact_recover' then p_input-'encryptedToken'
    when p_operation='manual_allowance_save' then jsonb_set(p_input,'{allowance}',(p_input->'allowance')-'confirmedAt')
    when p_operation='setup_turn_append' then jsonb_build_object('text',p_input->'text','channel',p_input->'channel','expectedRevision',p_input->'expectedRevision','clientTurnId',p_input->'clientTurnId','providerMessageId',p_input->'providerMessageId','provider',p_input->'provider','senderId',p_input->'senderId','privateConversationId',p_input->'privateConversationId','isGroup',p_input->'isGroup','idempotencyKey',v_key)
    else p_input end;
  insert into fmat.idempotency(actor_scope,operation,key,input) values(v_scope,p_operation,v_key,v_identity_input) on conflict do nothing;
  select * into strict v_record from fmat.idempotency where actor_scope=v_scope and operation=p_operation and key=v_key for update;
  if v_record.input<>v_identity_input then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if v_record.result is not null then
    if p_operation='oauth_start' and not exists(select 1 from fmat.oauth_exchanges where id=(v_record.result->>'exchangeId')::uuid and consumed_at is null and expires_at>now()) then raise exception 'OAUTH_STATE_INVALID'; end if;
    if p_operation='request_create' and not exists(select 1 from fmat.requests r join fmat.hosts h on h.id=r.host_id where r.id=(v_record.result->>'id')::uuid and r.token_hash=p_input->>'tokenHash' and r.token_revoked_at is null and r.expires_at>now() and fmat.host_ready(h)) then raise exception 'REQUEST_CLOSED'; end if;
    if p_operation='contact_redeem' and not exists(select 1 from fmat.requests where id=(p_input->>'requestId')::uuid and token_hash=p_input->>'newTokenHash' and token_revoked_at is null and expires_at>now()) then raise exception 'CONTACT_INVALID'; end if;
    return v_record.result;
  end if;
  v_result:=fmat.dispatch_command(p_operation,p_actor,p_input);
  update fmat.idempotency set result=v_result where actor_scope=v_scope and operation=p_operation and key=v_key;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_contact_verification (
  p_operation  text,
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_contact_verification"(text, jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."contact_confirmations"
  ADD CONSTRAINT "contact_confirmations_request_id_fkey" FOREIGN KEY (request_id) REFERENCES fmat.requests(id);

ALTER TABLE "fmat"."contact_verifications"
  ADD CONSTRAINT "contact_verifications_outbox_id_fkey" FOREIGN KEY (outbox_id) REFERENCES fmat.outbox(id);

ALTER TABLE "fmat"."contact_confirmations"
  ADD CONSTRAINT "contact_confirmations_challenge_id_fkey" FOREIGN KEY (challenge_id) REFERENCES fmat.contact_verifications(id);

ALTER TABLE "fmat"."contact_verifications"
  ADD CONSTRAINT "contact_verifications_request_id_fkey" FOREIGN KEY (request_id) REFERENCES fmat.requests(id);

CREATE INDEX contact_confirmations_challenge_idx ON fmat.contact_confirmations USING btree (challenge_id);

CREATE INDEX contact_verifications_outbox_idx ON fmat.contact_verifications USING btree (outbox_id);

CREATE INDEX contact_verifications_request_idx ON fmat.contact_verifications USING btree (request_id, created_at DESC);

CREATE TRIGGER contact_confirmations_immutable
  BEFORE UPDATE ON fmat.contact_confirmations
  FOR EACH ROW
  EXECUTE FUNCTION fmat.reject_candidate_evaluation_update();

REVOKE ALL ON FUNCTION "fmat"."contact_verification_view"(fmat.requests) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_contact_verification"(text, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_contact_verification"(text, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_contact_verification"(text, jsonb, jsonb) TO "service_role";
