CREATE TABLE "app"."group_meeting_options" (
  "group_meeting_id"    uuid                     NOT NULL,
  "position"            integer                  NOT NULL,
  "mode"                text                     NOT NULL,
  "place"               text,
  "starts_at"           timestamp with time zone NOT NULL,
  "ends_at"             timestamp with time zone NOT NULL,
  "missing_request_ids" uuid[]                   NOT NULL DEFAULT '{}'::uuid[],
  CONSTRAINT "group_meeting_options_interval" CHECK ((starts_at < ends_at)),
  CONSTRAINT "group_meeting_options_mode_check" CHECK ((mode = ANY (ARRAY['in_person'::text, 'online'::text]))),
  CONSTRAINT "group_meeting_options_pkey" PRIMARY KEY (group_meeting_id, "position"),
  CONSTRAINT "group_meeting_options_place_check" CHECK (((char_length(place) >= 1) AND (char_length(place) <= 500))),
  CONSTRAINT "group_meeting_options_place" CHECK (((mode = 'in_person'::text) = (place IS NOT NULL))),
  CONSTRAINT "group_meeting_options_position_check" CHECK (("position" >= 1))
);

ALTER TABLE "app"."group_meeting_options"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."group_meetings" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "host_account_id"   uuid                     NOT NULL,
  "state"             text                     NOT NULL DEFAULT 'collecting'::text,
  "purpose"           text                     NOT NULL,
  "duration_minutes"  integer                  NOT NULL,
  "range_start"       date                     NOT NULL,
  "range_end"         date                     NOT NULL,
  "timezone"          text                     NOT NULL,
  "language"          text                     NOT NULL,
  "participant_limit" integer                  NOT NULL,
  "link_hash"         text                     NOT NULL,
  "link_ciphertext"   text                     NOT NULL,
  "link_key_id"       text                     NOT NULL,
  "notice_shown"      integer                  NOT NULL DEFAULT 0,
  "chosen_position"   integer,
  "calendar_id"       text,
  "event_id"          text,
  "event_evidence"    jsonb,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "closed_at"         timestamp with time zone,
  "booked_at"         timestamp with time zone,
  CONSTRAINT "group_meetings_booked" CHECK (((state = 'booked'::text) = ((booked_at IS NOT NULL) AND (event_id IS NOT NULL)))),
  CONSTRAINT "group_meetings_chosen" CHECK (((state = ANY (ARRAY['booking'::text, 'booked'::text])) = (chosen_position IS NOT NULL))),
  CONSTRAINT "group_meetings_closed" CHECK (((state = 'collecting'::text) = (closed_at IS NULL))),
  CONSTRAINT "group_meetings_duration_minutes_check" CHECK (((duration_minutes >= 5) AND (duration_minutes <= 480))),
  CONSTRAINT "group_meetings_event_evidence_check" CHECK ((jsonb_typeof(event_evidence) = 'object'::text)),
  CONSTRAINT "group_meetings_event_id_check" CHECK ((event_id ~ '^[0-9a-v]{5,}$'::text)),
  CONSTRAINT "group_meetings_language_check" CHECK ((language = ANY (ARRAY['en'::text, 'ko'::text]))),
  CONSTRAINT "group_meetings_link_hash_key" UNIQUE (link_hash),
  CONSTRAINT "group_meetings_notice_shown_check" CHECK ((notice_shown >= 0)),
  CONSTRAINT "group_meetings_participant_limit_check" CHECK (((participant_limit >= 1) AND (participant_limit <= 20))),
  CONSTRAINT "group_meetings_pkey" PRIMARY KEY (id),
  CONSTRAINT "group_meetings_purpose_check" CHECK (((char_length(purpose) >= 1) AND (char_length(purpose) <= 200))),
  CONSTRAINT "group_meetings_range" CHECK (((range_start <= range_end) AND ((range_end - range_start) <= 30))),
  CONSTRAINT "group_meetings_state_check" CHECK ((state = ANY (ARRAY['collecting'::text, 'closed'::text, 'booking'::text, 'booked'::text, 'cancelled'::text]))),
  CONSTRAINT "group_meetings_timezone_check" CHECK (((char_length(timezone) >= 1) AND (char_length(timezone) <= 64)))
);

ALTER TABLE "app"."group_meetings"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."group_participants" (
  "request_id"      uuid                     NOT NULL,
  "preferred_hours" jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "usual_place"     text,
  "travel_mode"     text,
  "commitments"     jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "answered_at"     timestamp with time zone,
  "done_at"         timestamp with time zone,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "group_participants_commitments_check" CHECK ((jsonb_typeof(commitments) = 'array'::text)),
  CONSTRAINT "group_participants_done" CHECK (((done_at IS NULL) OR (answered_at IS NOT NULL))),
  CONSTRAINT "group_participants_pkey" PRIMARY KEY (request_id),
  CONSTRAINT "group_participants_preferred_hours_check" CHECK ((jsonb_typeof(preferred_hours) = 'array'::text)),
  CONSTRAINT "group_participants_travel_mode_check" CHECK ((travel_mode = ANY (ARRAY['driving'::text, 'transit'::text, 'walking'::text]))),
  CONSTRAINT "group_participants_usual_place_check" CHECK (((char_length(usual_place) >= 1) AND (char_length(usual_place) <= 200)))
);

ALTER TABLE "app"."group_participants"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."group_unavailable_times" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "request_id" uuid                     NOT NULL,
  "source"     text                     NOT NULL,
  "starts_at"  timestamp with time zone NOT NULL,
  "ends_at"    timestamp with time zone NOT NULL,
  "all_day"    boolean                  NOT NULL DEFAULT false,
  "place"      text,
  CONSTRAINT "group_unavailable_times_interval" CHECK ((starts_at < ends_at)),
  CONSTRAINT "group_unavailable_times_pkey" PRIMARY KEY (id),
  CONSTRAINT "group_unavailable_times_place_check" CHECK (((char_length(place) >= 1) AND (char_length(place) <= 500))),
  CONSTRAINT "group_unavailable_times_place" CHECK (((source = 'calendar'::text) OR (place IS NULL))),
  CONSTRAINT "group_unavailable_times_source_check" CHECK ((source = ANY (ARRAY['calendar'::text, 'stated'::text])))
);

ALTER TABLE "app"."group_unavailable_times"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "app"."requests"
  ADD COLUMN "group_meeting_id" uuid;

ALTER TABLE "app"."group_meetings"
  ADD CONSTRAINT "group_meetings_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."group_meeting_options"
  ADD CONSTRAINT "group_meeting_options_group_meeting_id_fkey" FOREIGN KEY (group_meeting_id) REFERENCES app.group_meetings(id) ON DELETE CASCADE;

ALTER TABLE "app"."group_participants"
  ADD CONSTRAINT "group_participants_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

ALTER TABLE "app"."group_unavailable_times"
  ADD CONSTRAINT "group_unavailable_times_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.group_participants(request_id) ON DELETE CASCADE;

ALTER TABLE "app"."requests"
  ADD CONSTRAINT "requests_group_meeting_id_fkey" FOREIGN KEY (group_meeting_id) REFERENCES app.group_meetings(id) ON DELETE CASCADE;

CREATE INDEX group_meetings_host_idx ON app.group_meetings USING btree (host_account_id, created_at DESC);

CREATE INDEX group_unavailable_times_request_idx ON app.group_unavailable_times USING btree (request_id, starts_at);

CREATE INDEX requests_group_meeting_idx ON app.requests USING btree (group_meeting_id)
  WHERE (group_meeting_id IS NOT NULL);
