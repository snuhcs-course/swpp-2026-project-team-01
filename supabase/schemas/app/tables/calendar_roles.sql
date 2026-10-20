-- The calendar roles the host confirmed: the calendars checked for conflicts and
-- the one booking destination, each stored by provider identity with the name and
-- access role shown when it was saved. destination_verified_at is when the live
-- calendar list last showed the destination as owner or writer.
CREATE TABLE "app"."calendar_roles" (
  "host_account_id" uuid PRIMARY KEY REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "revision" integer NOT NULL DEFAULT 1 CHECK ("revision" >= 1),
  "conflict_calendars" jsonb NOT NULL CHECK (jsonb_typeof("conflict_calendars") = 'array'),
  "booking_calendar" jsonb NOT NULL CHECK (jsonb_typeof("booking_calendar") = 'object'),
  "destination_verified_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "app"."calendar_roles" ENABLE ROW LEVEL SECURITY;
