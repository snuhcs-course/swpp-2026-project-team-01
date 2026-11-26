-- The unavailable times a group participant confirmed (group-scheduling design
-- 4, D11, D17): a written exception to the rule that requester event contents
-- are never stored. Each row is one interval from the participant's calendar
-- busy times or their stated commitments, with whether it lasts all day and,
-- for a calendar event, its place (neighborhood level or finer). No title,
-- attendee or description is stored. The close and the booking use these rows
-- as they are and never read the participant's calendar again.
CREATE TABLE "app"."group_unavailable_times" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL REFERENCES "app"."group_participants" ("request_id") ON DELETE CASCADE,
  "source" text NOT NULL CHECK ("source" IN ('calendar', 'stated')),
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz NOT NULL,
  "all_day" boolean NOT NULL DEFAULT false,
  "place" text CHECK (char_length("place") BETWEEN 1 AND 500),
  CONSTRAINT "group_unavailable_times_interval" CHECK ("starts_at" < "ends_at"),
  CONSTRAINT "group_unavailable_times_place" CHECK ("source" = 'calendar' OR "place" IS NULL)
);

CREATE INDEX "group_unavailable_times_request_idx" ON "app"."group_unavailable_times" ("request_id", "starts_at");

ALTER TABLE "app"."group_unavailable_times" ENABLE ROW LEVEL SECURITY;
