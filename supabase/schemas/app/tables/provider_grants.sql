-- The Google Calendar grant of a host: the scopes Google actually granted and the
-- refresh token, sealed with AES-256-GCM under the key named by
-- refresh_token_key_id. The token is never stored in plaintext. invalidated_at is
-- set when Google rejects the refresh token (invalid_grant), and cleared by the
-- next sign-in that records a fresh token: until then the grant supports no
-- calendar-dependent step and the host is not ready.
CREATE TABLE "app"."provider_grants" (
  "host_account_id" uuid PRIMARY KEY REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "provider" text NOT NULL DEFAULT 'google' CHECK ("provider" = 'google'),
  "granted_scopes" text[] NOT NULL DEFAULT '{}',
  "refresh_token_ciphertext" text,
  "refresh_token_key_id" text,
  "scopes_checked_at" timestamptz,
  "invalidated_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "provider_grants_sealed_token" CHECK (
    ("refresh_token_ciphertext" IS NULL) = ("refresh_token_key_id" IS NULL)
  )
);

ALTER TABLE "app"."provider_grants" ENABLE ROW LEVEL SECURITY;
