-- The 600-per-minute link resend attempt budget (design decision 7): a fixed ring
-- of two slots, each holding a minute's start and its count, so the budget
-- stores no caller address or claim. Slot is the minute number modulo 2.
CREATE TABLE "app"."resend_budget" (
  "slot" smallint PRIMARY KEY CHECK ("slot" IN (0, 1)),
  "minute_start" timestamptz NOT NULL,
  "count" integer NOT NULL DEFAULT 0 CHECK ("count" >= 0)
);

ALTER TABLE "app"."resend_budget" ENABLE ROW LEVEL SECURITY;
