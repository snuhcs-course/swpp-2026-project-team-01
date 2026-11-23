-- Daily counts of how hosts and guests use the messaging channels (channel-usage-
-- report design 1 and 2), one row per UTC day and channel. Only counts are kept,
-- never a host, request, sender or message, so the trend outlives the 30-day
-- deletion of the receipts and bindings it is counted from. app.record_channel_usage
-- recomputes the last seven days every hour; a day is final once it is older than
-- that. A missing row means the day was not recorded, not that nothing happened.
CREATE TABLE "app"."channel_usage_days" (
  "day" date NOT NULL,
  "channel" text NOT NULL CHECK ("channel" IN ('imessage', 'whatsapp', 'telegram')),
  "active_hosts" integer NOT NULL CHECK ("active_hosts" >= 0),
  "inbound_messages" integer NOT NULL CHECK ("inbound_messages" >= 0),
  "guest_links" integer NOT NULL CHECK ("guest_links" >= 0),
  "guest_bookings" integer NOT NULL CHECK ("guest_bookings" >= 0),
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("day", "channel")
);

ALTER TABLE "app"."channel_usage_days" ENABLE ROW LEVEL SECURITY;
