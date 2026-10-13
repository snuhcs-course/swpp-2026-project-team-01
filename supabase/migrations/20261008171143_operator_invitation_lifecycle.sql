SET local check_function_bodies = off;

CREATE TABLE "fmat"."invitation_deliveries" (
  "invitation_id"      uuid                     NOT NULL,
  "project"            text                     NOT NULL,
  "operator_id"        text                     NOT NULL,
  "issue_key"          uuid                     NOT NULL,
  "recipient"          text                     NOT NULL,
  "origin"             text                     NOT NULL,
  "mode"               text                     NOT NULL,
  "account_id"         text,
  "template_version"   integer                  NOT NULL DEFAULT 1,
  "phase"              text                     NOT NULL,
  "provider_reference" text,
  "created_at"         timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "invitation_deliveries_check1" CHECK (((project <> 'local'::text) OR (mode = 'manual'::text))),
  CONSTRAINT "invitation_deliveries_check" CHECK ((((mode = 'manual'::text) AND (account_id IS NULL)) OR ((mode = 'cloudflare'::text) AND (account_id IS
    NOT NULL) AND (account_id ~ '^[a-f0-9]{32}$'::text)))),
  CONSTRAINT "invitation_deliveries_mode_check" CHECK ((mode = ANY (ARRAY['manual'::text, 'cloudflare'::text]))),
  CONSTRAINT "invitation_deliveries_operator_id_check" CHECK ((operator_id ~ '^[a-zA-Z0-9@._+-]{1,100}$'::text)),
  CONSTRAINT "invitation_deliveries_phase_check"
    CHECK ((phase = ANY (ARRAY['manual'::text, 'pending'::text, 'prepared'::text, 'dispatched'::text, 'sent'::text, 'failed'::text, 'suppressed'::text, 'uncertain'::text]))),
  CONSTRAINT "invitation_deliveries_pkey" PRIMARY KEY (invitation_id),
  CONSTRAINT "invitation_deliveries_project_check" CHECK (((project = 'local'::text) OR (project ~ '^[a-z]{20}$'::text))),
  CONSTRAINT "invitation_deliveries_project_operator_id_issue_key_key" UNIQUE (project, operator_id, issue_key),
  CONSTRAINT "invitation_deliveries_template_version_check" CHECK ((template_version = 1))
);

