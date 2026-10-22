-- AgentMail threads bound to requests (requester-email-channel design 3 to 5).
-- A thread is bound when an authenticated email starts a request (origin
-- started) or carries the request's pending link code (origin linked). Only the
-- keyed hash of the bound sender address is kept, never the address. Messages
-- from that address in an active binding of an open request are forwarded into
-- the request's requester discussion; unlinking ends the binding at once.
-- last_message_id is the latest forwarded or binding message, which thread
-- notices reply to; closed_notice_at records the one closed-request notice.
-- bound_by_receipt_id is the receipt that created the binding, so a retried
-- job recognizes the linking or starting message it already handled.
CREATE TABLE "app"."email_threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "inbox_id" text NOT NULL CHECK (char_length("inbox_id") BETWEEN 1 AND 320),
  "thread_id" text NOT NULL CHECK (char_length("thread_id") BETWEEN 1 AND 500),
  "origin" text NOT NULL CHECK ("origin" IN ('started', 'linked')),
  "sender_hash" text NOT NULL CHECK ("sender_hash" ~ '^[0-9a-f]{64}$'),
  "state" text NOT NULL DEFAULT 'active' CHECK ("state" IN ('active', 'unlinked')),
  "bound_by_receipt_id" uuid NOT NULL,
  "last_message_id" text NOT NULL CHECK (char_length("last_message_id") BETWEEN 1 AND 1000),
  "closed_notice_at" timestamptz,
  "bound_at" timestamptz NOT NULL DEFAULT now(),
  "ended_at" timestamptz,
  CONSTRAINT "email_threads_ended" CHECK (("state" = 'active') = ("ended_at" IS NULL))
);

CREATE UNIQUE INDEX "email_threads_active_thread_key" ON "app"."email_threads" ("inbox_id", "thread_id") WHERE "state" = 'active';

CREATE UNIQUE INDEX "email_threads_active_request_key" ON "app"."email_threads" ("request_id") WHERE "state" = 'active';

CREATE INDEX "email_threads_request_idx" ON "app"."email_threads" ("request_id", "bound_at");

ALTER TABLE "app"."email_threads" ENABLE ROW LEVEL SECURITY;
