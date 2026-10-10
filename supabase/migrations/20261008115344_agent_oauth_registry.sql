SET local check_function_bodies = off;

CREATE TABLE "fmat"."oauth_authorizations" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "client_id"      uuid                     NOT NULL,
  "resource"       text                     NOT NULL,
  "redirect_uri"   text                     NOT NULL,
  "scope"          text                     NOT NULL,
  "code_challenge" text                     NOT NULL,
  "state"          text                     NOT NULL,
  "browser_hash"   text                     NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "expires_at"     timestamp with time zone NOT NULL,
  "decision"       text,
  "decided_at"     timestamp with time zone,
  CONSTRAINT "oauth_authorizations_browser_hash_check" CHECK ((browser_hash ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "oauth_authorizations_check1" CHECK (((decision IS NULL) = (decided_at IS NULL))),
  CONSTRAINT "oauth_authorizations_check" CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '00:10:00'::interval)))),
  CONSTRAINT "oauth_authorizations_code_challenge_check" CHECK ((code_challenge ~ '^[A-Za-z0-9_-]{43}$'::text)),
  CONSTRAINT "oauth_authorizations_decision_check" CHECK ((decision = ANY (ARRAY['grant'::text, 'deny'::text]))),
  CONSTRAINT "oauth_authorizations_pkey" PRIMARY KEY (id),
  CONSTRAINT "oauth_authorizations_state_check" CHECK ((((length(state) >= 1) AND (length(state) <= 1024)) AND (state !~ '[[:cntrl:]]'::text)))
);

ALTER TABLE "fmat"."oauth_authorizations"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."oauth_budgets" (
  "name"              text                     NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL,
  "used"              integer                  NOT NULL,
  CONSTRAINT "oauth_budgets_name_check" CHECK ((name = ANY (ARRAY['registration'::text, 'authorization'::text]))),
  CONSTRAINT "oauth_budgets_pkey" PRIMARY KEY (name),
  CONSTRAINT "oauth_budgets_used_check" CHECK (((used >= 0) AND (used <= 600)))
);

ALTER TABLE "fmat"."oauth_budgets"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."oauth_clients" (
  "id"                      uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"                    text                     NOT NULL,
  "redirect_uris"           text[]                   NOT NULL,
  "resource"                text                     NOT NULL,
  "created_at"              timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "disabled_at"             timestamp with time zone,
  "authorization_window_at" timestamp with time zone,
  "authorization_count"     integer                  NOT NULL DEFAULT 0,
  CONSTRAINT "oauth_clients_authorization_count_check" CHECK (((authorization_count >= 0) AND (authorization_count <= 20))),
  CONSTRAINT "oauth_clients_name_check" CHECK ((((length(name) >= 1) AND (length(name) <= 120)) AND (name !~ '[[:cntrl:]]'::text))),
  CONSTRAINT "oauth_clients_pkey" PRIMARY KEY (id),
  CONSTRAINT "oauth_clients_redirect_uris_check" CHECK (((cardinality(redirect_uris) >= 1) AND (cardinality(redirect_uris) <= 5))),
  CONSTRAINT "oauth_clients_resource_check" CHECK (((length(resource) >= 1) AND (length(resource) <= 2048)))
);

