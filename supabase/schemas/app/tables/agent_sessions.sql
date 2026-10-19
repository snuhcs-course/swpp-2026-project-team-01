-- The application session index: one row per eve runtime session, written by the
-- application before the session's first message (design decision 7). It is what
-- authorizes reading and streaming a session, and what attributes every model call:
-- eve sends the base64url SHA-256 of the session ID as the OpenAI prompt cache key,
-- and the model limit middleware looks that hash up here.
CREATE TABLE "app"."agent_sessions" (
  "session_id" text PRIMARY KEY,
  "session_id_hash" text NOT NULL UNIQUE,
  -- The logical conversation the session serves; a recovered successor keeps it
  -- with the next generation.
  "discussion_id" uuid NOT NULL,
  "principal_type" text NOT NULL CHECK ("principal_type" IN ('host_account', 'requester_request')),
  "principal_id" uuid NOT NULL,
  "generation" integer NOT NULL CHECK ("generation" >= 1),
  "last_stream_index" integer,
  "agent_version" text NOT NULL,
  "state" text NOT NULL DEFAULT 'active' CHECK ("state" IN ('active', 'failed', 'retired')),
  -- The accepted input the session is currently working on; model calls are
  -- reserved against it.
  "current_input_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "agent_sessions_discussion_generation_key" UNIQUE ("discussion_id", "generation")
);

-- At most one live generation per discussion.
CREATE UNIQUE INDEX "agent_sessions_one_active_idx" ON "app"."agent_sessions" ("discussion_id")
  WHERE "state" = 'active';

ALTER TABLE "app"."agent_sessions" ENABLE ROW LEVEL SECURITY;
