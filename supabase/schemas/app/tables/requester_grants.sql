-- Request-bound Google grants of a requester (design decision 3). Identity and
-- Calendar access are separate rows even when one consent screen asked for both.
-- google_subject_hash is a keyed hash of the Google subject; google_email and
-- email_verified come from the ID token, so Use verified Google email can compare
-- them with the request's contact. Only a calendar grant holds a refresh token,
-- sealed with the context requester_grant:{requestId}, and the calendars the
-- requester chose. Closure, expiry and Disconnect delete the sealed token and set
-- revoked_at in the same transaction; provider_revocation records the best-effort
-- call to Google's revocation endpoint, made only for the subject's last live grant.
-- Requester event contents are read inside an evaluation and never stored.
CREATE TABLE "app"."requester_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "kind" text NOT NULL CHECK ("kind" IN ('identity', 'calendar')),
  "google_subject_hash" text NOT NULL,
  "google_email" text,
  "email_verified" boolean NOT NULL DEFAULT false,
  "granted_scopes" text[] NOT NULL DEFAULT '{}',
  "refresh_token_ciphertext" text,
  "refresh_token_key_id" text,
  "calendar_ids" text[] NOT NULL DEFAULT '{}',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz,
  "provider_revocation" text CHECK ("provider_revocation" IN ('not_needed', 'revoked', 'failed')),
  CONSTRAINT "requester_grants_sealed_token" CHECK (
    ("refresh_token_ciphertext" IS NULL) = ("refresh_token_key_id" IS NULL)
  ),
  CONSTRAINT "requester_grants_token_kind" CHECK ("kind" = 'calendar' OR "refresh_token_ciphertext" IS NULL),
  CONSTRAINT "requester_grants_revoked_token" CHECK ("revoked_at" IS NULL OR "refresh_token_ciphertext" IS NULL)
);

-- At most one live grant of each kind per request.
CREATE UNIQUE INDEX "requester_grants_one_live_idx" ON "app"."requester_grants" ("request_id", "kind")
  WHERE "revoked_at" IS NULL;

-- Whether another live grant shares the Google subject decides revocation.
CREATE INDEX "requester_grants_live_subject_idx" ON "app"."requester_grants" ("google_subject_hash")
  WHERE "revoked_at" IS NULL;

ALTER TABLE "app"."requester_grants" ENABLE ROW LEVEL SECURITY;
