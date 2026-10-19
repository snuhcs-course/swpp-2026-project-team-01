-- The recorded stream of a retired session generation, copied from the runtime by
-- terminal recovery before the generation is retired, so the discussion's history
-- stays readable in order after the runtime session can no longer be streamed.
-- A retired session's last_stream_index is its event count, which offsets the next
-- generation's events in the discussion-level cursor.
CREATE TABLE "app"."agent_session_events" (
  "session_id" text NOT NULL REFERENCES "app"."agent_sessions" ("session_id"),
  "stream_index" integer NOT NULL CHECK ("stream_index" >= 0),
  "event" jsonb NOT NULL,
  PRIMARY KEY ("session_id", "stream_index")
);

ALTER TABLE "app"."agent_session_events" ENABLE ROW LEVEL SECURITY;
