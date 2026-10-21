-- Temporary Calendar analysis evidence, one row per scan. It is never policy:
-- adopted values are copied into the draft and settings with their provenance, and
-- app.cleanup_calendar_analyses removes rows older than 24 hours.
CREATE TABLE "app"."calendar_analyses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "roles_revision" integer NOT NULL,
  "state" text NOT NULL DEFAULT 'pending' CHECK ("state" IN ('pending', 'completed', 'failed')),
  "range_start" timestamptz NOT NULL,
  "range_end" timestamptz NOT NULL,
  -- The calendars read, by provider identity and name, with each one's read result.
  "calendars" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "evidence" jsonb,
  "failure_category" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  CONSTRAINT "calendar_analyses_range" CHECK ("range_start" < "range_end")
);

CREATE INDEX "calendar_analyses_host_idx" ON "app"."calendar_analyses" ("host_account_id", "created_at" DESC);

CREATE INDEX "calendar_analyses_created_idx" ON "app"."calendar_analyses" ("created_at");

ALTER TABLE "app"."calendar_analyses" ENABLE ROW LEVEL SECURITY;
