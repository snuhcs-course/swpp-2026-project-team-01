-- Operator-owned AgentMail webhook receivers (requester-email-channel design 1,
-- D10). The webhook URL carries the receiver's id; a delivery is accepted only
-- while its receiver is enabled, names the configured inbox and records the
-- SHA-256 fingerprint of the configured signing secret, so a replaced secret or
-- a newer registration fences an older webhook out. One enabled receiver per
-- inbox; registering another disables the earlier one in the same transaction.
-- The rows are the audit record: who registered and disabled each receiver, where.
CREATE TABLE "app"."email_receivers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "inbox_id" text NOT NULL CHECK (char_length("inbox_id") BETWEEN 1 AND 320),
  "webhook_id" text NOT NULL CHECK (char_length("webhook_id") BETWEEN 1 AND 200),
  "secret_fingerprint" text NOT NULL CHECK ("secret_fingerprint" ~ '^[0-9a-f]{64}$'),
  "state" text NOT NULL DEFAULT 'enabled' CHECK ("state" IN ('enabled', 'disabled')),
  "operator" text NOT NULL CHECK (char_length("operator") BETWEEN 1 AND 100),
  "environment" text NOT NULL CHECK (char_length("environment") BETWEEN 1 AND 100),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "disabled_at" timestamptz,
  "disabled_by" text CHECK (char_length("disabled_by") BETWEEN 1 AND 100),
  CONSTRAINT "email_receivers_disabled_at" CHECK (("state" = 'disabled') = ("disabled_at" IS NOT NULL))
);

CREATE UNIQUE INDEX "email_receivers_enabled_inbox_key" ON "app"."email_receivers" ("inbox_id") WHERE "state" = 'enabled';

ALTER TABLE "app"."email_receivers" ENABLE ROW LEVEL SECURITY;
