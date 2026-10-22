-- The host's explicit approval of one exact proposal version (calendar-booking:
-- attributable approval), written only by request.approve. request_revision is
-- the revision approval was recorded at, retry_key the card's retry identity.
-- A booking's revalidation conflict or a definitive failure spends it
-- (spent_at); a newer version or changed details leave it naming a superseded
-- proposal, so it can no longer authorize booking. At most one live approval per
-- proposal, so a repeated approval returns the existing booking.
CREATE TABLE "app"."approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "proposal_id" uuid NOT NULL REFERENCES "app"."proposals" ("id") ON DELETE CASCADE,
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "request_revision" integer NOT NULL CHECK ("request_revision" >= 1),
  "retry_key" text NOT NULL CHECK (char_length("retry_key") BETWEEN 1 AND 200),
  "approved_at" timestamptz NOT NULL DEFAULT now(),
  "spent_at" timestamptz
);

CREATE UNIQUE INDEX "approvals_one_live_idx" ON "app"."approvals" ("proposal_id") WHERE "spent_at" IS NULL;

CREATE INDEX "approvals_request_idx" ON "app"."approvals" ("request_id", "approved_at" DESC);

ALTER TABLE "app"."approvals" ENABLE ROW LEVEL SECURITY;
