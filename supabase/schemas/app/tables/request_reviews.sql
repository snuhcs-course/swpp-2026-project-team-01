-- Extracted changes awaiting the requester's explicit Apply these details or
-- Dismiss (design decision 12). A review is made against base_revision of the
-- request; applying it rechecks that revision. intent is what the extraction
-- declared: details and availability carry a patch, question and unknown carry
-- none and at least one authored clarification category. A new review supersedes
-- the earlier pending one, and closure supersedes any pending review. Dismiss
-- records rejected.
CREATE TABLE "app"."request_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "base_revision" integer NOT NULL CHECK ("base_revision" >= 1),
  "intent" text NOT NULL CHECK ("intent" IN ('details', 'availability', 'question', 'unknown')),
  "patch" jsonb CHECK (jsonb_typeof("patch") = 'object'),
  "clarifications" text[] NOT NULL DEFAULT '{}',
  "state" text NOT NULL DEFAULT 'pending' CHECK ("state" IN ('pending', 'applied', 'superseded', 'rejected')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz,
  CONSTRAINT "request_reviews_intent_patch" CHECK (
    ("intent" IN ('details', 'availability') AND "patch" IS NOT NULL)
    OR ("intent" IN ('question', 'unknown') AND "patch" IS NULL AND cardinality("clarifications") >= 1)
  ),
  CONSTRAINT "request_reviews_clarification_categories" CHECK (
    "clarifications" <@ ARRAY[
      'missing_date', 'missing_time', 'missing_timezone', 'ambiguous_local_time', 'missing_duration',
      'missing_mode', 'missing_location', 'unclear_location', 'missing_purpose'
    ]::text[]
  ),
  CONSTRAINT "request_reviews_resolved" CHECK (("state" = 'pending') = ("resolved_at" IS NULL))
);

CREATE INDEX "request_reviews_request_idx" ON "app"."request_reviews" ("request_id", "created_at");

-- At most one pending review per request.
CREATE UNIQUE INDEX "request_reviews_one_pending_idx" ON "app"."request_reviews" ("request_id")
  WHERE "state" = 'pending';

ALTER TABLE "app"."request_reviews" ENABLE ROW LEVEL SECURITY;
