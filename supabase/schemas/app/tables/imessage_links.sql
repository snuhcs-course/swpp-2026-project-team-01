-- Attempts to link a host's iMessage (host-imessage-channel design 4 and 6). A
-- code attempt holds the FMAT- code as its SHA-256 and sealed (context
-- imessage_link_code:{id}) so the card can show it again after a reload while it
-- is pending; when the host's message carrying it arrives, the attempt becomes
-- received with the sealed sender and conversation (context
-- imessage_link_sender:{id}) and waits for Confirm and link until confirm_by. A
-- fallback attempt holds the entered number sealed and as a keyed hash, and the
-- six-digit code only as a keyed hash; it is never shown. A confirmed attempt is
-- linked and names its binding. Ended attempts hold no sealed value.
-- A code attempt started from the iMessage start on the public page, before
-- sign-in, has no host yet: it belongs to the browser whose HttpOnly cookie
-- hashes to starter_hash, counts against its source_hash, and the Google sign-in
-- callback of that browser gives it to the signed-in host (D15).
CREATE TABLE "app"."imessage_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "host_account_id" uuid REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "method" text NOT NULL CHECK ("method" IN ('code', 'fallback')),
  "starter_hash" text CHECK ("starter_hash" ~ '^[0-9a-f]{64}$'),
  "source_hash" text CHECK ("source_hash" ~ '^[0-9a-f]{64}$'),
  "state" text NOT NULL DEFAULT 'pending' CHECK (
    "state" IN ('pending', 'received', 'linked', 'voided', 'expired', 'cancelled')
  ),
  "code_hash" text UNIQUE CHECK ("code_hash" ~ '^[0-9a-f]{64}$'),
  "code_ciphertext" text,
  "phone_hash" text CHECK ("phone_hash" ~ '^[0-9a-f]{64}$'),
  "phone_ciphertext" text,
  "sealed_key_id" text,
  "fallback_code_hash" text CHECK ("fallback_code_hash" ~ '^[0-9a-f]{64}$'),
  "fallback_expires_at" timestamptz,
  "sends" integer NOT NULL DEFAULT 0 CHECK ("sends" >= 0),
  "last_sent_at" timestamptz,
  "wrong_entries" integer NOT NULL DEFAULT 0 CHECK ("wrong_entries" >= 0),
  "sender_hash" text CHECK ("sender_hash" ~ '^[0-9a-f]{64}$'),
  "sender_ciphertext" text,
  "space_ciphertext" text,
  "sender_key_id" text,
  "received_by_receipt_id" uuid,
  "binding_id" uuid,
  "expires_at" timestamptz NOT NULL,
  "confirm_by" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "ended_at" timestamptz,
  CONSTRAINT "imessage_links_method_values" CHECK (
    ("method" = 'code' AND "code_hash" IS NOT NULL AND "phone_hash" IS NULL)
    OR ("method" = 'fallback' AND "code_hash" IS NULL AND "phone_hash" IS NOT NULL)
  ),
  CONSTRAINT "imessage_links_ended" CHECK (("state" IN ('pending', 'received')) = ("ended_at" IS NULL)),
  CONSTRAINT "imessage_links_ended_cleared" CHECK (
    "ended_at" IS NULL
    OR ("code_ciphertext" IS NULL AND "phone_ciphertext" IS NULL AND "sender_ciphertext" IS NULL
        AND "space_ciphertext" IS NULL AND "fallback_code_hash" IS NULL)
  ),
  CONSTRAINT "imessage_links_owner" CHECK (
    "host_account_id" IS NOT NULL OR ("method" = 'code' AND "starter_hash" IS NOT NULL AND "source_hash" IS NOT NULL)
  ),
  CONSTRAINT "imessage_links_received" CHECK ("state" <> 'received' OR ("sender_hash" IS NOT NULL AND "confirm_by" IS NOT NULL))
);

CREATE UNIQUE INDEX "imessage_links_open_host_key" ON "app"."imessage_links" ("host_account_id") WHERE "state" IN ('pending', 'received');

CREATE UNIQUE INDEX "imessage_links_open_starter_key" ON "app"."imessage_links" ("starter_hash")
  WHERE "host_account_id" IS NULL AND "state" IN ('pending', 'received');

CREATE INDEX "imessage_links_source_created_idx" ON "app"."imessage_links" ("source_hash", "created_at")
  WHERE "source_hash" IS NOT NULL;

CREATE INDEX "imessage_links_host_created_idx" ON "app"."imessage_links" ("host_account_id", "created_at");

CREATE INDEX "imessage_links_fallback_sent_idx" ON "app"."imessage_links" ("last_sent_at") WHERE "method" = 'fallback';

ALTER TABLE "app"."imessage_links" ENABLE ROW LEVEL SECURITY;
