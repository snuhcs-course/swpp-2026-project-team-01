-- The host's in-progress setup values, one row per host. Every change advances
-- the revision, which invalidates any review of an older one. "fields" holds one
-- entry per field: the value, its source (stated, inferred or starter_default),
-- whether the host accepted it, and the evidence behind an inference. Scheduling
-- never reads this table; it reads host_settings.
CREATE TABLE "app"."setup_drafts" (
  "host_account_id" uuid PRIMARY KEY REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "revision" integer NOT NULL DEFAULT 1 CHECK ("revision" >= 1),
  "fields" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The host chose Set up manually instead of waiting for, or retrying, a scan.
  "analysis_skipped" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "app"."setup_drafts" ENABLE ROW LEVEL SECURITY;
