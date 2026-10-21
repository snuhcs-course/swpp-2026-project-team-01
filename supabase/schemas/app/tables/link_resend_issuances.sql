-- One row per booking link resend issued (design decision 7), for the limits per
-- request, per recipient across requests and service-wide. recipient_hash is a
-- keyed hash of the address; request_id is the matched request.
CREATE TABLE "app"."link_resend_issuances" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "request_id" uuid REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "recipient_hash" text NOT NULL,
  "retry_key" text NOT NULL CHECK (char_length("retry_key") BETWEEN 1 AND 200),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "link_resend_issuances_request_idx" ON "app"."link_resend_issuances" ("request_id", "created_at");

CREATE INDEX "link_resend_issuances_recipient_idx" ON "app"."link_resend_issuances" ("recipient_hash", "created_at");

CREATE INDEX "link_resend_issuances_created_idx" ON "app"."link_resend_issuances" ("created_at");

ALTER TABLE "app"."link_resend_issuances" ENABLE ROW LEVEL SECURITY;
