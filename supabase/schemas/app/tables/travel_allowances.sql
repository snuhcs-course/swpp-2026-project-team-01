-- Manual travel allowances, each for one leg of one candidate (design decision
-- 10): the party whose trip it is, the candidate interval, the direction, the
-- keyed hashes of the origin and destination endpoints and the mode, in 5-minute
-- steps from 5 to 240 minutes. An allowance is void when the candidate interval,
-- either endpoint or the mode changes, which sets invalidated_at. The requester
-- projection never shows a host allowance.
CREATE TABLE "app"."travel_allowances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "party" text NOT NULL CHECK ("party" IN ('host', 'requester')),
  "candidate_start" timestamptz NOT NULL,
  "candidate_end" timestamptz NOT NULL,
  "direction" text NOT NULL CHECK ("direction" IN ('inbound', 'outbound')),
  "origin_hash" text NOT NULL,
  "destination_hash" text NOT NULL,
  "mode" text NOT NULL CHECK ("mode" IN ('driving', 'transit', 'walking')),
  "minutes" integer NOT NULL,
  "confirmed_by" text NOT NULL CHECK ("confirmed_by" IN ('host', 'requester')),
  "confirmed_at" timestamptz NOT NULL DEFAULT now(),
  "invalidated_at" timestamptz,
  CONSTRAINT "travel_allowances_interval" CHECK ("candidate_start" < "candidate_end"),
  -- Written as Postgres prints it, so declarative syncs see no difference.
  CONSTRAINT "travel_allowances_minutes_check" CHECK ((((minutes >= 5) AND (minutes <= 240)) AND ((minutes % 5) = 0)))
);

-- At most one live allowance per leg.
CREATE UNIQUE INDEX "travel_allowances_one_live_idx" ON "app"."travel_allowances" (
  "request_id", "party", "candidate_start", "candidate_end", "direction", "origin_hash", "destination_hash", "mode"
) WHERE "invalidated_at" IS NULL;

ALTER TABLE "app"."travel_allowances" ENABLE ROW LEVEL SECURITY;
