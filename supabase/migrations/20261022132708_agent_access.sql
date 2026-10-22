CREATE TABLE "app"."agent_authorization_codes" (
  "code_hash"         text                     NOT NULL,
  "grant_id"          uuid                     NOT NULL,
  "client_id"         text                     NOT NULL,
  "redirect_uri"      text                     NOT NULL,
  "code_challenge"    text                     NOT NULL,
  "resource"          text                     NOT NULL,
  "scopes"            text[]                   NOT NULL,
  "refresh_family_id" uuid,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at"        timestamp with time zone NOT NULL DEFAULT (now() + '00:01:00'::interval),
  "consumed_at"       timestamp with time zone,
  CONSTRAINT "agent_authorization_codes_pkey" PRIMARY KEY (code_hash)
);

ALTER TABLE "app"."agent_authorization_codes"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."agent_authorization_transactions" (
  "id"                     uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "client_id"              text                     NOT NULL,
  "redirect_uri"           text                     NOT NULL,
  "state"                  text,
  "code_challenge"         text                     NOT NULL,
  "resource"               text                     NOT NULL,
  "role"                   text                     NOT NULL,
  "target_host_account_id" uuid,
  "target_handle"          text,
  "requested_scopes"       text[]                   NOT NULL,
  "binding_hash"           text                     NOT NULL,
  "source_hash"            text                     NOT NULL,
  "created_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at"             timestamp with time zone NOT NULL DEFAULT (now() + '00:10:00'::interval),
  "decided_at"             timestamp with time zone,
  "decision"               text,
  CONSTRAINT "agent_authorization_transactions_code_challenge_check" CHECK ((code_challenge ~ '^[A-Za-z0-9_-]{43,128}$'::text)),
  CONSTRAINT "agent_authorization_transactions_decided" CHECK (((decided_at IS NULL) = (decision IS NULL))),
  CONSTRAINT "agent_authorization_transactions_decision_check" CHECK ((decision = ANY (ARRAY['allowed'::text, 'denied'::text]))),
  CONSTRAINT "agent_authorization_transactions_pkey" PRIMARY KEY (id),
  CONSTRAINT "agent_authorization_transactions_redirect_uri_check" CHECK ((char_length(redirect_uri) <= 2000)),
  CONSTRAINT "agent_authorization_transactions_requested_scopes_check" CHECK ((cardinality(requested_scopes) >= 1)),
  CONSTRAINT "agent_authorization_transactions_role_check" CHECK ((role = ANY (ARRAY['host'::text, 'requester'::text]))),
  CONSTRAINT "agent_authorization_transactions_state_check" CHECK ((char_length(state) <= 1000)),
  CONSTRAINT "agent_authorization_transactions_target"
    CHECK ((((role = 'host'::text) AND (target_host_account_id IS NULL) AND (target_handle IS NULL)) OR ((role = 'requester'::text) AND (target_host_account_id IS
    NOT NULL) AND (target_handle IS NOT NULL))))
);

ALTER TABLE "app"."agent_authorization_transactions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."agent_clients" (
  "id"                       text                     NOT NULL,
  "kind"                     text                     NOT NULL,
  "client_name"              text                     NOT NULL,
  "client_uri"               text,
  "redirect_uris"            text[]                   NOT NULL,
  "registration_source_hash" text,
  "metadata_fetched_at"      timestamp with time zone,
  "metadata_expires_at"      timestamp with time zone,
  "disabled_at"              timestamp with time zone,
  "created_at"               timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"               timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "agent_clients_client_name_check" CHECK (((char_length(client_name) >= 1) AND (char_length(client_name) <= 200))),
  CONSTRAINT "agent_clients_client_uri_check" CHECK ((char_length(client_uri) <= 2000)),
  CONSTRAINT "agent_clients_id_check" CHECK (((char_length(id) >= 1) AND (char_length(id) <= 2000))),
  CONSTRAINT "agent_clients_kind_check" CHECK ((kind = ANY (ARRAY['first_party'::text, 'registered'::text, 'metadata_document'::text]))),
  CONSTRAINT "agent_clients_metadata_cache" CHECK (((kind = 'metadata_document'::text) = (metadata_expires_at IS NOT NULL))),
  CONSTRAINT "agent_clients_pkey" PRIMARY KEY (id),
  CONSTRAINT "agent_clients_redirect_uris_check" CHECK (((cardinality(redirect_uris) >= 1) AND (cardinality(redirect_uris) <= 10)))
);

