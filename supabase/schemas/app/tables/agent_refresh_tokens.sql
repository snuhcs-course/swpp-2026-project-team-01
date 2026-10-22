-- Rotating refresh tokens (agent-access design 5), stored by SHA-256 only. Each
-- use consumes the token and issues the next in the same family. Presenting a
-- consumed or revoked token revokes the whole family and its grant.
CREATE TABLE "app"."agent_refresh_tokens" (
  "token_hash" text PRIMARY KEY,
  "grant_id" uuid NOT NULL REFERENCES "app"."agent_grants" ("id") ON DELETE CASCADE,
  "family_id" uuid NOT NULL,
  "client_id" text NOT NULL,
  "resource" text NOT NULL,
  "scopes" text[] NOT NULL CHECK (cardinality("scopes") >= 1),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "revoked_at" timestamptz
);

CREATE INDEX "agent_refresh_tokens_grant_idx" ON "app"."agent_refresh_tokens" ("grant_id");

CREATE INDEX "agent_refresh_tokens_family_idx" ON "app"."agent_refresh_tokens" ("family_id");

ALTER TABLE "app"."agent_refresh_tokens" ENABLE ROW LEVEL SECURITY;
