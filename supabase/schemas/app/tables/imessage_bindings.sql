-- A host's linked iMessage sender (host-imessage-channel design 4). The sender is
-- kept as a keyed hash for lookup and sealed with the conversation ID (context
-- imessage_binding:{id}) for replies; the conversation is null for a fallback
-- binding until the host writes from it. A host has at most one active binding
-- and a sender belongs to at most one host. selected_request_id is the request
-- whose private discussion receives free text; null means setup. Unlinking ends
-- the binding at once. channel is the platform the sender writes from
-- (host-whatsapp-channel design 4 and 5): a host has one active binding across
-- iMessage and WhatsApp, and WhatsApp senders are hashed in their own namespace,
-- so the two partial unique indexes below hold for both channels.
-- A Telegram binding also seals the sender's first name and @username
-- (sender_name_ciphertext, host-telegram-channel design 3), which the card shows
-- instead of a user ID; the trigger imessage_bindings_clear_sender_name clears it
-- with the sender.
CREATE TABLE "app"."imessage_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "channel" text NOT NULL DEFAULT 'imessage' CHECK ("channel" IN ('imessage', 'whatsapp', 'telegram')),
  "link_id" uuid REFERENCES "app"."imessage_links" ("id") ON DELETE SET NULL,
  "sender_hash" text NOT NULL CHECK ("sender_hash" ~ '^[0-9a-f]{64}$'),
  "sender_ciphertext" text,
  "sender_name_ciphertext" text,
  "space_ciphertext" text,
  "sealed_key_id" text,
  "selected_request_id" uuid REFERENCES "app"."requests" ("id") ON DELETE SET NULL,
  "state" text NOT NULL DEFAULT 'active' CHECK ("state" IN ('active', 'unlinked')),
  "linked_at" timestamptz NOT NULL DEFAULT now(),
  "last_inbound_at" timestamptz,
  "ended_at" timestamptz,
  CONSTRAINT "imessage_bindings_ended" CHECK (("state" = 'active') = ("ended_at" IS NULL)),
  CONSTRAINT "imessage_bindings_ended_cleared" CHECK (
    "ended_at" IS NULL OR ("sender_ciphertext" IS NULL AND "space_ciphertext" IS NULL)
  ),
  CONSTRAINT "imessage_bindings_sender_name" CHECK ("sender_name_ciphertext" IS NULL OR "sender_ciphertext" IS NOT NULL),
  CONSTRAINT "imessage_bindings_sealed" CHECK ("state" <> 'active' OR ("sender_ciphertext" IS NOT NULL AND "sealed_key_id" IS NOT NULL))
);

CREATE UNIQUE INDEX "imessage_bindings_active_host_key" ON "app"."imessage_bindings" ("host_account_id") WHERE "state" = 'active';

CREATE UNIQUE INDEX "imessage_bindings_active_sender_key" ON "app"."imessage_bindings" ("sender_hash") WHERE "state" = 'active';

ALTER TABLE "app"."imessage_bindings" ENABLE ROW LEVEL SECURITY;
