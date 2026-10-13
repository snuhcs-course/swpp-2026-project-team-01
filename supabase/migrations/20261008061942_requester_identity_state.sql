SET local check_function_bodies = off;

CREATE TABLE "fmat"."requester_identity_flows" (
  "id"                 uuid                     NOT NULL,
  "kind"               text                     NOT NULL,
  "target"             text                     NOT NULL,
  "token_hash"         text                     NOT NULL,
  "state_hash"         text                     NOT NULL,
  "binding_hash"       text                     NOT NULL,
  "encrypted_verifier" text,
  "draft"              jsonb                    NOT NULL,
  "request_revision"   integer,
  "identity"           jsonb,
  "created_at"         timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "expires_at"         timestamp with time zone NOT NULL DEFAULT (clock_timestamp() + '00:10:00'::interval),
  "draft_expires_at"   timestamp with time zone NOT NULL DEFAULT (clock_timestamp() + '1 day'::interval),
  "consumed_at"        timestamp with time zone,
  "saved_at"           timestamp with time zone,
  "superseded_at"      timestamp with time zone,
  "proof_applied_at"   timestamp with time zone,
  CONSTRAINT "requester_identity_flows_binding_hash_check" CHECK ((binding_hash ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "requester_identity_flows_kind_check" CHECK ((kind = ANY (ARRAY['intake'::text, 'guest'::text]))),
  CONSTRAINT "requester_identity_flows_pkey" PRIMARY KEY (id),
  CONSTRAINT "requester_identity_flows_state_hash_check" CHECK ((state_hash ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "requester_identity_flows_state_hash_key" UNIQUE (state_hash),
  CONSTRAINT "requester_identity_flows_token_hash_check" CHECK ((token_hash ~ '^[a-f0-9]{64}$'::text))
);

ALTER TABLE "fmat"."requester_identity_flows"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.apply_intake_identity (
  p_request    uuid,
  p_handle     text,
  p_token_hash text
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare r fmat.requests; f fmat.requester_identity_flows;
begin
 select * into strict r from fmat.requests where id=p_request for update;
 if r.token_hash is distinct from p_token_hash or not exists(select 1 from fmat.hosts where id=r.host_id and handle=p_handle)
  or r.token_revoked_at is not null or r.token_expires_at<=clock_timestamp() or r.expires_at<=clock_timestamp()
  or r.status not in ('gathering','negotiating','awaiting_approval') then raise exception 'NOT_FOUND';end if;
 select * into f from fmat.requester_identity_flows where kind='intake' and target=p_handle and token_hash=p_token_hash order by created_at desc,id desc limit 1 for update;
 if f.id is null or f.superseded_at is not null or f.saved_at is null or f.saved_at<=clock_timestamp()-interval '1 hour'
  or f.identity->>'contactVerified' is distinct from 'true' or f.identity->>'email' is distinct from r.details->>'requesterEmail' then return;end if;
 if r.contact_verified_email is not distinct from r.details->>'requesterEmail' then return;end if;
 update fmat.requests set contact_verified_email=r.details->>'requesterEmail' where id=r.id;
 update fmat.requester_identity_flows set proof_applied_at=clock_timestamp() where id=f.id;
 perform fmat.audit('google_contact_verified',jsonb_build_object('kind','guest','requestId',r.id),r.id::text,jsonb_build_object('flowId',f.id));
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_public_intake (
  p_operation  text,
  p_token_hash text,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare h fmat.hosts; g fmat.calendar_connections; u auth.users; r fmat.requests;
 v_result jsonb; v_details jsonb; v_record fmat.idempotency; v_host uuid; v_state jsonb;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or coalesce(p_input->>'handle','') !~ '^[a-z][a-z0-9-]{2,39}$'
  or p_operation is null or p_operation not in ('context','check','refresh','create','replay','resume') then raise exception 'INVALID_INPUT'; end if;
 if p_operation in ('create','replay','resume') then
  if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' then raise exception 'UNAUTHORIZED'; end if;
  -- Serialize recovery and submission even before a request row exists.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public-intake:'||p_token_hash,0));
  select q.* into r from fmat.requests q join fmat.hosts host on host.id=q.host_id
   where q.token_hash=p_token_hash and host.handle=p_input->>'handle' for update of q;
  if found then
   if r.token_expires_at<=clock_timestamp() then raise exception 'NOT_FOUND'; end if;
   if p_operation in ('create','replay') then
    select * into v_record from fmat.idempotency where actor_scope='public:'||p_token_hash and operation='request_create' and key='browser-intake';
    if not found or v_record.input->'details' is distinct from p_input->'details' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   end if;
   v_state:=public.fmat_browser_command('guest_state',jsonb_build_object('kind','guest','requestId',r.id,'tokenHash',p_token_hash),'{}');
   return jsonb_build_object('requestId',r.id,'tokenExpiresAt',r.token_expires_at,'closed',v_state->'closed');
  end if;
  if exists(select 1 from fmat.requests where token_hash=p_token_hash) then raise exception 'NOT_FOUND'; end if;
  -- A rotated token is no longer on its request row. Its creation receipt must
  -- not be mistaken for an unused proof and offered a second creation attempt.
  if exists(select 1 from fmat.idempotency where actor_scope='public:'||p_token_hash and operation='request_create' and key='browser-intake' and result is not null) then raise exception 'NOT_FOUND'; end if;
  if p_operation in ('resume','replay') then return null; end if;
 end if;
 -- Match Auth -> host -> connection ordering used by authenticated setup.
 -- Session logout is irrelevant to a published profile, account revocation is not.
 select id into v_host from fmat.hosts where handle=p_input->>'handle';
 select * into u from auth.users where id=v_host for share;
 if not found or u.deleted_at is not null or u.banned_until>clock_timestamp() or u.email_confirmed_at is null then raise exception 'NOT_FOUND'; end if;
 select * into h from fmat.hosts where id=v_host and handle=p_input->>'handle' for share;
 if not found or not fmat.host_ready(h) then raise exception 'NOT_FOUND'; end if;
 select * into g from fmat.calendar_connections where principal_kind='host' and principal_id=h.id and revoked_at is null for update;
 if not found or not fmat.host_ready(h) then raise exception 'NOT_FOUND'; end if;
 if p_operation='context' then
  return jsonb_build_object('profile',jsonb_build_object('handle',h.handle,'displayName',h.display_name,'timezone',h.rules->>'timezone','durationMinutes',h.rules->'durationMinutes'),
   'grant',jsonb_build_object('principalId',h.id,'connectionId',g.id,'generation',g.generation,'encryptedCredential',g.encrypted_credential,
    'rulesVersion',h.rules_version,'conflictCalendarIds',to_jsonb(h.conflict_calendar_ids),'bookingCalendarId',h.booking_calendar_id));
 end if;
 if (p_input->>'connectionId')::uuid is distinct from g.id or (p_input->>'generation')::uuid is distinct from g.generation
  or (p_input->>'rulesVersion')::integer is distinct from h.rules_version then raise exception 'REVISION_CONFLICT'; end if;
 if p_operation='check' then return jsonb_build_object('current',true); end if;
 if p_operation='refresh' then
  if p_input->>'previousCredential' is distinct from g.encrypted_credential then raise exception 'REVISION_CONFLICT'; end if;
  if length(coalesce(p_input->>'encryptedCredential','')) not between 20 and 131072 then raise exception 'INVALID_INPUT'; end if;
  update fmat.calendar_connections set encrypted_credential=p_input->>'encryptedCredential',updated_at=clock_timestamp() where id=g.id;
  return jsonb_build_object('refreshed',true);
 end if;
 if p_operation='create' then
  if jsonb_typeof(p_input->'details') is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_input->'details') k
   where k not in ('requesterName','requesterEmail','purpose','timezone','durationMinutes','mode','location','windows')) then raise exception 'INVALID_INPUT'; end if;
  v_details:=fmat.normalize_details(p_input->'details');
  v_result:=public.fmat_command('request_create',jsonb_build_object('kind','public','tokenHash',p_token_hash),
   jsonb_build_object('handle',h.handle,'details',p_input->'details','tokenHash',p_token_hash,'idempotencyKey','browser-intake'));
  select * into strict r from fmat.requests where id=(v_result->>'id')::uuid;
  perform fmat.apply_intake_identity(r.id,h.handle,p_token_hash);
  return jsonb_build_object('requestId',r.id,'tokenExpiresAt',r.token_expires_at,'closed',false);
 end if;
 raise exception 'FORBIDDEN';
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then raise exception 'INVALID_INPUT';
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_requester_identity (
  p_operation text,
  p_authority jsonb,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare f fmat.requester_identity_flows; r fmat.requests; v_kind text; v_target text; v_hash text; v_return text; v_identity jsonb;
begin
 if p_operation is null or p_operation not in ('lookup','read','start','consume','save','skip','apply') or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 if p_operation='lookup' then
  select * into f from fmat.requester_identity_flows where state_hash=p_input->>'stateHash';
  if not found or f.binding_hash is distinct from p_input->>'bindingHash' or f.expires_at<=clock_timestamp() or f.consumed_at is not null or f.superseded_at is not null then raise exception 'OAUTH_STATE_INVALID';end if;
  return jsonb_build_object('kind',f.kind,'target',f.target);
 end if;
 v_kind:=p_authority->>'kind';v_hash:=p_authority->>'tokenHash';
 if coalesce(v_hash,'') !~ '^[a-f0-9]{64}$' then raise exception 'UNAUTHORIZED';end if;
 if v_kind='intake' then
  v_target:=p_authority->>'handle';
  if coalesce(v_target,'') !~ '^[a-z][a-z0-9-]{2,39}$' then raise exception 'INVALID_INPUT';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public-intake:'||v_hash,0));
  -- A submitted or rotated intake cannot be reused as an unbound identity draft.
  if exists(select 1 from fmat.requests where token_hash=v_hash) or exists(select 1 from fmat.idempotency where actor_scope='public:'||v_hash and operation='request_create' and result is not null) then raise exception 'NOT_FOUND';end if;
  if not exists(select 1 from fmat.hosts h join auth.users u on u.id=h.id where h.handle=v_target and fmat.host_ready(h) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) and u.email_confirmed_at is not null) then raise exception 'NOT_FOUND';end if;
  v_return:='/'||v_target;
 elsif v_kind='guest' then
  v_target:=p_authority->>'requestId';
  select * into r from fmat.requests where id=v_target::uuid for update;
  if not found or r.token_hash is distinct from v_hash or r.token_revoked_at is not null or r.token_expires_at<=clock_timestamp() or r.expires_at<=clock_timestamp()
   or r.status not in ('gathering','negotiating','awaiting_approval') then raise exception 'NOT_FOUND';end if;
  v_return:='/booking/'||r.id::text;
 else raise exception 'FORBIDDEN';end if;
 -- Request first, then scope/flow locks. Intake creation uses the same scope lock.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('requester-identity:'||v_kind||':'||v_target||':'||v_hash,0));
 select * into f from fmat.requester_identity_flows where kind=v_kind and target=v_target and token_hash=v_hash order by created_at desc,id desc limit 1 for update;
 if p_operation='start' then
  if coalesce(p_input->>'stateHash','') !~ '^[a-f0-9]{64}$' or coalesce(p_input->>'bindingHash','') !~ '^[a-f0-9]{64}$'
   or length(coalesce(p_input->>'encryptedVerifier','')) not between 20 and 16384 or jsonb_typeof(p_input->'draft') is distinct from 'object'
   or octet_length((p_input->'draft')::text)>16384 then raise exception 'INVALID_INPUT';end if;
  if v_kind='guest' and r.revision is distinct from (p_input->>'revision')::integer then raise exception 'REVISION_CONFLICT';end if;
  if (select count(*) from fmat.requester_identity_flows where kind=v_kind and target=v_target and token_hash=v_hash and created_at>clock_timestamp()-interval '10 minutes')>=10 then raise exception 'CONSENT_LIMIT';end if;
  update fmat.requester_identity_flows set superseded_at=clock_timestamp(),encrypted_verifier=null where kind=v_kind and target=v_target and token_hash=v_hash and superseded_at is null;
  insert into fmat.requester_identity_flows(id,kind,target,token_hash,state_hash,binding_hash,encrypted_verifier,draft,request_revision)
   values((p_input->>'flowId')::uuid,v_kind,v_target,v_hash,p_input->>'stateHash',p_input->>'bindingHash',p_input->>'encryptedVerifier',p_input->'draft',r.revision);
  return jsonb_build_object('started',true);
 end if;
 if p_operation='skip' then
  update fmat.requester_identity_flows set superseded_at=clock_timestamp(),encrypted_verifier=null where kind=v_kind and target=v_target and token_hash=v_hash and superseded_at is null;
  return jsonb_build_object('skipped',true);
 end if;
 if p_operation='read' then
  if f.id is null or f.draft_expires_at<=clock_timestamp() then return null;end if;
  return jsonb_build_object('draft',f.draft,'identity',case when f.superseded_at is null and f.saved_at>clock_timestamp()-interval '1 hour' then f.identity-'subject' else null end);
 end if;
 if f.id is null or f.superseded_at is not null then raise exception 'OAUTH_STATE_INVALID';end if;
 if p_operation in ('consume','save') then
  if f.expires_at<=clock_timestamp() or (v_kind='guest' and f.request_revision is distinct from r.revision) then raise exception 'OAUTH_STATE_INVALID';end if;
  if p_operation='consume' then
   if f.state_hash is distinct from p_input->>'stateHash' or f.binding_hash is distinct from p_input->>'bindingHash' or f.consumed_at is not null then raise exception 'OAUTH_STATE_INVALID';end if;
   update fmat.requester_identity_flows set consumed_at=clock_timestamp(),encrypted_verifier=null where id=f.id;
   return jsonb_build_object('flowId',f.id,'returnPath',v_return,'encryptedVerifier',f.encrypted_verifier);
  end if;
  if f.id is distinct from (p_input->>'flowId')::uuid or f.consumed_at is null then raise exception 'OAUTH_STATE_INVALID';end if;
  v_identity:=p_input->'identity';
  if jsonb_typeof(v_identity) is distinct from 'object' or length(coalesce(v_identity->>'subject','')) not between 1 and 300
   or length(coalesce(v_identity->>'email','')) not between 3 and 254 or v_identity->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   or v_identity->>'email'<>lower(v_identity->>'email') or jsonb_typeof(v_identity->'contactVerified') is distinct from 'boolean'
   or length(coalesce(v_identity->>'name',''))>200 or exists(select 1 from jsonb_object_keys(v_identity) k where k not in ('subject','email','name','contactVerified')) then raise exception 'INVALID_INPUT';end if;
  if f.saved_at is not null then
   if f.identity is distinct from v_identity then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   return jsonb_build_object('saved',true);
  end if;
  update fmat.requester_identity_flows set identity=v_identity,saved_at=clock_timestamp() where id=f.id;
  return jsonb_build_object('saved',true);
 end if;
 -- The browser explicitly applies proof only to its current reviewed recipient.
 if v_kind<>'guest' then raise exception 'FORBIDDEN';end if;
 if f.saved_at is null or f.saved_at<=clock_timestamp()-interval '1 hour' or f.identity->>'contactVerified' is distinct from 'true' then raise exception 'CONTACT_NOT_VERIFIED';end if;
 if f.identity->>'email' is distinct from r.details->>'requesterEmail' or p_input->>'email' is distinct from r.details->>'requesterEmail' then raise exception 'REVISION_CONFLICT';end if;
 if f.proof_applied_at is not null then
  if r.contact_verified_email=r.details->>'requesterEmail' then return jsonb_build_object('verified',true,'revision',r.revision);end if;
  raise exception 'OAUTH_STATE_INVALID';
 end if;
 if r.revision is distinct from (p_input->>'revision')::integer then raise exception 'REVISION_CONFLICT';end if;
 update fmat.requests set contact_verified_email=r.details->>'requesterEmail',revision=revision+1,updated_at=clock_timestamp() where id=r.id returning * into r;
 update fmat.requester_identity_flows set proof_applied_at=clock_timestamp() where id=f.id;
 insert into fmat.request_history(request_id,revision,operation,actor,proposal_version) values(r.id,r.revision,'google_contact_verified',jsonb_build_object('kind','guest','requestId',r.id),r.current_proposal_version);
 perform fmat.audit('google_contact_verified',jsonb_build_object('kind','guest','requestId',r.id),r.id::text,jsonb_build_object('flowId',f.id));
 return jsonb_build_object('verified',true,'revision',r.revision);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'INVALID_INPUT';
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_requester_identity"(text, jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE INDEX requester_identity_scope_idx ON fmat.requester_identity_flows USING btree (kind, target, token_hash, created_at DESC);

REVOKE ALL ON FUNCTION "fmat"."apply_intake_identity"(uuid, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_requester_identity"(text, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_requester_identity"(text, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_requester_identity"(text, jsonb, jsonb) TO "service_role";
