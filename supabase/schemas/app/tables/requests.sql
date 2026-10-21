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
-- A draft (design decision 2, D13) is the guest's conversation before they
-- give a name and email: it has neither, is invisible to every host projection,
-- list and count, expires 24 hours after creation and is then deleted with its
-- discussion by the expiry job. identity_requested_at is when the assistant or
-- a gated operation first asked for the guest's identity (where the identity
-- card is anchored in the thread); identified_at is when request.identify or
-- the Google return moved the draft to gathering. calendar_settled_at is when the
-- guest settled the Calendar step (**Skip for now**, or calendars saved), so the
-- thread offers the next step instead of the Calendar card; a new Calendar grant
-- or **Change** clears it.
CREATE TABLE "app"."requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "state" text NOT NULL DEFAULT 'gathering' CHECK (
    "state" IN (
      'draft', 'gathering', 'negotiating', 'awaiting_host_approval', 'booking', 'booked', 'declined', 'withdrawn', 'expired'
    )
  ),
  "revision" integer NOT NULL DEFAULT 1 CHECK ("revision" >= 1),
  "details" jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof("details") = 'object'),
  "requester_name" text CHECK (char_length("requester_name") BETWEEN 1 AND 200),
  "contact_email" text CHECK (char_length("contact_email") BETWEEN 3 AND 320),
  "contact_confirmed_email" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "closed_at" timestamptz,
  "identity_requested_at" timestamptz,
  "identified_at" timestamptz,
  "calendar_settled_at" timestamptz,
  CONSTRAINT "requests_closed" CHECK (
    ("state" IN ('booked', 'declined', 'withdrawn', 'expired')) = ("closed_at" IS NOT NULL)
  ),
  CONSTRAINT "requests_identified_contact" CHECK (
    "state" = 'draft' OR ("requester_name" IS NOT NULL AND "contact_email" IS NOT NULL)
  ),
  CONSTRAINT "requests_confirmed_contact" CHECK (
    "contact_confirmed_email" IS NULL OR "contact_confirmed_email" = "contact_email"
  )
);

CREATE INDEX "requests_host_idx" ON "app"."requests" ("host_account_id", "created_at" DESC);

-- The expiry sweep's due requests and drafts.
CREATE INDEX "requests_actionable_expiry_idx" ON "app"."requests" ("expires_at")
  WHERE "state" IN ('draft', 'gathering', 'negotiating', 'awaiting_host_approval');

-- Link resend matches open requests by their confirmed contact.
CREATE INDEX "requests_confirmed_contact_idx" ON "app"."requests" ("contact_confirmed_email")
  WHERE "closed_at" IS NULL AND "contact_confirmed_email" IS NOT NULL;

ALTER TABLE "app"."requests" ENABLE ROW LEVEL SECURITY;
