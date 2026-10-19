-- The Google identity behind a host account. The unique Google subject is what
-- makes concurrent first sign-ins create one account.
CREATE TABLE "app"."google_identities" (
  "google_subject" text PRIMARY KEY,
  "host_account_id" uuid NOT NULL UNIQUE REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "auth_user_id" uuid NOT NULL UNIQUE REFERENCES "auth"."users" ("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "app"."google_identities" ENABLE ROW LEVEL SECURITY;
