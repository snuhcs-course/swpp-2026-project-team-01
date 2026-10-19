CREATE TABLE "app"."agent_session_events" (
  "session_id"   text    NOT NULL,
  "stream_index" integer NOT NULL,
  "event"        jsonb   NOT NULL,
  CONSTRAINT "agent_session_events_pkey" PRIMARY KEY (session_id, stream_index),
  CONSTRAINT "agent_session_events_stream_index_check" CHECK ((stream_index >= 0))
);

ALTER TABLE "app"."agent_session_events"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "app"."agent_session_events"
  ADD CONSTRAINT "agent_session_events_session_id_fkey" FOREIGN KEY (session_id) REFERENCES app.agent_sessions(session_id);
