-- The host's answers about note candidates (calendar-note-review design 3): one
-- row per host and decided item, free or keep busy, so an answered entry is not
-- judged or asked about again while it is unchanged. It holds no title. It is a
-- host decision, not analysis evidence, so app.cleanup_calendar_analyses keeps it.
--
-- event_id names the decided event: the series (Google's recurringEventId) for
-- scope 'series', or one occurrence for 'occurrence'. fingerprint is the event's
-- updated time when the host answered, or the one Google returned for our own
-- writeback; an occurrence matches a series answer while its updated time is not
-- later than it (lib/server/note-decisions.ts).
--
-- writeback_state follows the transparency change in Google Calendar: 'pending'
-- while the writeback job runs, 'done' once Google answered, 'failed' when Google
-- refused or the retries ran out, and 'not_writable' for a free decision on a
-- calendar the host cannot change, recorded only as a note exclusion. A keep-busy
-- answer that undoes a freed entry patches it back to opaque through the same job;
-- otherwise it has no writeback. revision increases with every change, so a job
-- published for an older decision changes nothing.
CREATE TABLE "app"."calendar_note_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "calendar_id" text NOT NULL CHECK (char_length("calendar_id") BETWEEN 1 AND 1024),
  "event_id" text NOT NULL CHECK (char_length("event_id") BETWEEN 1 AND 1024),
  "scope" text NOT NULL CHECK ("scope" IN ('series', 'occurrence')),
  "fingerprint" text NOT NULL CHECK (char_length("fingerprint") <= 100),
  "decision" text NOT NULL CHECK ("decision" IN ('free', 'keep_busy')),
  "writeback_state" text CHECK ("writeback_state" IN ('pending', 'done', 'failed', 'not_writable')),
  "writeback_failure" text,
  -- The event's end (an ISO time or an all-day date), so the note exclusion limit
  -- drops ended entries first.
  "event_end" text CHECK (char_length("event_end") <= 40),
  "revision" integer NOT NULL DEFAULT 1 CHECK ("revision" >= 1),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "calendar_note_decisions_item" UNIQUE ("host_account_id", "calendar_id", "event_id"),
  CONSTRAINT "calendar_note_decisions_not_writable_free" CHECK ("writeback_state" IS DISTINCT FROM 'not_writable' OR "decision" = 'free'),
  CONSTRAINT "calendar_note_decisions_failure" CHECK (("writeback_state" = 'failed') = ("writeback_failure" IS NOT NULL))
);

ALTER TABLE "app"."calendar_note_decisions" ENABLE ROW LEVEL SECURITY;
