-- A group meeting (group-scheduling design 1 and 2): one host, the terms the
-- host gave in their linked conversation (purpose, length, a date range of
-- local dates with range_end inclusive, the host's timezone and language) and
-- the number of participants. Whether the meeting is online or in person, and
-- where, is decided at the host's choice. The shared link is a sealed token
-- like the booking link: lookup uses link_hash, the SHA-256 of the token; the
-- token is sealed with AES-256-GCM under link_key_id (context
-- group_meeting_link:{id}) so it can be sent to the host again.
-- States:
--   collecting  the link admits participants
--   closed      full or closed by the host; the options are in
--               group_meeting_options and the host chooses one
--   booking     the host chose an option; its event is being written
--   booked      the event exists (event_id in calendar_id)
--   cancelled   the host deleted their account or ended the group
-- notice_shown is how many options the host has been shown so far.
-- event_id is derived from the group ID (its 32 hex digits), so a repeated
-- choice cannot create a second event.
CREATE TABLE "app"."group_meetings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "state" text NOT NULL DEFAULT 'collecting' CHECK ("state" IN ('collecting', 'closed', 'booking', 'booked', 'cancelled')),
  "purpose" text NOT NULL CHECK (char_length("purpose") BETWEEN 1 AND 200),
  "duration_minutes" integer NOT NULL CHECK ("duration_minutes" BETWEEN 5 AND 480),
  "range_start" date NOT NULL,
  "range_end" date NOT NULL,
  "timezone" text NOT NULL CHECK (char_length("timezone") BETWEEN 1 AND 64),
  "language" text NOT NULL CHECK ("language" IN ('en', 'ko')),
  "participant_limit" integer NOT NULL CHECK ("participant_limit" BETWEEN 1 AND 20),
  "link_hash" text NOT NULL UNIQUE,
  "link_ciphertext" text NOT NULL,
  "link_key_id" text NOT NULL,
  "notice_shown" integer NOT NULL DEFAULT 0 CHECK ("notice_shown" >= 0),
  "chosen_position" integer,
  "calendar_id" text,
  "event_id" text CHECK ("event_id" ~ '^[0-9a-v]{5,}$'),
  "event_evidence" jsonb CHECK (jsonb_typeof("event_evidence") = 'object'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "closed_at" timestamptz,
  "booked_at" timestamptz,
  CONSTRAINT "group_meetings_range" CHECK ("range_start" <= "range_end" AND "range_end" - "range_start" <= 30),
  CONSTRAINT "group_meetings_closed" CHECK (("state" = 'collecting') = ("closed_at" IS NULL)),
  CONSTRAINT "group_meetings_chosen" CHECK (("state" IN ('booking', 'booked')) = ("chosen_position" IS NOT NULL)),
  CONSTRAINT "group_meetings_booked" CHECK (("state" = 'booked') = ("booked_at" IS NOT NULL AND "event_id" IS NOT NULL))
);

CREATE INDEX "group_meetings_host_idx" ON "app"."group_meetings" ("host_account_id", "created_at" DESC);

ALTER TABLE "app"."group_meetings" ENABLE ROW LEVEL SECURITY;
