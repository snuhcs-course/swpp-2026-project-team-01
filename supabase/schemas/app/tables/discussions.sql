-- A logical conversation with one audience. It outlives the eve sessions that
-- serve it: terminal recovery replaces the session with the next generation and
-- keeps the discussion. A host account has one host setup discussion and one
-- host_review discussion per request it reviews (request_id names that
-- request), an intake one public_intake discussion and a request one requester
-- discussion.
CREATE TABLE "app"."discussions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "principal_type" text NOT NULL CHECK ("principal_type" IN ('host_account', 'requester_request', 'public_intake')),
  "principal_id" uuid NOT NULL,
  "audience" text NOT NULL CHECK ("audience" IN ('host_setup', 'host_review', 'public_intake', 'requester')),
  "request_id" uuid REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "discussions_principal_audience_key" UNIQUE NULLS NOT DISTINCT ("principal_type", "principal_id", "audience", "request_id"),
  CONSTRAINT "discussions_host_review_request" CHECK (("audience" = 'host_review') = ("request_id" IS NOT NULL))
);

ALTER TABLE "app"."discussions" ENABLE ROW LEVEL SECURITY;
