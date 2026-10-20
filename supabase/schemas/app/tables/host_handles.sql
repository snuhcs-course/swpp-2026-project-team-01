-- Every public handle ever assigned, and the host it belongs to for good. The
-- handle is the primary key, so a released handle is never assigned to another
-- host; its own host may take it back, which clears released_at again. At most one
-- handle per host is current (released_at is null).
CREATE TABLE "app"."host_handles" (
  "handle" text PRIMARY KEY,
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "assigned_at" timestamptz NOT NULL DEFAULT now(),
  "released_at" timestamptz,
  -- Written as Postgres prints it, so declarative syncs see no difference.
  CONSTRAINT "host_handles_handle_check" CHECK ((((char_length(handle) >= 3) AND (char_length(handle) <= 30)) AND (handle ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'::text)))
);

CREATE UNIQUE INDEX "host_handles_one_current_idx" ON "app"."host_handles" ("host_account_id")
  WHERE "released_at" IS NULL;

ALTER TABLE "app"."host_handles" ENABLE ROW LEVEL SECURITY;
