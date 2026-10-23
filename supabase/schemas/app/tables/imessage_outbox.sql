-- Every message the iMessage line sends (host-imessage-channel design 3, D9). The
-- recipient (address and conversation) and the text are sealed and frozen
-- (context imessage_outbox:{id}) before dispatch; a turn reply waits for the
-- turn that served its input, then freezes the turn's final text. dispatching
-- commits before the send; a send whose answer is lost is uncertain and never
-- sent again. Final states clear the sealed values. A host-private message
-- (binding_id set) is suppressed when its binding is no longer active.
-- recipient_hash is the keyed hash of the recipient, for the unlinked-sender
-- reply's daily limit. (kind, dedupe_key) makes a retried recording one message.
CREATE TABLE "app"."imessage_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" text NOT NULL CHECK (
    "kind" IN (
      'link_received', 'link_refused', 'linked', 'fallback_code', 'unlinked_sender', 'text_only',
      'command', 'turn', 'notice', 'contact_card'
    )
  ),
  "dedupe_key" text NOT NULL CHECK (char_length("dedupe_key") BETWEEN 1 AND 300),
  "host_account_id" uuid REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "binding_id" uuid REFERENCES "app"."imessage_bindings" ("id") ON DELETE CASCADE,
  "link_id" uuid REFERENCES "app"."imessage_links" ("id") ON DELETE SET NULL,
  "request_id" uuid REFERENCES "app"."requests" ("id") ON DELETE SET NULL,
  "input_id" uuid REFERENCES "app"."conversation_inputs" ("id") ON DELETE SET NULL,
  "recipient_hash" text NOT NULL CHECK ("recipient_hash" ~ '^[0-9a-f]{64}$'),
  "recipient_ciphertext" text,
  "text_ciphertext" text,
  "sealed_key_id" text,
  "state" text NOT NULL DEFAULT 'queued' CHECK (
    "state" IN ('waiting', 'queued', 'dispatching', 'accepted', 'failed', 'uncertain', 'suppressed')
  ),
  "failure_category" text CHECK (char_length("failure_category") BETWEEN 1 AND 60),
  "provider_message_id" text CHECK (char_length("provider_message_id") BETWEEN 1 AND 500),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "dispatched_at" timestamptz,
  "completed_at" timestamptz,
  CONSTRAINT "imessage_outbox_kind_dedupe_key_key" UNIQUE ("kind", "dedupe_key"),
  CONSTRAINT "imessage_outbox_final" CHECK (
    ("state" IN ('accepted', 'failed', 'uncertain', 'suppressed')) = ("completed_at" IS NOT NULL)
  ),
  CONSTRAINT "imessage_outbox_final_cleared" CHECK (
    "completed_at" IS NULL OR ("recipient_ciphertext" IS NULL AND "text_ciphertext" IS NULL)
  ),
  CONSTRAINT "imessage_outbox_turn_input" CHECK ("kind" <> 'turn' OR "input_id" IS NOT NULL OR "completed_at" IS NOT NULL)
);

CREATE INDEX "imessage_outbox_input_idx" ON "app"."imessage_outbox" ("input_id") WHERE "state" = 'waiting';

CREATE INDEX "imessage_outbox_host_idx" ON "app"."imessage_outbox" ("host_account_id", "created_at");

CREATE INDEX "imessage_outbox_recipient_idx" ON "app"."imessage_outbox" ("recipient_hash", "created_at") WHERE "kind" = 'unlinked_sender';

CREATE INDEX "imessage_outbox_created_idx" ON "app"."imessage_outbox" ("created_at");

ALTER TABLE "app"."imessage_outbox" ENABLE ROW LEVEL SECURITY;
