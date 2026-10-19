-- Durable application work. A job row is inserted in the same transaction as the
-- domain change that needs it, records the environment that produced it, and is
-- consumed by a worker that holds a lease and the job's current fence. Completed
-- and exhausted jobs stay visible with their outcome or failure category.
CREATE TABLE "app"."jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- One logical job per (kind, dedupe_key): a follow-up published again on
  -- redelivery is not duplicated.
  "dedupe_key" text,
  "producer_environment" text NOT NULL CHECK (
    "producer_environment" IN ('production', 'preview', 'development', 'local', 'unknown')
  ),
  "state" text NOT NULL DEFAULT 'pending' CHECK ("state" IN ('pending', 'running', 'completed', 'exhausted')),
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 5 CHECK ("max_attempts" BETWEEN 1 AND 100),
  "run_after" timestamptz NOT NULL DEFAULT now(),
  -- Incremented on every claim; only the holder of the current fence may record
  -- the outcome.
  "fence" integer NOT NULL DEFAULT 0,
  "lease_owner" text,
  "lease_expires_at" timestamptz,
  "failure_category" text,
  "outcome" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  CONSTRAINT "jobs_kind_dedupe_key_key" UNIQUE ("kind", "dedupe_key"),
  CONSTRAINT "jobs_running_lease" CHECK (("state" = 'running') = ("lease_expires_at" IS NOT NULL))
);

CREATE INDEX "jobs_claimable_idx" ON "app"."jobs" ("producer_environment", "kind", "run_after")
  WHERE "state" IN ('pending', 'running');

ALTER TABLE "app"."jobs" ENABLE ROW LEVEL SECURITY;
