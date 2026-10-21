-- One row per request created, keyed by an HMAC of the source address (never the
-- address itself), for the rolling creation bounds per source and service-wide.
-- Rows older than 24 hours are removed by app.cleanup_calendar_analyses.
CREATE TABLE "app"."request_creations" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "source_hash" text NOT NULL,
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "request_creations_source_idx" ON "app"."request_creations" ("source_hash", "created_at");

CREATE INDEX "request_creations_created_idx" ON "app"."request_creations" ("created_at");

CREATE INDEX "request_creations_host_idx" ON "app"."request_creations" ("host_account_id");

ALTER TABLE "app"."request_creations" ENABLE ROW LEVEL SECURITY;
