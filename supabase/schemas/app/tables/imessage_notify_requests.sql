-- A host's request to hear when texting works again, after the phone was put off.
-- One open request per host and channel; notified_at is set once it is sent.
CREATE TABLE "app"."imessage_notify_requests" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "link_id" uuid REFERENCES "app"."imessage_links" ("id") ON DELETE SET NULL,
  "channel" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "notified_at" timestamptz,
  CONSTRAINT "imessage_notify_requests_channel_check" CHECK ((channel = ANY (ARRAY['sms'::text, 'email'::text])))
);

CREATE UNIQUE INDEX "imessage_notify_requests_open_idx" ON "app"."imessage_notify_requests" ("host_account_id", "channel")
  WHERE "notified_at" IS NULL;

ALTER TABLE "app"."imessage_notify_requests" ENABLE ROW LEVEL SECURITY;
