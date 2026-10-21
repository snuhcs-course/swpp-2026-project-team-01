-- Immutable proposal versions (design decision 12). request.choose_candidate
-- writes the next version from a candidate of the current evaluation; details
-- holds the exact shared details (start and end instants, display timezones,
-- duration, participants, mode, location or link plan). start_at and end_at are
-- copied out so agreement can check the start is still in the future. Rows are
-- inserted, never updated.
CREATE TABLE "app"."proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "version" integer NOT NULL CHECK ("version" >= 1),
  "evaluation_id" uuid NOT NULL REFERENCES "app"."evaluations" ("id"),
  "candidate_id" text NOT NULL,
  "start_at" timestamptz NOT NULL,
  "end_at" timestamptz NOT NULL,
  "details" jsonb NOT NULL CHECK (jsonb_typeof("details") = 'object'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "proposals_request_version_key" UNIQUE ("request_id", "version"),
  CONSTRAINT "proposals_interval" CHECK ("start_at" < "end_at")
);

CREATE INDEX "proposals_evaluation_idx" ON "app"."proposals" ("evaluation_id");

ALTER TABLE "app"."proposals" ENABLE ROW LEVEL SECURITY;
