-- A guest's linked iMessage sender for one request (guest-flow-completion design
-- 1 and 2). The sender is kept as a keyed hash for routing and sealed with the
-- conversation ID (context requester_imessage_binding:{id}) for replies and
-- notices. A request has at most one active binding; a sender may hold active
-- bindings on several requests, and may also have a host binding in
-- imessage_bindings. The binding ends as unlinked (Unlink iMessage), ended (the
-- request was booked or withdrawn, or 30 days passed) or moved (to the revised
-- request named by moved_to_request_id, which gets its own active binding).
CREATE TABLE "app"."requester_imessage_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "link_id" uuid REFERENCES "app"."imessage_links" ("id") ON DELETE SET NULL,
  "sender_hash" text NOT NULL CHECK ("sender_hash" ~ '^[0-9a-f]{64}$'),
  "sender_ciphertext" text,
  "space_ciphertext" text,
  "sealed_key_id" text,
  "state" text NOT NULL DEFAULT 'active' CHECK ("state" IN ('active', 'unlinked', 'ended', 'moved')),
  "moved_to_request_id" uuid REFERENCES "app"."requests" ("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "last_inbound_at" timestamptz,
  "last_notified_at" timestamptz,
  "ended_at" timestamptz,
  CONSTRAINT "requester_imessage_bindings_ended" CHECK (("state" = 'active') = ("ended_at" IS NULL)),
  CONSTRAINT "requester_imessage_bindings_ended_cleared" CHECK (
    "ended_at" IS NULL OR ("sender_ciphertext" IS NULL AND "space_ciphertext" IS NULL)
  ),
  CONSTRAINT "requester_imessage_bindings_sealed" CHECK (
    "state" <> 'active' OR ("sender_ciphertext" IS NOT NULL AND "sealed_key_id" IS NOT NULL)
  ),
  CONSTRAINT "requester_imessage_bindings_moved" CHECK (("state" = 'moved') = ("moved_to_request_id" IS NOT NULL))
);

CREATE UNIQUE INDEX "requester_imessage_bindings_active_request_key" ON "app"."requester_imessage_bindings" ("request_id")
  WHERE "state" = 'active';

CREATE INDEX "requester_imessage_bindings_active_sender_idx" ON "app"."requester_imessage_bindings" ("sender_hash", "created_at" DESC)
  WHERE "state" = 'active';

ALTER TABLE "app"."requester_imessage_bindings" ENABLE ROW LEVEL SECURITY;
