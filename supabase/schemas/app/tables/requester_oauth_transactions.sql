-- One requester Google consent round trip (design decision 3). state_hash and
-- binding_hash are hashes of the random state parameter and of the browser
-- binding cookie; the PKCE verifier is sealed. An intake transaction names the
-- intake and carries its draft (purpose text, timezone, language); a request
-- transaction names the existing request. A transaction lasts 10 minutes and is
-- consumed once by the callback, including a cancelled consent.
CREATE TABLE "app"."requester_oauth_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "state_hash" text NOT NULL UNIQUE,
  "binding_hash" text NOT NULL,
  "verifier_ciphertext" text NOT NULL,
  "verifier_key_id" text NOT NULL,
  "purpose" text NOT NULL CHECK ("purpose" IN ('intake', 'request')),
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "intake_id" uuid REFERENCES "app"."intakes" ("id") ON DELETE CASCADE,
  "request_id" uuid REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "draft" jsonb CHECK (jsonb_typeof("draft") = 'object'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  "consumed_at" timestamptz,
  CONSTRAINT "requester_oauth_transactions_purpose_target" CHECK (
    ("purpose" = 'intake' AND "intake_id" IS NOT NULL AND "request_id" IS NULL)
    OR ("purpose" = 'request' AND "request_id" IS NOT NULL AND "intake_id" IS NULL)
  )
);

CREATE INDEX "requester_oauth_transactions_host_idx" ON "app"."requester_oauth_transactions" ("host_account_id");

CREATE INDEX "requester_oauth_transactions_intake_idx" ON "app"."requester_oauth_transactions" ("intake_id");

CREATE INDEX "requester_oauth_transactions_request_idx" ON "app"."requester_oauth_transactions" ("request_id");

ALTER TABLE "app"."requester_oauth_transactions" ENABLE ROW LEVEL SECURITY;
