-- One row per handle assignment, including a host taking back its own released
-- handle. The rolling 30-day change limit counts these rows; the first assignment
-- is free.
CREATE TABLE "app"."handle_assignments" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "handle" text NOT NULL REFERENCES "app"."host_handles" ("handle"),
  "assigned_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "handle_assignments_host_idx" ON "app"."handle_assignments" ("host_account_id", "assigned_at");

ALTER TABLE "app"."handle_assignments" ENABLE ROW LEVEL SECURITY;
