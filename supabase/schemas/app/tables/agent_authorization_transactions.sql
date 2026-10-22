-- One personal-agent authorization request between /connect/authorize and the
-- person's decision (agent-access design 7). It holds the validated client,
-- redirect URI, the client's state, the S256 code challenge, the resource and
-- the requested scopes. A requester resource names the displayed host and its
-- handle. binding_hash is the hash of the browser binding cookie, so only the
-- browser that opened the transaction can decide it. A transaction lasts 10
-- minutes and is decided once.
CREATE TABLE "app"."agent_authorization_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id" text NOT NULL REFERENCES "app"."agent_clients" ("id") ON DELETE CASCADE,
  "redirect_uri" text NOT NULL CHECK (char_length("redirect_uri") <= 2000),
  "state" text CHECK (char_length("state") <= 1000),
  "code_challenge" text NOT NULL CHECK ("code_challenge" ~ '^[A-Za-z0-9_-]{43,128}$'),
  "resource" text NOT NULL,
  "role" text NOT NULL CHECK ("role" IN ('host', 'requester')),
  "target_host_account_id" uuid REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "target_handle" text,
  "requested_scopes" text[] NOT NULL CHECK (cardinality("requested_scopes") >= 1),
  "binding_hash" text NOT NULL,
  "source_hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  "decided_at" timestamptz,
  "decision" text CHECK ("decision" IN ('allowed', 'denied')),
  CONSTRAINT "agent_authorization_transactions_target" CHECK (
    ("role" = 'host' AND "target_host_account_id" IS NULL AND "target_handle" IS NULL)
    OR ("role" = 'requester' AND "target_host_account_id" IS NOT NULL AND "target_handle" IS NOT NULL)
  ),
  CONSTRAINT "agent_authorization_transactions_decided" CHECK (("decided_at" IS NULL) = ("decision" IS NULL))
);

CREATE INDEX "agent_authorization_transactions_client_idx" ON "app"."agent_authorization_transactions" ("client_id");

CREATE INDEX "agent_authorization_transactions_host_idx" ON "app"."agent_authorization_transactions" ("target_host_account_id");

ALTER TABLE "app"."agent_authorization_transactions" ENABLE ROW LEVEL SECURITY;
