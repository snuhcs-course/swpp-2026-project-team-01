SET local check_function_bodies = off;

CREATE TABLE "fmat"."oauth_intake_budgets" (
  "bucket"            text                     NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL,
  "used"              integer                  NOT NULL,
  CONSTRAINT "oauth_intake_budgets_bucket_check" CHECK (((bucket = 'service'::text) OR (bucket ~ '^host:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'::text))),
  CONSTRAINT "oauth_intake_budgets_pkey" PRIMARY KEY (bucket),
  CONSTRAINT "oauth_intake_budgets_used_check" CHECK (((used >= 0) AND (used <= 300)))
);

ALTER TABLE "fmat"."oauth_intake_budgets"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."oauth_intakes" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "authorization_id"    uuid                     NOT NULL,
  "host_id"             uuid                     NOT NULL,
  "reserved_request_id" uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "browser_hash"        text                     NOT NULL,
  "created_at"          timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "grant_id"            uuid,
  "granted_at"          timestamp with time zone,
  "create_expires_at"   timestamp with time zone,
  "request_id"          uuid,
  "token_hash"          text,
  "bound_at"            timestamp with time zone,
  "revoked_at"          timestamp with time zone,
  CONSTRAINT "oauth_intake_grant_state" CHECK ((((grant_id IS NULL) AND (granted_at IS NULL) AND (create_expires_at IS NULL)) OR ((grant_id IS NOT NULL) AND (granted_at IS
    NOT NULL) AND (create_expires_at IS NOT NULL) AND (granted_at >= created_at) AND (create_expires_at = (granted_at + '00:15:00'::interval))))),
  CONSTRAINT "oauth_intake_request_state" CHECK ((((request_id IS NULL) AND (token_hash IS NULL) AND (bound_at IS NULL)) OR ((request_id IS NOT NULL) AND (token_hash IS
    NOT NULL) AND (bound_at IS NOT NULL) AND (grant_id IS NOT NULL) AND (request_id = reserved_request_id) AND (bound_at >= granted_at) AND (bound_at < create_expires_at)))),
  CONSTRAINT "oauth_intakes_authorization_id_key" UNIQUE (authorization_id),
  CONSTRAINT "oauth_intakes_browser_hash_check" CHECK ((browser_hash ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "oauth_intakes_grant_id_key" UNIQUE (grant_id),
  CONSTRAINT "oauth_intakes_pkey" PRIMARY KEY (id),
  CONSTRAINT "oauth_intakes_reserved_request_id_key" UNIQUE (reserved_request_id),
  CONSTRAINT "oauth_intakes_token_hash_check" CHECK ((token_hash ~ '^[a-f0-9]{64}$'::text))
);

ALTER TABLE "fmat"."oauth_intakes"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.oauth_intake_preserve_binding()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_auth fmat.oauth_authorizations; v_grant fmat.oauth_grants; v_request fmat.requests;
begin
  if tg_op='UPDATE' then
    if row(new.id,new.authorization_id,new.host_id,new.reserved_request_id,new.browser_hash,new.created_at)
      is distinct from row(old.id,old.authorization_id,old.host_id,old.reserved_request_id,old.browser_hash,old.created_at)
      or (old.grant_id is not null and row(new.grant_id,new.granted_at,new.create_expires_at)
        is distinct from row(old.grant_id,old.granted_at,old.create_expires_at))
      or (old.request_id is not null and row(new.request_id,new.token_hash,new.bound_at)
        is distinct from row(old.request_id,old.token_hash,old.bound_at))
      or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
      or (old.revoked_at is not null and row(new.grant_id,new.request_id) is distinct from row(old.grant_id,old.request_id))
      then raise exception 'INTAKE_BINDING_IMMUTABLE';end if;
  end if;
  -- Recheck identity on creation/attachment, not on revocation: lost authority
  -- must never prevent its own revocation, nor resurrect a rotated request.
  if tg_op='INSERT' then
    select * into v_auth from fmat.oauth_authorizations where id=new.authorization_id;
    if not found or v_auth.browser_hash is distinct from new.browser_hash
      then raise exception 'INVALID_INTAKE_BINDING';end if;
  end if;
  if new.grant_id is not null and (tg_op='INSERT' or old.grant_id is null) then
    select * into v_grant from fmat.oauth_grants where id=new.grant_id;
    if not found or v_grant.actor_kind<>'intake' or v_grant.actor_id<>new.id
      or v_grant.host_id<>new.host_id or v_grant.authorization_id<>new.authorization_id
      then raise exception 'INVALID_INTAKE_BINDING';end if;
  end if;
  if new.request_id is not null and (tg_op='INSERT' or old.request_id is null) then
    select * into v_request from fmat.requests where id=new.request_id;
    if not found or v_request.host_id<>new.host_id or v_request.token_hash<>new.token_hash
      then raise exception 'INVALID_INTAKE_BINDING';end if;
  end if;
  return new;
end$function$;

CREATE OR REPLACE FUNCTION fmat.oauth_intake_take_budget (
  p_host_id uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_service fmat.oauth_intake_budgets; v_host fmat.oauth_intake_budgets;
 v_bucket text; v_now timestamptz;
begin
  if p_host_id is null or not exists(select 1 from fmat.hosts where id=p_host_id) then return false;end if;
  v_bucket:='host:'||p_host_id;
  insert into fmat.oauth_intake_budgets values('service',clock_timestamp(),0) on conflict do nothing;
  select * into v_service from fmat.oauth_intake_budgets where bucket='service' for update;
  insert into fmat.oauth_intake_budgets values(v_bucket,clock_timestamp(),0) on conflict do nothing;
  select * into v_host from fmat.oauth_intake_budgets where bucket=v_bucket for update;
  v_now:=clock_timestamp();
  if v_service.window_started_at+interval '1 hour'<=v_now then
    v_service.window_started_at:=v_now;v_service.used:=0;
  end if;
  if v_host.window_started_at+interval '1 hour'<=v_now then
    v_host.window_started_at:=v_now;v_host.used:=0;
  end if;
  if v_service.used>=300 or v_host.used>=30 then return false;end if;
  update fmat.oauth_intake_budgets set window_started_at=v_service.window_started_at,used=v_service.used+1 where bucket='service';
  update fmat.oauth_intake_budgets set window_started_at=v_host.window_started_at,used=v_host.used+1 where bucket=v_bucket;
  return true;
end$function$;

ALTER TABLE "fmat"."oauth_intakes"
  ADD CONSTRAINT "oauth_intakes_authorization_id_fkey" FOREIGN KEY (authorization_id) REFERENCES fmat.oauth_authorizations(id);

ALTER TABLE "fmat"."oauth_intakes"
  ADD CONSTRAINT "oauth_intakes_grant_id_fkey" FOREIGN KEY (grant_id) REFERENCES fmat.oauth_grants(id);

ALTER TABLE "fmat"."oauth_intakes"
  ADD CONSTRAINT "oauth_intakes_host_id_fkey" FOREIGN KEY (host_id) REFERENCES fmat.hosts(id);

ALTER TABLE "fmat"."oauth_intakes"
  ADD CONSTRAINT "oauth_intakes_request_id_fkey" FOREIGN KEY (request_id) REFERENCES fmat.requests(id);

CREATE INDEX oauth_intakes_host_idx ON fmat.oauth_intakes USING btree (host_id);

CREATE INDEX oauth_intakes_request_idx ON fmat.oauth_intakes USING btree (request_id);

CREATE TRIGGER oauth_intake_binding_guard
  BEFORE INSERT OR UPDATE ON fmat.oauth_intakes
  FOR EACH ROW
  EXECUTE FUNCTION fmat.oauth_intake_preserve_binding();

REVOKE ALL ON FUNCTION "fmat"."oauth_intake_preserve_binding"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."oauth_intake_take_budget"(uuid) FROM PUBLIC;
