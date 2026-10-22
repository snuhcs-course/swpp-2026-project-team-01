-- Host-private preference exceptions for one request (design decision 8). The
-- only kind is the weekly meeting limit waiver. It is bound to the host's
-- settings revision it was granted at and to the request's details: a change of
-- details sets invalidated_at, and a newer settings revision no longer matches.
-- The requester projection never shows it.
CREATE TABLE "app"."request_exceptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "kind" text NOT NULL CHECK ("kind" IN ('weekly_limit')),
  "settings_revision" integer NOT NULL CHECK ("settings_revision" >= 1),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "invalidated_at" timestamptz
);

CREATE UNIQUE INDEX "request_exceptions_one_live_idx" ON "app"."request_exceptions" ("request_id", "kind")
  WHERE "invalidated_at" IS NULL;

ALTER TABLE "app"."request_exceptions" ENABLE ROW LEVEL SECURITY;
