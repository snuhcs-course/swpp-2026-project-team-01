-- Suggested changes to the shared details (design decision 4, D7), from the
-- host's editor or the assistant's propose_shared_changes. changes holds any of
-- start, durationMinutes, mode, location and linkPlan. A new suggestion
-- supersedes the pending one. Share revised details applies the details, then
-- the checking evaluation (evaluation_id) either writes the next proposal version
-- (shared, proposal_version) or rejects it with a host-private reason.
CREATE TABLE "app"."shared_change_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "source" text NOT NULL CHECK ("source" IN ('assistant', 'host')),
  "base_revision" integer NOT NULL CHECK ("base_revision" >= 1),
  "base_proposal_version" integer,
  "changes" jsonb NOT NULL CHECK (jsonb_typeof("changes") = 'object'),
  "state" text NOT NULL DEFAULT 'pending' CHECK (
    "state" IN ('pending', 'checking', 'shared', 'dismissed', 'superseded', 'rejected')
  ),
  "evaluation_id" uuid REFERENCES "app"."evaluations" ("id") ON DELETE SET NULL,
  "proposal_version" integer,
  "rejection_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz,
  CONSTRAINT "shared_change_drafts_resolved" CHECK (("state" IN ('pending', 'checking')) = ("resolved_at" IS NULL))
);

CREATE UNIQUE INDEX "shared_change_drafts_one_open_idx" ON "app"."shared_change_drafts" ("request_id")
  WHERE "state" IN ('pending', 'checking');

ALTER TABLE "app"."shared_change_drafts" ENABLE ROW LEVEL SECURITY;
