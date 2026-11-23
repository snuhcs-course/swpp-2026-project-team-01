-- One host account per Google identity. Suspension is an operator decision made
-- through the administrator CLI; setup readiness is derived from saved settings,
-- not stored here. display_name is the Google profile name at sign-in, the
-- starting point for the public display name the host confirms in setup.
CREATE TABLE "app"."host_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'suspended')),
  "accepting_requests" boolean NOT NULL DEFAULT true,
  "intake_revision" integer NOT NULL DEFAULT 0,
  "display_name" text CHECK (char_length("display_name") <= 200),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  -- Set when the operator deleted the host's data on request (operations-and-
  -- release D10): the row stays, suspended and nameless, with its handle history.
  "deleted_at" timestamptz,
  -- When the host's own deletion from Settings falls due (self-service-account-
  -- deletion D1); null when none is scheduled. Signing in clears it.
  "deletion_due_at" timestamptz,
  -- The host's notes for Thyme (host-preference-notes): free-text meeting
  -- preferences the guest's assistant uses to shape what it proposes. Not
  -- scheduling policy: feasibility never reads them. Null until the host answers
  -- the setup step; an empty string means the host has none.
  "assistant_notes" text CHECK (char_length("assistant_notes") <= 1000),
  "assistant_notes_updated_at" timestamptz,
  CONSTRAINT "host_accounts_deleted_suspended" CHECK ("deleted_at" IS NULL OR ("status" = 'suspended' AND "display_name" IS NULL)),
  CONSTRAINT "host_accounts_deleted_unscheduled" CHECK ("deleted_at" IS NULL OR "deletion_due_at" IS NULL),
  CONSTRAINT "host_accounts_deleted_no_notes" CHECK ("deleted_at" IS NULL OR "assistant_notes" IS NULL),
  CONSTRAINT "host_accounts_notes_saved_at" CHECK (("assistant_notes" IS NULL) = ("assistant_notes_updated_at" IS NULL))
);

ALTER TABLE "app"."host_accounts" ENABLE ROW LEVEL SECURITY;
