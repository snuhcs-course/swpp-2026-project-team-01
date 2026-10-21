-- One feasibility run for a request (design decision 8), at the request and
-- settings revisions it read. A pending evaluation becomes completed and
-- publishes its candidates only if those revisions are unchanged and the deadline
-- has not passed; otherwise it is incomplete and publishes nothing. candidates
-- holds every candidate with its code-computed basis; requester_projection is
-- what the requester audience may see (instants, display times, duration, mode
-- and location plan, never a rule, buffer, travel estimate or event detail);
-- ranking is the validated model order of candidate IDs.
CREATE TABLE "app"."evaluations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "request_revision" integer NOT NULL CHECK ("request_revision" >= 1),
  "settings_revision" integer NOT NULL CHECK ("settings_revision" >= 1),
  "state" text NOT NULL DEFAULT 'pending' CHECK ("state" IN ('pending', 'completed', 'incomplete', 'failed')),
  "deadline_at" timestamptz,
  "candidates" jsonb CHECK (jsonb_typeof("candidates") = 'array'),
  "requester_projection" jsonb CHECK (jsonb_typeof("requester_projection") = 'object'),
  "ranking" jsonb CHECK (jsonb_typeof("ranking") = 'array'),
  "failure_category" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  CONSTRAINT "evaluations_completed" CHECK (("state" = 'pending') = ("completed_at" IS NULL))
);

CREATE INDEX "evaluations_request_idx" ON "app"."evaluations" ("request_id", "created_at" DESC);

ALTER TABLE "app"."evaluations" ENABLE ROW LEVEL SECURITY;
