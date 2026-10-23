-- Verified Photon webhook deliveries (host-imessage-channel design 2), stored
-- with their imessage_receipt job before the receiver acknowledges. message_id is
-- Photon's identity of the message across retries and webhook URLs; a reuse with
-- another payload hash is a conflict. The sender and the conversation are kept as
-- keyed hashes for lookup; the text, the sender and the conversation ID are kept
-- only sealed under the token key (context imessage_receipt:{id}) and only until
-- the job records an outcome. outcome is what the job did with the message.
CREATE TABLE "app"."imessage_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "message_id" text NOT NULL CHECK (char_length("message_id") BETWEEN 1 AND 500),
  "webhook_id" text NOT NULL CHECK (char_length("webhook_id") BETWEEN 1 AND 200),
  "sender_hash" text NOT NULL CHECK ("sender_hash" ~ '^[0-9a-f]{64}$'),
  "space_hash" text NOT NULL CHECK ("space_hash" ~ '^[0-9a-f]{64}$'),
  "space_type" text NOT NULL CHECK ("space_type" IN ('dm', 'group')),
  "content_type" text NOT NULL CHECK (char_length("content_type") BETWEEN 1 AND 50),
  "provider_sent_at" timestamptz,
  "payload_sha256" text NOT NULL CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$'),
  "text_ciphertext" text,
  "sender_ciphertext" text,
  "space_ciphertext" text,
  "sealed_key_id" text,
  "outcome" text CHECK (
    "outcome" IN ('link_received', 'link_refused', 'unlinked_reply', 'command', 'forwarded', 'replied', 'ignored')
  ),
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "processed_at" timestamptz,
  CONSTRAINT "imessage_receipts_message_key" UNIQUE ("message_id"),
  CONSTRAINT "imessage_receipts_processed" CHECK (("outcome" IS NULL) = ("processed_at" IS NULL)),
  CONSTRAINT "imessage_receipts_processed_cleared" CHECK (
    "processed_at" IS NULL OR ("text_ciphertext" IS NULL AND "sender_ciphertext" IS NULL AND "space_ciphertext" IS NULL)
  ),
  CONSTRAINT "imessage_receipts_sealed" CHECK (("sender_ciphertext" IS NULL) = ("sealed_key_id" IS NULL) OR "processed_at" IS NOT NULL)
);

CREATE INDEX "imessage_receipts_space_idx" ON "app"."imessage_receipts" ("space_hash", "received_at") WHERE "outcome" IS NULL;

CREATE INDEX "imessage_receipts_received_idx" ON "app"."imessage_receipts" ("received_at");

ALTER TABLE "app"."imessage_receipts" ENABLE ROW LEVEL SECURITY;
