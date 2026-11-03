-- A guest who is a host (guest-flow-completion design 6, D7): the host account
-- whose verified Google subject matched the guest's on the requester Google
-- return, and the items of their host settings the guest chose for this
-- request. decided_at is null until **Use these settings** or **Not now**
-- (items empty); the card is offered while it is null. The row is deleted when
-- the request closes, with its requester grants, or with the request. Nothing
-- here reaches the request's host.
CREATE TABLE "app"."requester_host_profiles" (
  "request_id" uuid PRIMARY KEY REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "items" text[] NOT NULL DEFAULT '{}' CHECK ("items" <@ ARRAY['calendars', 'details']::text[]),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "decided_at" timestamptz
);

ALTER TABLE "app"."requester_host_profiles" ENABLE ROW LEVEL SECURITY;
