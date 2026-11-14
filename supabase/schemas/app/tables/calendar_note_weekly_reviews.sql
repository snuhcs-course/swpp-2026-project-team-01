-- The weekly note check's current review per host (calendar-note-review design
-- 9 to 11): the unanswered note candidates of the week's scan, numbered in the
-- order the linked conversation lists them. It holds no title: titles are read
-- again (from the scan while it is kept, else from Google) when they are shown.
-- One row per host; the next week's check replaces it, so an older list's
-- reference stops being current. A replayed check for the same week finds the
-- row and records nothing.
--
-- items is an array of { calendarId, eventId, seriesId, fingerprint, start, end,
-- allDay, verdict }: eventId names the occurrence shown, seriesId its series when
-- it repeats, and fingerprint the updated time an answer records (the latest of
-- the series' occurrences for a series). pending_choice is a choice to free by
-- number awaiting the host's yes to its read-back: { ref, numbers, inputId },
-- inputId naming the message the read-back answered, so the yes must come in a
-- later one.
CREATE TABLE "app"."calendar_note_weekly_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  -- The Monday of the check, in the schedule's time zone.
  "week" date NOT NULL,
  -- The scan the review came from; cleaned up with the scan's 24-hour evidence.
  "analysis_id" uuid,
  "timezone" text NOT NULL CHECK (char_length("timezone") BETWEEN 1 AND 100),
  "items" jsonb NOT NULL CHECK (jsonb_typeof("items") = 'array' AND jsonb_array_length("items") BETWEEN 1 AND 100),
  "pending_choice" jsonb CHECK ("pending_choice" IS NULL OR jsonb_typeof("pending_choice") = 'object'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "calendar_note_weekly_reviews_host" UNIQUE ("host_account_id")
);

ALTER TABLE "app"."calendar_note_weekly_reviews" ENABLE ROW LEVEL SECURITY;
