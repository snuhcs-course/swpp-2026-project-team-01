-- The options a closed group meeting found (group-scheduling design 5), in the
-- order the host is shown them (position 1 first). An option is a time with a
-- place (in_person) or without one (online). missing_request_ids names the done
-- participants who cannot make it; it is empty when the option fits everyone.
CREATE TABLE "app"."group_meeting_options" (
  "group_meeting_id" uuid NOT NULL REFERENCES "app"."group_meetings" ("id") ON DELETE CASCADE,
  "position" integer NOT NULL CHECK ("position" >= 1),
  "mode" text NOT NULL CHECK ("mode" IN ('in_person', 'online')),
  "place" text CHECK (char_length("place") BETWEEN 1 AND 500),
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz NOT NULL,
  "missing_request_ids" uuid[] NOT NULL DEFAULT '{}',
  PRIMARY KEY ("group_meeting_id", "position"),
  CONSTRAINT "group_meeting_options_interval" CHECK ("starts_at" < "ends_at"),
  CONSTRAINT "group_meeting_options_place" CHECK (("mode" = 'in_person') = ("place" IS NOT NULL))
);

ALTER TABLE "app"."group_meeting_options" ENABLE ROW LEVEL SECURITY;
