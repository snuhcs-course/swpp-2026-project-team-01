-- Every text a phone check asked for. A send is queued in the same transaction as
-- the request and goes out no sooner than a minute after the host's previous one;
-- the rolling five-minute window counts these rows per host.
CREATE TABLE "app"."imessage_sends" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "link_id" uuid NOT NULL REFERENCES "app"."imessage_links" ("id") ON DELETE CASCADE,
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "scheduled_at" timestamptz NOT NULL,
  "state" text NOT NULL DEFAULT 'queued',
  "failure" text,
  "provider_message_id" text,
  "sent_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "imessage_sends_state_check" CHECK ((state = ANY (ARRAY['queued'::text, 'sent'::text, 'uncertain'::text, 'failed'::text, 'skipped'::text])))
);

CREATE INDEX "imessage_sends_host_idx" ON "app"."imessage_sends" ("host_account_id", "scheduled_at");

CREATE INDEX "imessage_sends_link_idx" ON "app"."imessage_sends" ("link_id");

ALTER TABLE "app"."imessage_sends" ENABLE ROW LEVEL SECURITY;
