-- A logical conversation with one audience. It outlives the eve sessions that
-- serve it: terminal recovery replaces the session with the next generation and
-- keeps the discussion. Phase 1 has one host setup discussion per host account.
CREATE TABLE "app"."discussions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "principal_type" text NOT NULL CHECK ("principal_type" IN ('host_account', 'requester_request')),
  "principal_id" uuid NOT NULL,
  "audience" text NOT NULL CHECK ("audience" IN ('host_setup')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "discussions_principal_audience_key" UNIQUE ("principal_type", "principal_id", "audience")
);

ALTER TABLE "app"."discussions" ENABLE ROW LEVEL SECURITY;
