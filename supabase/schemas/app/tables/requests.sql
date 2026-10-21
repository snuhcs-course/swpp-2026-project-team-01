-- A meeting request and its lifecycle (design decision 4). Every change advances
-- the revision, which commands check as the expected revision. details holds the
-- purpose, duration, mode, location or link plan, windows, requester timezone,
-- language and the requester's travel mode. contact_email is the address the
-- requester gave; contact_confirmed_email is set only when that same address was
-- confirmed (by the creation email's link or a verified Google address), and is
-- what link resend matches. expires_at is the earlier of creation plus seven days
-- and the end of the latest requested window. A closed request (booked, declined,
-- withdrawn or expired) has closed_at; gathering, negotiating and
-- awaiting_host_approval are the actionable states the expiry sweep closes.
CREATE TABLE "app"."requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "state" text NOT NULL DEFAULT 'gathering' CHECK (
    "state" IN (
      'gathering', 'negotiating', 'awaiting_host_approval', 'booking', 'booked', 'declined', 'withdrawn', 'expired'
    )
  ),
  "revision" integer NOT NULL DEFAULT 1 CHECK ("revision" >= 1),
  "details" jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof("details") = 'object'),
  "requester_name" text NOT NULL CHECK (char_length("requester_name") BETWEEN 1 AND 200),
  "contact_email" text NOT NULL CHECK (char_length("contact_email") BETWEEN 3 AND 320),
  "contact_confirmed_email" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "closed_at" timestamptz,
  CONSTRAINT "requests_closed" CHECK (
    ("state" IN ('booked', 'declined', 'withdrawn', 'expired')) = ("closed_at" IS NOT NULL)
  ),
  CONSTRAINT "requests_confirmed_contact" CHECK (
    "contact_confirmed_email" IS NULL OR "contact_confirmed_email" = "contact_email"
  )
);

CREATE INDEX "requests_host_idx" ON "app"."requests" ("host_account_id", "created_at" DESC);

-- The expiry sweep's due requests.
CREATE INDEX "requests_actionable_expiry_idx" ON "app"."requests" ("expires_at")
  WHERE "state" IN ('gathering', 'negotiating', 'awaiting_host_approval');

-- Link resend matches open requests by their confirmed contact.
CREATE INDEX "requests_confirmed_contact_idx" ON "app"."requests" ("contact_confirmed_email")
  WHERE "closed_at" IS NULL AND "contact_confirmed_email" IS NOT NULL;

ALTER TABLE "app"."requests" ENABLE ROW LEVEL SECURITY;
