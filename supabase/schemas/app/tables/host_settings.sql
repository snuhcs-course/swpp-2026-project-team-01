-- The confirmed scheduling policy, written only by Confirm and save proposed
-- settings after its readiness recheck. It is the only source feasibility reads.
-- draft_revision is the draft revision the host reviewed and confirmed.
CREATE TABLE "app"."host_settings" (
  "host_account_id" uuid PRIMARY KEY REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "revision" integer NOT NULL DEFAULT 1 CHECK ("revision" >= 1),
  "settings" jsonb NOT NULL CHECK (jsonb_typeof("settings") = 'object'),
  "draft_revision" integer NOT NULL,
  "confirmed_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "app"."host_settings" ENABLE ROW LEVEL SECURITY;
