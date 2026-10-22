-- Every transactional email (design decision 5), frozen when the domain change
-- that needs it commits: sender, recipients, template and language, and the
-- non-secret template parameters. Any secret parameter (a confirmation token or a
-- booking link) is sealed as one JSON value, rendered only at dispatch, and
-- deleted once the delivery reaches a final state, so a stored row never holds a
-- usable code or link. dispatch_id is sent as X-Fmat-Dispatch-Id. A delivery found
-- in dispatching by a later attempt becomes uncertain and is never sent again.
-- (kind, dedupe_key) makes a concurrent or retried publication one delivery.
-- reply_to is the frozen Reply-To (the other party on a booking confirmation),
-- and attachments the frozen non-secret attachments (the calendar part), each
-- {filename, type, content} with base64 content.
CREATE TABLE "app"."email_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" text NOT NULL CHECK (
    "kind" IN (
      'request_creation', 'link_resend', 'booking_confirmation', 'status_new_version', 'status_declined',
      'status_expired', 'status_pending'
    )
  ),
  "request_id" uuid REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "dedupe_key" text,
  "sender" text NOT NULL,
  "recipients" text[] NOT NULL CHECK (cardinality("recipients") >= 1),
  "template" text NOT NULL,
  "language" text NOT NULL CHECK ("language" IN ('en', 'ko')),
  "reply_to" text,
  "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof("attachments") = 'array'),
  "parameters" jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof("parameters") = 'object'),
  "secret_ciphertext" text,
  "secret_key_id" text,
  "dispatch_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  "state" text NOT NULL DEFAULT 'queued' CHECK (
    "state" IN ('queued', 'dispatching', 'accepted', 'rejected', 'uncertain', 'suppressed')
  ),
  "evidence" jsonb,
  "provider_message_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "dispatched_at" timestamptz,
  "completed_at" timestamptz,
  CONSTRAINT "email_deliveries_kind_dedupe_key_key" UNIQUE ("kind", "dedupe_key"),
  CONSTRAINT "email_deliveries_sealed_secret" CHECK (("secret_ciphertext" IS NULL) = ("secret_key_id" IS NULL)),
  CONSTRAINT "email_deliveries_final" CHECK (
    ("state" IN ('accepted', 'rejected', 'uncertain', 'suppressed')) = ("completed_at" IS NOT NULL)
  ),
  CONSTRAINT "email_deliveries_final_secret" CHECK ("completed_at" IS NULL OR "secret_ciphertext" IS NULL)
);

CREATE INDEX "email_deliveries_request_idx" ON "app"."email_deliveries" ("request_id", "kind", "created_at");

CREATE INDEX "email_deliveries_created_idx" ON "app"."email_deliveries" ("kind", "created_at");

ALTER TABLE "app"."email_deliveries" ENABLE ROW LEVEL SECURITY;
