-- Counted attempts for the agent protocol's bounds (agent-access design 12):
-- registrations per source, authorization requests per source, token requests
-- per client, metadata document fetches per client ID and tool calls per grant.
-- key_hash is a hash of the counted key, never the key itself. Rows older than a
-- day are no longer read and are deleted on the next count of the same kind.
CREATE TABLE "app"."agent_protocol_attempts" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "kind" text NOT NULL CHECK ("kind" IN ('registration', 'authorization', 'token', 'metadata_fetch', 'tool_call')),
  "key_hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "agent_protocol_attempts_key_idx" ON "app"."agent_protocol_attempts" ("kind", "key_hash", "created_at");

ALTER TABLE "app"."agent_protocol_attempts" ENABLE ROW LEVEL SECURITY;
