-- Messages the application accepted for a discussion, recorded before anything
-- reaches the runtime. The id is the accepted input that model calls are reserved
-- against; client_input_id is the caller's retry identity, and an exact retry
-- (same fingerprint) returns the same input while a changed one conflicts.
-- state: accepted (recorded, not yet delivered), sent (delivered to session_id),
-- completed (the turn that served it ended). delivery_ids are the runtime's
-- delivery identities of the input, recorded when a session reports receiving
-- it: proof it arrived, and how history recognizes a re-sent input.
-- received_session_id is the session that reported receiving the input since it
-- was last accepted; delivery_ids outlive a recovery, so only this says whether
-- the current delivery arrived.
-- protected_fingerprint is an HMAC of the retry fingerprint over the original,
-- unredacted text (design decision 14), so a changed secret under the same retry
-- key conflicts while the plaintext is gone; null for inputs accepted before it.
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
  "delivery_ids" text[] NOT NULL DEFAULT '{}',
  "received_session_id" text REFERENCES "app"."agent_sessions" ("session_id"),
  "protected_fingerprint" text,
  CONSTRAINT "conversation_inputs_client_input_key" UNIQUE ("discussion_id", "client_input_id")
);

CREATE INDEX "conversation_inputs_session_state_idx" ON "app"."conversation_inputs" ("session_id", "state");

ALTER TABLE "app"."conversation_inputs" ENABLE ROW LEVEL SECURITY;
