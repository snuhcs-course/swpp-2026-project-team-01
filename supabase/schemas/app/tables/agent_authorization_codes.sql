-- Single-use authorization codes (agent-access design 5), stored by SHA-256
-- only and valid 60 seconds. Redemption sets consumed_at once; a second
-- redemption issues nothing and revokes refresh_family_id, the family the
-- first produced.
CREATE TABLE "app"."agent_authorization_codes" (
  "code_hash" text PRIMARY KEY,
  "grant_id" uuid NOT NULL REFERENCES "app"."agent_grants" ("id") ON DELETE CASCADE,
  "client_id" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "code_challenge" text NOT NULL,
  "resource" text NOT NULL,
  "scopes" text[] NOT NULL,
  "refresh_family_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL DEFAULT (now() + interval '60 seconds'),
  "consumed_at" timestamptz
);

CREATE INDEX "agent_authorization_codes_grant_idx" ON "app"."agent_authorization_codes" ("grant_id");

ALTER TABLE "app"."agent_authorization_codes" ENABLE ROW LEVEL SECURITY;
