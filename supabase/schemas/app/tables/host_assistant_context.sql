-- Private context belongs to an account, never to a guest request. The deletion
-- function discovers this FK and deletes these rows even though accounts keep
-- their nameless handle tombstone. No client role can access the app schema.
CREATE TABLE "app"."host_assistant_context" (
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "scope_key" text NOT NULL CHECK (char_length("scope_key") BETWEEN 1 AND 200),
  "kind" text NOT NULL CHECK ("kind" IN ('question', 'deferred', 'memory', 'capture')),
  "entry_key" text NOT NULL CHECK (char_length("entry_key") BETWEEN 1 AND 200),
  "revision" integer NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "content" jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof("content") = 'object' AND octet_length("content"::text) <= 6000),
  "source_input_id" uuid REFERENCES "app"."conversation_inputs" ("id") ON DELETE CASCADE,
  "operation_id" text NOT NULL CHECK (char_length("operation_id") BETWEEN 1 AND 300),
  "confirmed" boolean NOT NULL DEFAULT false,
  -- Forgotten entries retain only their key/provenance as a replay tombstone.
  "forgotten_at" timestamptz,
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("host_account_id", "scope_key", "kind", "entry_key"),
  CONSTRAINT "host_assistant_context_forgotten_empty" CHECK ("forgotten_at" IS NULL OR "content" = '{}'::jsonb)
);

CREATE INDEX "host_assistant_context_source_idx" ON "app"."host_assistant_context" ("source_input_id");
CREATE INDEX "host_assistant_context_expiry_idx" ON "app"."host_assistant_context" ("expires_at") WHERE "expires_at" IS NOT NULL;
ALTER TABLE "app"."host_assistant_context" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "app"."host_assistant_context" FROM PUBLIC, anon, authenticated;
