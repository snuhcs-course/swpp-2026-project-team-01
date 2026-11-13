CREATE TABLE "app"."calendar_note_decisions" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "host_account_id"   uuid                     NOT NULL,
  "calendar_id"       text                     NOT NULL,
  "event_id"          text                     NOT NULL,
  "scope"             text                     NOT NULL,
  "fingerprint"       text                     NOT NULL,
  "decision"          text                     NOT NULL,
  "writeback_state"   text,
  "writeback_failure" text,
  "event_end"         text,
  "revision"          integer                  NOT NULL DEFAULT 1,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "calendar_note_decisions_calendar_id_check" CHECK (((char_length(calendar_id) >= 1) AND (char_length(calendar_id) <= 1024))),
  CONSTRAINT "calendar_note_decisions_decision_check" CHECK ((decision = ANY (ARRAY['free'::text, 'keep_busy'::text]))),
  CONSTRAINT "calendar_note_decisions_event_end_check" CHECK ((char_length(event_end) <= 40)),
  CONSTRAINT "calendar_note_decisions_event_id_check" CHECK (((char_length(event_id) >= 1) AND (char_length(event_id) <= 1024))),
  CONSTRAINT "calendar_note_decisions_failure" CHECK (((writeback_state = 'failed'::text) = (writeback_failure IS NOT NULL))),
  CONSTRAINT "calendar_note_decisions_fingerprint_check" CHECK ((char_length(fingerprint) <= 100)),
  CONSTRAINT "calendar_note_decisions_item" UNIQUE (host_account_id, calendar_id, event_id),
  CONSTRAINT "calendar_note_decisions_not_writable_free" CHECK (((writeback_state IS DISTINCT FROM 'not_writable'::text) OR (decision = 'free'::text))),
  CONSTRAINT "calendar_note_decisions_pkey" PRIMARY KEY (id),
  CONSTRAINT "calendar_note_decisions_revision_check" CHECK ((revision >= 1)),
  CONSTRAINT "calendar_note_decisions_scope_check" CHECK ((scope = ANY (ARRAY['series'::text, 'occurrence'::text]))),
  CONSTRAINT "calendar_note_decisions_writeback_state_check" CHECK ((writeback_state = ANY (ARRAY['pending'::text, 'done'::text, 'failed'::text, 'not_writable'::text])))
);

ALTER TABLE "app"."calendar_note_decisions"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "app"."calendar_note_decisions"
  ADD CONSTRAINT "calendar_note_decisions_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;
