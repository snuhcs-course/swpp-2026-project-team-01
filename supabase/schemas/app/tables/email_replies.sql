-- Replies the product inbox sends into a thread (requester-email-channel design
-- 6 and 7, D8). The id is the AgentMail Idempotency-Key. A turn reply waits for
-- the turn that served its input, then freezes the turn's final text; fixed
-- replies are frozen when recorded; a notice keeps its template parameters and
-- seals the booking link, rendered at each send and never stored as text. dispatching commits before
-- the send; a reply found dispatching is sent again with the same key while its
-- first dispatch is under 23 hours old, otherwise it becomes uncertain. Every
-- final state clears the text and the sealed secret. (kind, dedupe_key) makes a
-- retried recording one reply. binding_id is null for a start refusal, which
-- replies to an unbound thread.
CREATE TABLE "app"."email_replies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" text NOT NULL CHECK (
    "kind" IN ('turn', 'link_confirmation', 'start_refusal', 'closed', 'too_long', 'unprocessed', 'notice')
  ),
  "dedupe_key" text NOT NULL CHECK (char_length("dedupe_key") BETWEEN 1 AND 300),
  "request_id" uuid REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "binding_id" uuid REFERENCES "app"."email_threads" ("id") ON DELETE CASCADE,
  "inbox_id" text NOT NULL CHECK (char_length("inbox_id") BETWEEN 1 AND 320),
  "reply_to_message_id" text NOT NULL CHECK (char_length("reply_to_message_id") BETWEEN 1 AND 1000),
  "input_id" uuid REFERENCES "app"."conversation_inputs" ("id") ON DELETE SET NULL,
  "template" text,
  "language" text NOT NULL DEFAULT 'en' CHECK ("language" IN ('en', 'ko')),
  "parameters" jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof("parameters") = 'object'),
  "text" text,
  "secret_ciphertext" text,
  "secret_key_id" text,
  "state" text NOT NULL DEFAULT 'queued' CHECK (
    "state" IN ('waiting', 'queued', 'dispatching', 'accepted', 'rejected', 'uncertain', 'suppressed')
  ),
  "evidence" jsonb,
  "provider_message_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "first_dispatched_at" timestamptz,
  "completed_at" timestamptz,
  CONSTRAINT "email_replies_kind_dedupe_key_key" UNIQUE ("kind", "dedupe_key"),
  CONSTRAINT "email_replies_sealed_secret" CHECK (("secret_ciphertext" IS NULL) = ("secret_key_id" IS NULL)),
  CONSTRAINT "email_replies_final" CHECK (
    ("state" IN ('accepted', 'rejected', 'uncertain', 'suppressed')) = ("completed_at" IS NOT NULL)
  ),
  CONSTRAINT "email_replies_final_cleared" CHECK ("completed_at" IS NULL OR ("text" IS NULL AND "secret_ciphertext" IS NULL)),
  CONSTRAINT "email_replies_turn_input" CHECK ("kind" <> 'turn' OR "input_id" IS NOT NULL OR "completed_at" IS NOT NULL)
);

CREATE INDEX "email_replies_input_idx" ON "app"."email_replies" ("input_id") WHERE "state" = 'waiting';

CREATE INDEX "email_replies_created_idx" ON "app"."email_replies" ("created_at");

ALTER TABLE "app"."email_replies" ENABLE ROW LEVEL SECURITY;