ALTER TABLE "app"."agent_clients"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."agent_grants" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "client_id"          text                     NOT NULL,
  "role"               text                     NOT NULL,
  "host_account_id"    uuid                     NOT NULL,
  "request_id"         uuid,
  "bootstrap"          boolean                  NOT NULL DEFAULT false,
  "creation_retry_key" text,
  "scopes"             text[]                   NOT NULL,
  "resource"           text                     NOT NULL,
  "source_hash"        text                     NOT NULL,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "bound_at"           timestamp with time zone,
  "last_used_at"       timestamp with time zone,
  "expires_at"         timestamp with time zone,
  "revoked_at"         timestamp with time zone,
  "revoke_reason"      text,
  CONSTRAINT "agent_grants_bound" CHECK (((bound_at IS NULL) = ((request_id IS NULL) OR (NOT bootstrap)))),
  CONSTRAINT "agent_grants_creation_retry_key_check" CHECK ((char_length(creation_retry_key) <= 200)),
  CONSTRAINT "agent_grants_pkey" PRIMARY KEY (id),
  CONSTRAINT "agent_grants_revoke_reason_check" CHECK ((revoke_reason = ANY (ARRAY['host'::text, 'requester'::text, 'client'::text, 'family_replay'::text, 'expired'::text]))),
  CONSTRAINT "agent_grants_revoked" CHECK (((revoked_at IS NULL) = (revoke_reason IS NULL))),
  CONSTRAINT "agent_grants_role_check" CHECK ((role = ANY (ARRAY['host'::text, 'requester'::text]))),
  CONSTRAINT "agent_grants_role_target" CHECK ((((role = 'host'::text) AND (request_id IS NULL) AND (NOT bootstrap)) OR ((role = 'requester'::text) AND ((request_id IS
    NOT NULL) OR bootstrap)))),
  CONSTRAINT "agent_grants_scopes_check" CHECK ((cardinality(scopes) >= 1))
);

ALTER TABLE "app"."agent_grants"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."agent_protocol_attempts" (
  "id"         bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "kind"       text                     NOT NULL,
  "key_hash"   text                     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "agent_protocol_attempts_kind_check"
    CHECK ((kind = ANY (ARRAY['registration'::text, 'authorization'::text, 'token'::text, 'metadata_fetch'::text, 'tool_call'::text]))),
  CONSTRAINT "agent_protocol_attempts_pkey" PRIMARY KEY (id)
);

ALTER TABLE "app"."agent_protocol_attempts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."agent_refresh_tokens" (
  "token_hash"  text                     NOT NULL,
  "grant_id"    uuid                     NOT NULL,
  "family_id"   uuid                     NOT NULL,
  "client_id"   text                     NOT NULL,
  "resource"    text                     NOT NULL,
  "scopes"      text[]                   NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at"  timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "revoked_at"  timestamp with time zone,
  CONSTRAINT "agent_refresh_tokens_pkey" PRIMARY KEY (token_hash),
  CONSTRAINT "agent_refresh_tokens_scopes_check" CHECK ((cardinality(scopes) >= 1))
);

ALTER TABLE "app"."agent_refresh_tokens"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "app"."agent_authorization_transactions"
  ADD CONSTRAINT "agent_authorization_transactions_target_host_account_id_fkey" FOREIGN KEY (target_host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."agent_authorization_transactions"
  ADD CONSTRAINT "agent_authorization_transactions_client_id_fkey" FOREIGN KEY (client_id) REFERENCES app.agent_clients(id) ON DELETE CASCADE;

ALTER TABLE "app"."agent_grants"
  ADD CONSTRAINT "agent_grants_client_id_fkey" FOREIGN KEY (client_id) REFERENCES app.agent_clients(id) ON DELETE CASCADE;

ALTER TABLE "app"."agent_grants"
  ADD CONSTRAINT "agent_grants_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."agent_authorization_codes"
  ADD CONSTRAINT "agent_authorization_codes_grant_id_fkey" FOREIGN KEY (grant_id) REFERENCES app.agent_grants(id) ON DELETE CASCADE;

ALTER TABLE "app"."agent_grants"
  ADD CONSTRAINT "agent_grants_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

ALTER TABLE "app"."agent_refresh_tokens"
  ADD CONSTRAINT "agent_refresh_tokens_grant_id_fkey" FOREIGN KEY (grant_id) REFERENCES app.agent_grants(id) ON DELETE CASCADE;

CREATE INDEX agent_authorization_codes_grant_idx ON app.agent_authorization_codes USING btree (grant_id);

CREATE INDEX agent_authorization_transactions_client_idx ON app.agent_authorization_transactions USING btree (client_id);

CREATE INDEX agent_authorization_transactions_host_idx ON app.agent_authorization_transactions USING btree (target_host_account_id);

CREATE INDEX agent_grants_client_idx ON app.agent_grants USING btree (client_id);

CREATE INDEX agent_grants_host_idx ON app.agent_grants USING btree (host_account_id);

CREATE INDEX agent_grants_request_idx ON app.agent_grants USING btree (request_id);

CREATE INDEX agent_protocol_attempts_key_idx ON app.agent_protocol_attempts USING btree (kind, key_hash, created_at);

CREATE INDEX agent_refresh_tokens_family_idx ON app.agent_refresh_tokens USING btree (family_id);

CREATE INDEX agent_refresh_tokens_grant_idx ON app.agent_refresh_tokens USING btree (grant_id);
