-- One anonymous intake conversation on a host's public page, before any request
-- exists (design decision 2). The browser keeps the random intake token for its
-- tab; only its hash is stored. source_hash is the keyed hash of the source
-- address used for the creation bounds, never the address. The draft holds what
-- the visitor described (purpose, duration, mode, location, windows, timezone,
-- language). An intake lasts 24 hours; request_id is the request it became, and
-- closed_at retires it so no further input or tool runs under its discussion.
CREATE TABLE "app"."intakes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL UNIQUE,
  "source_hash" text NOT NULL,
  "discussion_id" uuid NOT NULL UNIQUE REFERENCES "app"."discussions" ("id"),
  "draft" jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof("draft") = 'object'),
  "request_id" uuid UNIQUE REFERENCES "app"."requests" ("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  "closed_at" timestamptz,
  CONSTRAINT "intakes_request_closes" CHECK ("request_id" IS NULL OR "closed_at" IS NOT NULL)
);

CREATE INDEX "intakes_source_idx" ON "app"."intakes" ("source_hash", "created_at");

CREATE INDEX "intakes_host_idx" ON "app"."intakes" ("host_account_id");

ALTER TABLE "app"."intakes" ENABLE ROW LEVEL SECURITY;
