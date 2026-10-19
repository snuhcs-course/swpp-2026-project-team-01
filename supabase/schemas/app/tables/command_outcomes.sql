-- Saved outcomes of completed commands, keyed by the verified actor and the
-- caller's retry key. The key is bound to the operation, resource and a hash of
-- the normalized input, so an identical retry returns the saved result and a
-- changed retry under the same key is a conflict.
CREATE TABLE "app"."command_outcomes" (
  "actor" text NOT NULL,
  "retry_key" text NOT NULL CHECK (char_length("retry_key") BETWEEN 1 AND 200),
  "operation" text NOT NULL,
  "resource_id" text NOT NULL,
  "input_hash" text NOT NULL,
  "result" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("actor", "retry_key")
);

ALTER TABLE "app"."command_outcomes" ENABLE ROW LEVEL SECURITY;
