-- Authenticated AgentMail events, stored with their email_receipt job before the
-- receiver acknowledges (requester-email-ingress; requester-email-channel design
-- 1). Only minimized provider locators and the SHA-256 of the signed payload are
-- kept: no body, subject, sender, recipient, header or attachment. event_id is
-- the provider's identity of the event across retries and subscriptions; the
-- delivery (svix) id and the message id are unique too, so a reuse with other
-- evidence is a conflict. outcome is what the job did with the message.
CREATE TABLE "app"."email_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "receiver_id" uuid NOT NULL REFERENCES "app"."email_receivers" ("id"),
  "event_id" text NOT NULL CHECK (char_length("event_id") BETWEEN 1 AND 200),
  "delivery_id" text NOT NULL CHECK (char_length("delivery_id") BETWEEN 1 AND 200),
  "event_type" text NOT NULL CHECK ("event_type" = 'message.received'),
  "inbox_id" text NOT NULL CHECK (char_length("inbox_id") BETWEEN 1 AND 320),
  "thread_id" text NOT NULL CHECK (char_length("thread_id") BETWEEN 1 AND 500),
  "message_id" text NOT NULL CHECK (char_length("message_id") BETWEEN 1 AND 1000),
  "payload_sha256" text NOT NULL CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$'),
  "outcome" text CHECK ("outcome" IN ('forwarded', 'linked', 'started', 'replied', 'ignored')),
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "processed_at" timestamptz,
  CONSTRAINT "email_receipts_event_key" UNIQUE ("event_id"),
  CONSTRAINT "email_receipts_delivery_key" UNIQUE ("delivery_id"),
  CONSTRAINT "email_receipts_message_key" UNIQUE ("inbox_id", "message_id"),
  CONSTRAINT "email_receipts_processed" CHECK (("outcome" IS NULL) = ("processed_at" IS NULL))
);

CREATE INDEX "email_receipts_received_idx" ON "app"."email_receipts" ("received_at");

ALTER TABLE "app"."email_receipts" ENABLE ROW LEVEL SECURITY;