ALTER TABLE "fmat"."invitation_deliveries"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.invitation_status (
  p_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare i fmat.invitations; d fmat.invitation_deliveries;
begin
 select * into strict i from fmat.invitations where id=p_id;
 select * into strict d from fmat.invitation_deliveries where invitation_id=p_id;
 return jsonb_build_object('invitationId',i.id,'email',i.email,'expiresAt',i.expires_at,
  'status',case when i.redeemed_at is not null then 'redeemed' when i.revoked_at is not null then 'revoked' when i.expires_at<=clock_timestamp() then 'expired' else 'active' end,
  'revoked',i.revoked_at is not null,'delivery',d.mode,'deliveryStatus',d.phase);
end$function$;

CREATE OR REPLACE FUNCTION fmat.onboarding_authorize (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  case p_operation
  when 'waitlist_join','host_public' then return;
  when 'setup_read','invite_redeem' then perform fmat.require_host(p_actor,false);
  when 'setup_save','calendar_read','calendar_save','calendar_disconnect' then perform fmat.require_host(p_actor,true);
  when 'invite_issue','invitation_create','invite_revoke' then
    -- Legacy issuance/revocation cannot bypass the dedicated operator lifecycle.
    raise exception 'FORBIDDEN';
  when 'oauth_start' then
    if p_actor->>'kind'='host' then perform fmat.require_host(p_actor,true);
    elsif p_actor->>'kind'='guest' then perform fmat.authorize_guest(p_actor,(p_actor->>'requestId')::uuid);
    else raise exception 'FORBIDDEN'; end if;
  when 'oauth_consume' then
    if p_actor->>'kind' is distinct from 'public' then raise exception 'FORBIDDEN'; end if;
  when 'credential_save','connection_read','token_update','oauth_cleanup' then
    if p_actor->>'kind' is distinct from 'worker' or coalesce(p_actor->>'id','')='' then raise exception 'FORBIDDEN'; end if;
  else raise exception 'UNKNOWN_OPERATION';
  end case;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.protect_invitation_delivery_context()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
 if (new.invitation_id,new.project,new.operator_id,new.issue_key,new.recipient,new.origin,new.mode,new.account_id,new.template_version,new.created_at)
  is distinct from (old.invitation_id,old.project,old.operator_id,old.issue_key,old.recipient,old.origin,old.mode,old.account_id,old.template_version,old.created_at) then raise exception 'IMMUTABLE_DELIVERY';end if;
 return new;
end$function$;

CREATE OR REPLACE FUNCTION public.fmat_invitation_operator (
  p_operation text,
  p_operator  text,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
#variable_conflict use_variable
-- Column references that share command-local names are explicitly qualified.
declare scope text; record fmat.idempotency; invitation fmat.invitations; delivery fmat.invitation_deliveries;
 id uuid; key uuid; email text; project text; mode text; issued timestamptz; actor jsonb;
begin
 if p_operator is null or p_operator !~ '^[a-zA-Z0-9@._+-]{1,100}$' then raise exception 'FORBIDDEN';end if;
 if p_operation is null or p_operation not in ('issue','status','revoke') or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 project:=p_input->>'project';
 if project is null or (project<>'local' and project !~ '^[a-z]{20}$') then raise exception 'INVALID_INPUT';end if;
 actor:=jsonb_build_object('kind','operator','id',p_operator);
 if p_operation='issue' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('project','email','idempotencyKey','delivery','tokenHash','origin','accountId')) then raise exception 'INVALID_INPUT';end if;
  email:=p_input->>'email';mode:=p_input->>'delivery';
  if email is null or email<>lower(trim(email)) or length(email)>254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   or mode is null or mode not in ('manual','cloudflare') or (project='local' and mode<>'manual')
   or coalesce(p_input->>'tokenHash','') !~ '^[a-f0-9]{64}$'
   or coalesce(p_input->>'origin','') !~ '^https://[a-z0-9][a-z0-9.-]*(:[0-9]{1,5})?$' and not(project='local' and coalesce(p_input->>'origin','') ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$')
   or (mode='cloudflare' and coalesce(p_input->>'accountId','') !~ '^[a-f0-9]{32}$')
   or (mode='manual' and p_input->>'accountId' is not null) then raise exception 'INVALID_INPUT';end if;
 else
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('project','invitationId','idempotencyKey')) or (p_operation='status' and p_input ? 'idempotencyKey') then raise exception 'INVALID_INPUT';end if;
  begin id:=(p_input->>'invitationId')::uuid;exception when invalid_text_representation then raise exception 'INVALID_INPUT';end;
  if id is null then raise exception 'INVALID_INPUT';end if;
 end if;
 if p_operation<>'status' then
  begin key:=(p_input->>'idempotencyKey')::uuid;exception when invalid_text_representation then raise exception 'INVALID_INPUT';end;
  if key is null then raise exception 'INVALID_INPUT';end if;
  scope:='invitation_operator:'||project||':'||p_operator;
  insert into fmat.idempotency(actor_scope,operation,key,input) values(scope,'invitation_'||p_operation,key::text,p_input) on conflict do nothing;
  select * into strict record from fmat.idempotency where actor_scope=scope and operation='invitation_'||p_operation and fmat.idempotency.key=key::text for update;
  if record.input is distinct from p_input then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  if record.result is not null then id:=(record.result->>'invitationId')::uuid;end if;
 end if;
 if p_operation='issue' and record.result is null then
  issued:=clock_timestamp();
  insert into fmat.invitations(email,token_hash,expires_at,issued_by,created_at) values(email,p_input->>'tokenHash',issued+interval '7 days',p_operator,issued) returning fmat.invitations.id into id;
  insert into fmat.invitation_deliveries(invitation_id,project,operator_id,issue_key,recipient,origin,mode,account_id,phase)
   values(id,project,p_operator,key,email,p_input->>'origin',mode,p_input->>'accountId',case when mode='manual' then 'manual' else 'pending' end);
  if mode='cloudflare' then perform fmat.enqueue_job('invitation_delivery','invitation-delivery:'||id::text,jsonb_build_object('invitationId',id));end if;
  perform fmat.audit('invitation_issue',actor,id::text,jsonb_build_object('project',project,'delivery',mode));
 end if;
 -- Lock order for dispatch will be job, invitation, delivery. Never acquire a job here.
 select * into invitation from fmat.invitations where fmat.invitations.id=id for update;
 if not found then raise exception 'NOT_FOUND';end if;
 select * into delivery from fmat.invitation_deliveries where invitation_id=id and fmat.invitation_deliveries.project=project for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if p_operation='revoke' and record.result is null then
  update fmat.invitations set revoked_at=coalesce(revoked_at,clock_timestamp()) where fmat.invitations.id=id;
  update fmat.invitation_deliveries set phase='suppressed' where invitation_id=id and phase in ('pending','prepared');
  perform fmat.audit('invitation_revoke',actor,id::text,jsonb_build_object('project',project));
 end if;
 if p_operation<>'status' and record.result is null then
  update fmat.idempotency set result=jsonb_build_object('invitationId',id) where actor_scope=scope and operation='invitation_'||p_operation and fmat.idempotency.key=key::text;
 end if;
 return fmat.invitation_status(id);
end$function$;

REVOKE ALL ON FUNCTION "public"."fmat_invitation_operator"(text, text, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."invitation_deliveries"
  ADD CONSTRAINT "invitation_deliveries_invitation_id_fkey" FOREIGN KEY (invitation_id) REFERENCES fmat.invitations(id);

CREATE TRIGGER invitation_delivery_context_immutable
  BEFORE UPDATE ON fmat.invitation_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION fmat.protect_invitation_delivery_context();

REVOKE ALL ON FUNCTION "fmat"."invitation_status"(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."protect_invitation_delivery_context"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_invitation_operator"(text, text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_invitation_operator"(text, text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_invitation_operator"(text, text, jsonb) TO "service_role";
