-- A person's consent for one agent client (agent-access design 5 and 8). A
-- host grant binds the host account; a requester grant binds one request of
-- host_account_id, or, while bootstrap and request_id is null, one future
-- request with that host, which expires 24 hours after consent unless
-- create_request binds it. creation_retry_key is the retry key that created the
-- bound request, so an exact retry returns it. Every call and refresh rechecks
-- the grant, its client and the underlying host or request authority.
CREATE TABLE "app"."agent_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id" text NOT NULL REFERENCES "app"."agent_clients" ("id") ON DELETE CASCADE,
  "role" text NOT NULL CHECK ("role" IN ('host', 'requester')),
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "request_id" uuid REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "bootstrap" boolean NOT NULL DEFAULT false,
  "creation_retry_key" text CHECK (char_length("creation_retry_key") <= 200),
  "scopes" text[] NOT NULL CHECK (cardinality("scopes") >= 1),
  "resource" text NOT NULL,
  "source_hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "bound_at" timestamptz,
  "last_used_at" timestamptz,
  "expires_at" timestamptz,
  "revoked_at" timestamptz,
  "revoke_reason" text CHECK ("revoke_reason" IN ('host', 'requester', 'client', 'family_replay', 'expired')),
  CONSTRAINT "agent_grants_role_target" CHECK (
    ("role" = 'host' AND "request_id" IS NULL AND NOT "bootstrap")
    OR ("role" = 'requester' AND ("request_id" IS NOT NULL OR "bootstrap"))
  ),
  CONSTRAINT "agent_grants_bound" CHECK (("bound_at" IS NULL) = ("request_id" IS NULL OR NOT "bootstrap")),
  CONSTRAINT "agent_grants_revoked" CHECK (("revoked_at" IS NULL) = ("revoke_reason" IS NULL))
);

CREATE INDEX "agent_grants_client_idx" ON "app"."agent_grants" ("client_id");

CREATE INDEX "agent_grants_host_idx" ON "app"."agent_grants" ("host_account_id");

CREATE INDEX "agent_grants_request_idx" ON "app"."agent_grants" ("request_id");

ALTER TABLE "app"."agent_grants" ENABLE ROW LEVEL SECURITY;
