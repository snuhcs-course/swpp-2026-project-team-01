-- One row per host account created, keyed by an HMAC of the source address (never
-- the address itself), for the rolling 24-hour sign-up bounds. Rows older than 24
-- hours are removed by app.cleanup_calendar_analyses.
CREATE TABLE "app"."signup_attempts" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "source_hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "signup_attempts_source_idx" ON "app"."signup_attempts" ("source_hash", "created_at");

CREATE INDEX "signup_attempts_created_idx" ON "app"."signup_attempts" ("created_at");

ALTER TABLE "app"."signup_attempts" ENABLE ROW LEVEL SECURITY;
