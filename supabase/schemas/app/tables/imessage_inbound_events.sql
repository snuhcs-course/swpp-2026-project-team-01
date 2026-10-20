-- Verified Photon webhook deliveries, stored before the webhook is acknowledged
-- and applied once by a job. (webhook_id, message_id) is the provider's dedupe
-- key. The text is cleared when the event is processed, so a linking number never
-- stays in storage.
CREATE TABLE "app"."imessage_inbound_events" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "webhook_id" text NOT NULL,
  "message_id" text NOT NULL,
  "sender" text NOT NULL,
  "space_id" text NOT NULL,
  "space_type" text NOT NULL,
  "line" text,
  "content_type" text NOT NULL,
  "body" text,
  "sent_at" timestamptz,
  "state" text NOT NULL DEFAULT 'received',
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "processed_at" timestamptz,
  CONSTRAINT "imessage_inbound_events_dedupe_key" UNIQUE ("webhook_id", "message_id"),
  CONSTRAINT "imessage_inbound_events_state_check" CHECK ((state = ANY (ARRAY['received'::text, 'applied'::text, 'ignored'::text])))
);

CREATE INDEX "imessage_inbound_events_received_idx" ON "app"."imessage_inbound_events" ("received_at");

ALTER TABLE "app"."imessage_inbound_events" ENABLE ROW LEVEL SECURITY;
