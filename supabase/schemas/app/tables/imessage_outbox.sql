-- Every message the iMessage line sends (host-imessage-channel design 3, D9). The
-- recipient (address and conversation) and the text are sealed and frozen
-- (context imessage_outbox:{id}) before dispatch; a turn reply waits for the
-- turn that served its input, then freezes the turn's final text. dispatching
-- commits before the send; a send whose answer is lost is uncertain and never
-- sent again. Final states clear the sealed values. A host-private message
-- (binding_id set) is suppressed when its binding is no longer active, and so is
-- a guest's message (requester_binding_id set; guest-flow-completion design 3
-- and 4) when that guest binding is.
-- recipient_hash is the keyed hash of the recipient, for the unlinked-sender
-- reply's daily limit. (kind, dedupe_key) makes a retried recording one message.
-- channel picks the transport (host-whatsapp-channel design 4 and 9); a template
-- row is a WhatsApp notice outside the 24-hour window, sent as template_name with
-- the sealed text as its one parameter (design 8).
-- A signal row (host-imessage-channel design 18) is a best-effort read mark,
-- tapback or typing bubble about the host's message, sealed as JSON in
-- text_ciphertext; it is never retried and never counts as a delivery.
-- Telegram (host-telegram-channel design 7, D8 and D9): buttons names the inline
-- keyboard a row was sent with, the decision a proposal summary asks for
-- ({"kind":"decision","ref":…,"version":…}) or a settings review's confirmation
-- ({"kind":"settings","ref":…}); it stays after the row is final, so the
-- provider message ID of an accepted row can have its keyboard removed once the
-- proposal is decided, withdrawn or superseded. An edit_markup row removes it
-- (its dedupe key names the row it edits, its sealed text the message ID), and a
-- callback_answer row answers a button tap (its sealed text the callback ID and
-- answer). Neither is a message of its own.
CREATE TABLE "app"."imessage_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "channel" text NOT NULL DEFAULT 'imessage' CHECK ("channel" IN ('imessage', 'whatsapp', 'telegram')),
  "kind" text NOT NULL CHECK (
    "kind" IN (
      'link_received', 'link_refused', 'linked', 'fallback_code', 'unlinked_sender', 'text_only',
      'command', 'turn', 'notice', 'contact_card', 'signal', 'template', 'edit_markup', 'callback_answer'
    )
  ),
  "dedupe_key" text NOT NULL CHECK (char_length("dedupe_key") BETWEEN 1 AND 300),
  "host_account_id" uuid REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "binding_id" uuid REFERENCES "app"."imessage_bindings" ("id") ON DELETE CASCADE,
  "requester_binding_id" uuid REFERENCES "app"."requester_imessage_bindings" ("id") ON DELETE CASCADE,
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
  "buttons" jsonb,
  "template_name" text CHECK ("template_name" ~ '^[a-z0-9_]{1,100}$'),
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
  CONSTRAINT "imessage_outbox_template" CHECK (("kind" = 'template') = ("template_name" IS NOT NULL) AND ("kind" <> 'template' OR "channel" = 'whatsapp')),
  CONSTRAINT "imessage_outbox_buttons" CHECK (
    "buttons" IS NULL OR ("channel" = 'telegram' AND jsonb_typeof("buttons") = 'object' AND "buttons" ->> 'kind' IN ('decision', 'settings'))
  ),
  CONSTRAINT "imessage_outbox_telegram_kinds" CHECK ("kind" NOT IN ('edit_markup', 'callback_answer') OR "channel" = 'telegram'),
  CONSTRAINT "imessage_outbox_one_binding" CHECK ("binding_id" IS NULL OR "requester_binding_id" IS NULL),
  CONSTRAINT "imessage_outbox_turn_input" CHECK ("kind" <> 'turn' OR "input_id" IS NOT NULL OR "completed_at" IS NOT NULL)
);

CREATE INDEX "imessage_outbox_input_idx" ON "app"."imessage_outbox" ("input_id") WHERE "state" = 'waiting';

CREATE INDEX "imessage_outbox_host_idx" ON "app"."imessage_outbox" ("host_account_id", "created_at");

CREATE INDEX "imessage_outbox_recipient_idx" ON "app"."imessage_outbox" ("recipient_hash", "created_at") WHERE "kind" = 'unlinked_sender';

-- Inbound routing reads the last message the line sent to a sender.
CREATE INDEX "imessage_outbox_recipient_last_idx" ON "app"."imessage_outbox" ("recipient_hash", "created_at" DESC);

-- Button retirement reads the buttoned rows of a request.
CREATE INDEX "imessage_outbox_buttons_idx" ON "app"."imessage_outbox" ("request_id") WHERE "buttons" IS NOT NULL;

CREATE INDEX "imessage_outbox_created_idx" ON "app"."imessage_outbox" ("created_at");

ALTER TABLE "app"."imessage_outbox" ENABLE ROW LEVEL SECURITY;
