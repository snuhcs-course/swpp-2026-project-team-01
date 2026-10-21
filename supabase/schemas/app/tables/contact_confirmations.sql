-- Confirmation links sent with the creation email (design decision 6). The
-- random single-use token is stored as a hash here and sealed only as the
-- delivery's secret parameter. Opening the link confirms contact_email if the
-- token is unconsumed, not superseded and the request's contact still equals it.
-- A changed contact supersedes earlier tokens, and closure supersedes all.
CREATE TABLE "app"."contact_confirmations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "contact_email" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "delivery_id" uuid REFERENCES "app"."email_deliveries" ("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "consumed_at" timestamptz,
  "superseded_at" timestamptz
);

CREATE INDEX "contact_confirmations_request_idx" ON "app"."contact_confirmations" ("request_id", "created_at");

-- The per-address hourly resend bound.
CREATE INDEX "contact_confirmations_email_idx" ON "app"."contact_confirmations" ("contact_email", "created_at");

CREATE INDEX "contact_confirmations_delivery_idx" ON "app"."contact_confirmations" ("delivery_id");

ALTER TABLE "app"."contact_confirmations" ENABLE ROW LEVEL SECURITY;
