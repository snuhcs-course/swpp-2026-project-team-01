-- One phone check, and once a matching reply arrives the host's linked iMessage
-- number (host-imessage-linking). A host has at most one row that is not closed;
-- starting a new check closes the previous unfinished one. A number is linked to
-- at most one host at a time. "expired" is not stored: a read reports it once
-- expires_at has passed.
CREATE TABLE "app"."imessage_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "phone_e164" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  -- Every number that still connects: [{ "code": "42", "expiresAt": "<iso>" }].
  -- A wrong reply replaces the list with one new number.
  "valid_codes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The newest number, shown on screen; null until a text is out.
  "code" text,
  "expires_at" timestamptz NOT NULL,
  "retry_eligible_at" timestamptz,
  "failure" text,
  "wrong_replies" integer NOT NULL DEFAULT 0,
  -- The provider's direct conversation and line, once known.
  "space_id" text,
  "line" text,
  "revision" integer NOT NULL DEFAULT 0,
  "connected_at" timestamptz,
  "closed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  -- Written as Postgres prints them, so declarative syncs see no difference.
  CONSTRAINT "imessage_links_phone_e164_check" CHECK ((phone_e164 ~ '^\+[1-9][0-9]{6,14}$'::text)),
  CONSTRAINT "imessage_links_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'uncertain'::text, 'connected'::text, 'failed'::text, 'closed'::text]))),
  CONSTRAINT "imessage_links_code_check" CHECK (((code IS NULL) OR (code ~ '^[0-9]{2}$'::text))),
  CONSTRAINT "imessage_links_wrong_replies_check" CHECK ((wrong_replies >= 0))
);

CREATE UNIQUE INDEX "imessage_links_one_open_idx" ON "app"."imessage_links" ("host_account_id")
  WHERE "status" <> 'closed';

CREATE UNIQUE INDEX "imessage_links_one_linked_idx" ON "app"."imessage_links" ("phone_e164")
  WHERE "status" = 'connected';

CREATE INDEX "imessage_links_checking_idx" ON "app"."imessage_links" ("phone_e164")
  WHERE "status" = ANY (ARRAY['pending'::text, 'sent'::text, 'uncertain'::text, 'failed'::text]);

ALTER TABLE "app"."imessage_links" ENABLE ROW LEVEL SECURITY;
