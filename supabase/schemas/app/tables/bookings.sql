-- One booking attempt of an approved proposal (design decisions 5 to 7). The ID
-- is the booking identity; event_id, derived from it (its 32 hex digits, valid
-- base32hex), is the Google event ID fixed before dispatch, so a repeated insert
-- cannot create a second event and reconciliation reads the event by it.
-- reserved_start and reserved_end are the proposal interval with the host's
-- buffers, which the per-host coordination counts as busy. payload is the event
-- body frozen when the dispatch is committed. States:
--   reserved     approved, waiting for revalidation; withdrawal and decline
--                still cancel it
--   dispatching  the dispatch is committed; the event may exist, so the booking
--                keeps its reservation until reconciliation knows
--   confirmed    the event exists; evidence holds iCalUID, htmlLink, join URL,
--                organizer and status from Google
--   failed       a conflict, an unavailable revalidation, a rejected write or a
--                removed event (failure_category)
--   cancelled    withdrawn, declined or expired before dispatch
-- At most one live (reserved, dispatching or confirmed) booking per request.
CREATE TABLE "app"."bookings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "proposal_id" uuid NOT NULL REFERENCES "app"."proposals" ("id") ON DELETE CASCADE,
  "approval_id" uuid NOT NULL REFERENCES "app"."approvals" ("id") ON DELETE CASCADE,
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "calendar_id" text NOT NULL,
  "event_id" text NOT NULL UNIQUE CHECK ("event_id" ~ '^[0-9a-v]{5,}$' AND char_length("event_id") <= 1024),
  "start_at" timestamptz NOT NULL,
  "end_at" timestamptz NOT NULL,
  "reserved_start" timestamptz NOT NULL,
  "reserved_end" timestamptz NOT NULL,
  "state" text NOT NULL DEFAULT 'reserved' CHECK (
    "state" IN ('reserved', 'dispatching', 'confirmed', 'failed', 'cancelled')
  ),
  "payload" jsonb CHECK (jsonb_typeof("payload") = 'object'),
  "evidence" jsonb CHECK (jsonb_typeof("evidence") = 'object'),
  "failure_category" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "dispatched_at" timestamptz,
  "confirmed_at" timestamptz,
  "settled_at" timestamptz,
  CONSTRAINT "bookings_interval" CHECK ("start_at" < "end_at" AND "reserved_start" <= "start_at" AND "end_at" <= "reserved_end"),
  CONSTRAINT "bookings_dispatched" CHECK (("state" = 'reserved' OR "state" = 'cancelled') OR "dispatched_at" IS NOT NULL OR "state" = 'failed'),
  CONSTRAINT "bookings_confirmed" CHECK (("state" = 'confirmed') = ("confirmed_at" IS NOT NULL)),
  CONSTRAINT "bookings_payload" CHECK ("state" IN ('reserved', 'cancelled', 'failed') OR "payload" IS NOT NULL)
);

CREATE UNIQUE INDEX "bookings_one_live_idx" ON "app"."bookings" ("request_id")
  WHERE "state" IN ('reserved', 'dispatching', 'confirmed');

-- The host's in-flight and confirmed bookings, which revalidation counts as busy.
CREATE INDEX "bookings_host_reserved_idx" ON "app"."bookings" ("host_account_id", "reserved_start")
  WHERE "state" IN ('dispatching', 'confirmed');

ALTER TABLE "app"."bookings" ENABLE ROW LEVEL SECURITY;
