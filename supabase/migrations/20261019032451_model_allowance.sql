CREATE TABLE "app"."agent_sessions" (
  "session_id"        text                     NOT NULL,
  "session_id_hash"   text                     NOT NULL,
  "discussion_id"     uuid                     NOT NULL,
  "principal_type"    text                     NOT NULL,
  "principal_id"      uuid                     NOT NULL,
  "generation"        integer                  NOT NULL,
  "last_stream_index" integer,
  "agent_version"     text                     NOT NULL,
  "state"             text                     NOT NULL DEFAULT 'active'::text,
  "current_input_id"  uuid,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "agent_sessions_discussion_generation_key" UNIQUE (discussion_id, generation),
  CONSTRAINT "agent_sessions_generation_check" CHECK ((generation >= 1)),
  CONSTRAINT "agent_sessions_pkey" PRIMARY KEY (session_id),
  CONSTRAINT "agent_sessions_principal_type_check" CHECK ((principal_type = ANY (ARRAY['host_account'::text, 'requester_request'::text]))),
  CONSTRAINT "agent_sessions_session_id_hash_key" UNIQUE (session_id_hash),
  CONSTRAINT "agent_sessions_state_check" CHECK ((state = ANY (ARRAY['active'::text, 'failed'::text, 'retired'::text])))
);

ALTER TABLE "app"."agent_sessions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."model_reservations" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "work_kind"      text                     NOT NULL,
  "work_id"        uuid                     NOT NULL,
  "principal_type" text                     NOT NULL,
  "principal_id"   uuid                     NOT NULL,
  "session_id"     text,
  "amount_usd"     numeric(6,2)             NOT NULL,
  "window_start"   timestamp with time zone NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "model_reservations_amount_usd_check" CHECK ((amount_usd > (0)::numeric)),
  CONSTRAINT "model_reservations_pkey" PRIMARY KEY (id),
  CONSTRAINT "model_reservations_principal_type_check" CHECK ((principal_type = ANY (ARRAY['host_account'::text, 'requester_request'::text]))),
  CONSTRAINT "model_reservations_work_kind_check" CHECK ((work_kind = ANY (ARRAY['conversation_input'::text, 'ranking_check'::text])))
);

ALTER TABLE "app"."model_reservations"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "app"."model_reservations"
  ADD CONSTRAINT "model_reservations_session_id_fkey" FOREIGN KEY (session_id) REFERENCES app.agent_sessions(session_id);

CREATE UNIQUE INDEX agent_sessions_one_active_idx ON app.agent_sessions USING btree (discussion_id)
  WHERE (state = 'active'::text);

CREATE INDEX model_reservations_principal_window_idx ON app.model_reservations USING btree (principal_type, principal_id, window_start);

CREATE INDEX model_reservations_window_idx ON app.model_reservations USING btree (window_start);

CREATE INDEX model_reservations_work_idx ON app.model_reservations USING btree (work_kind, work_id);
