-- A participant of a group meeting (group-scheduling design 3 and 4): the
-- answers of one participant request (requests.group_meeting_id). The one
-- question fills preferred_hours (soft preferences, local "HH:MM" pairs that
-- order options without excluding any), usual_place (a neighborhood or finer),
-- travel_mode and commitments (the stated unavailable intervals, as
-- {start, end, allDay}). done_at is when the participant confirmed the review:
-- their unavailable times are then frozen in group_unavailable_times and the
-- answers change no more (D13).
CREATE TABLE "app"."group_participants" (
  "request_id" uuid PRIMARY KEY REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "preferred_hours" jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof("preferred_hours") = 'array'),
  "usual_place" text CHECK (char_length("usual_place") BETWEEN 1 AND 200),
  "travel_mode" text CHECK ("travel_mode" IN ('driving', 'transit', 'walking')),
  "commitments" jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof("commitments") = 'array'),
  "answered_at" timestamptz,
  "done_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "group_participants_done" CHECK ("done_at" IS NULL OR "answered_at" IS NOT NULL)
);

ALTER TABLE "app"."group_participants" ENABLE ROW LEVEL SECURITY;
