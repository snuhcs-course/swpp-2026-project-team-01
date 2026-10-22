-- One-time link codes from the booking page's Continue by email card
-- (requester-email-channel design 4, D7). The code is stored as its SHA-256 and
-- sealed under the token key (context email_link:{id}) so the card can show it
-- again after a reload while it is pending. A new code voids the pending one;
-- a code binds only as written (design 5) and any other arrival voids it.
CREATE TABLE "app"."email_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "code_hash" text NOT NULL UNIQUE CHECK ("code_hash" ~ '^[0-9a-f]{64}$'),
  "code_ciphertext" text,
  "code_key_id" text,
  "state" text NOT NULL DEFAULT 'pending' CHECK ("state" IN ('pending', 'consumed', 'voided')),
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "ended_at" timestamptz,
  "thread_binding_id" uuid REFERENCES "app"."email_threads" ("id") ON DELETE SET NULL,
  CONSTRAINT "email_links_sealed_code" CHECK (("code_ciphertext" IS NULL) = ("code_key_id" IS NULL)),
  CONSTRAINT "email_links_ended" CHECK (("state" = 'pending') = ("ended_at" IS NULL)),
  CONSTRAINT "email_links_pending_code" CHECK ("state" = 'pending' OR "code_ciphertext" IS NULL)
);

CREATE UNIQUE INDEX "email_links_pending_request_key" ON "app"."email_links" ("request_id") WHERE "state" = 'pending';

CREATE INDEX "email_links_request_created_idx" ON "app"."email_links" ("request_id", "created_at");

ALTER TABLE "app"."email_links" ENABLE ROW LEVEL SECURITY;
