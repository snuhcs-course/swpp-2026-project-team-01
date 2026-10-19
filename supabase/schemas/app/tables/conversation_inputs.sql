-- Messages the application accepted for a discussion, recorded before anything
-- reaches the runtime. The id is the accepted input that model calls are reserved
-- against; client_input_id is the caller's retry identity, and an exact retry
-- (same fingerprint) returns the same input while a changed one conflicts.
-- state: accepted (recorded, not yet delivered), sent (delivered to session_id),
-- completed (a turn of that session finished after it was sent).
CREATE TABLE "app"."conversation_inputs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "discussion_id" uuid NOT NULL REFERENCES "app"."discussions" ("id"),
  "client_input_id" uuid NOT NULL,
  "fingerprint" text NOT NULL,
  "message" text NOT NULL,
  "state" text NOT NULL DEFAULT 'accepted' CHECK ("state" IN ('accepted', 'sent', 'completed')),
  "session_id" text REFERENCES "app"."agent_sessions" ("session_id"),
  "accepted_at" timestamptz NOT NULL DEFAULT now(),
  "sent_at" timestamptz,
  "completed_at" timestamptz,
  CONSTRAINT "conversation_inputs_client_input_key" UNIQUE ("discussion_id", "client_input_id")
);

CREATE INDEX "conversation_inputs_session_state_idx" ON "app"."conversation_inputs" ("session_id", "state");

ALTER TABLE "app"."conversation_inputs" ENABLE ROW LEVEL SECURITY;