ALTER TABLE "fmat"."oauth_clients"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.oauth_redirect_valid (
  p_uri text
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select coalesce(length(p_uri) between 1 and 2048
    and p_uri !~ '[[:space:][:cntrl:]\\#]'
    and (p_uri ~ '^https://[^/@?#:]+(:[0-9]{1,5})?([/?][^#]*)?$'
      or p_uri ~ '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?([/?][^#]*)?$'),false);
$function$;

CREATE OR REPLACE FUNCTION fmat.oauth_scope_valid (
  p_scope text
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select coalesce(length(p_scope) between 1 and 100
    and p_scope=(select string_agg(s,' ' order by s collate "C") from (select distinct unnest(string_to_array(p_scope,' ')) s) t)
    and (string_to_array(p_scope,' ') <@ array['host:read','host:write','host:decide']
      or string_to_array(p_scope,' ') <@ array['request:read','request:write','request:decide']),false);
$function$;

CREATE OR REPLACE FUNCTION fmat.oauth_take_budget (
  p_name text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_row fmat.oauth_budgets; v_now timestamptz; v_limit integer; v_window interval;
begin
  if p_name='registration' then v_limit:=30;v_window:=interval '1 hour';
  elsif p_name='authorization' then v_limit:=600;v_window:=interval '1 minute';
  else raise exception 'INVALID_INPUT';end if;
  insert into fmat.oauth_budgets(name,window_started_at,used) values(p_name,clock_timestamp(),0) on conflict(name) do nothing;
  select * into v_row from fmat.oauth_budgets where name=p_name for update;
  v_now:=clock_timestamp();
  if v_row.window_started_at+v_window<=v_now then
    update fmat.oauth_budgets set window_started_at=v_now,used=1 where name=p_name;return true;
  end if;
  if v_row.used>=v_limit then return false;end if;
  update fmat.oauth_budgets set used=used+1 where name=p_name;
  return true;
end$function$;

CREATE OR REPLACE FUNCTION public.fmat_oauth_authorization_read (
  p_id           uuid,
  p_browser_hash text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_auth fmat.oauth_authorizations; v_client fmat.oauth_clients;
begin
  select * into v_auth from fmat.oauth_authorizations where id=p_id;
  if not found or p_browser_hash is null or v_auth.browser_hash<>p_browser_hash then return '{"error":"invalid_request"}';end if;
  select * into v_client from fmat.oauth_clients where id=v_auth.client_id for share;
  select * into v_auth from fmat.oauth_authorizations where id=p_id for share;
  if v_client.id is null or v_client.disabled_at is not null or v_auth.expires_at<=clock_timestamp()
    or v_auth.browser_hash<>p_browser_hash then return '{"error":"invalid_request"}';end if;
  return jsonb_build_object('authorizationId',v_auth.id,'clientId',v_client.id,'clientName',v_client.name,
    'redirectUri',v_auth.redirect_uri,'resource',v_auth.resource,'scope',v_auth.scope,'state',v_auth.state,
    'decision',v_auth.decision,'expiresAt',v_auth.expires_at);
end$function$;

REVOKE ALL ON FUNCTION "public"."fmat_oauth_authorization_read"(uuid, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fmat_oauth_authorization_start (
  p_input jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_client fmat.oauth_clients; v_auth fmat.oauth_authorizations; v_now timestamptz;
begin
  if not fmat.oauth_take_budget('authorization') then return '{"error":"rate_limited"}';end if;
  if jsonb_typeof(p_input) is distinct from 'object' then return '{"error":"invalid_request"}';end if;
  if (select count(*) from jsonb_object_keys(p_input))<>8
    or not p_input ?& array['clientId','resource','redirectUri','scope','codeChallenge','codeChallengeMethod','state','browserHash']
    or exists(select 1 from jsonb_each(p_input) where jsonb_typeof(value)<>'string')
    or p_input->>'clientId' !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
    then return '{"error":"invalid_request"}';end if;
  -- Lock order is global budget, client, then authorization. Grant/refresh
  -- operations must not acquire budgets after locking a client.
  select * into v_client from fmat.oauth_clients where id=(p_input->>'clientId')::uuid for update;
  if not found or v_client.disabled_at is not null then return '{"error":"invalid_client"}';end if;
  v_now:=clock_timestamp();
  if v_client.authorization_window_at is null or v_client.authorization_window_at+interval '1 minute'<=v_now then
    update fmat.oauth_clients set authorization_window_at=v_now,authorization_count=1 where id=v_client.id;
  elsif v_client.authorization_count>=20 then return '{"error":"rate_limited"}';
  else update fmat.oauth_clients set authorization_count=authorization_count+1 where id=v_client.id;end if;
  if p_input->>'resource'<>v_client.resource then return '{"error":"invalid_target"}';end if;
  if not (p_input->>'redirectUri'=any(v_client.redirect_uris)) then return '{"error":"invalid_request"}';end if;
  if not fmat.oauth_scope_valid(p_input->>'scope') then return '{"error":"invalid_scope"}';end if;
  if p_input->>'codeChallengeMethod'<>'S256' or p_input->>'codeChallenge' !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
    or length(p_input->>'state') not between 1 and 1024 or p_input->>'state' ~ '[[:cntrl:]]'
    or p_input->>'browserHash' !~ '^[a-f0-9]{64}$'
    then return '{"error":"invalid_request"}';end if;
  insert into fmat.oauth_authorizations(client_id,resource,redirect_uri,scope,code_challenge,state,browser_hash,created_at,expires_at)
    values(v_client.id,v_client.resource,p_input->>'redirectUri',p_input->>'scope',p_input->>'codeChallenge',
      p_input->>'state',p_input->>'browserHash',v_now,v_now+interval '10 minutes') returning * into v_auth;
  return jsonb_build_object('authorizationId',v_auth.id,'expiresAt',v_auth.expires_at);
end$function$;

REVOKE ALL ON FUNCTION "public"."fmat_oauth_authorization_start"(jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fmat_oauth_register (
  p_name      text,
  p_redirects text[],
  p_resource  text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_client fmat.oauth_clients;
begin
  if not fmat.oauth_take_budget('registration') then return '{"error":"rate_limited"}';end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 120 or p_name ~ '[[:cntrl:]]'
    or p_redirects is null or cardinality(p_redirects) not between 1 and 5
    or array_ndims(p_redirects)<>1 or array_lower(p_redirects,1)<>1
    or exists(select 1 from unnest(p_redirects) u where not fmat.oauth_redirect_valid(u))
    or (select count(distinct u) from unnest(p_redirects) u)<>cardinality(p_redirects)
    or not fmat.oauth_redirect_valid(p_resource) or p_resource !~ '/mcp$' or p_resource ~ '\?'
    then return '{"error":"invalid_client_metadata"}';end if;
  insert into fmat.oauth_clients(name,redirect_uris,resource) values(btrim(p_name),p_redirects,p_resource) returning * into v_client;
  return jsonb_build_object('clientId',v_client.id,'name',v_client.name,'redirectUris',v_client.redirect_uris,
    'resource',v_client.resource,'createdAt',v_client.created_at);
end$function$;

REVOKE ALL ON FUNCTION "public"."fmat_oauth_register"(text, text[], text) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."oauth_authorizations"
  ADD CONSTRAINT "oauth_authorizations_client_id_fkey" FOREIGN KEY (client_id) REFERENCES fmat.oauth_clients(id);

CREATE INDEX oauth_authorizations_client_idx ON fmat.oauth_authorizations USING btree (client_id);

REVOKE ALL ON FUNCTION "fmat"."oauth_redirect_valid"(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."oauth_scope_valid"(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."oauth_take_budget"(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_oauth_authorization_read"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_oauth_authorization_read"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_oauth_authorization_read"(uuid, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fmat_oauth_authorization_start"(jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_oauth_authorization_start"(jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_oauth_authorization_start"(jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fmat_oauth_register"(text, text[], text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_oauth_register"(text, text[], text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_oauth_register"(text, text[], text) TO "service_role";
