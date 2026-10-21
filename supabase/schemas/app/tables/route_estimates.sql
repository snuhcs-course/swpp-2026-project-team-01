-- Cached Google Routes results (design decision 9), one per origin, destination,
-- mode and 15-minute departure slot, valid for 24 hours from fetched_at. Endpoints
-- are keyed hashes of the location text plus the place IDs Google resolved, never
-- cleartext event locations. A changed location changes the key. outcome no_route
-- or failed leaves the leg unresolved.
CREATE TABLE "app"."route_estimates" (
  "origin_hash" text NOT NULL,
  "destination_hash" text NOT NULL,
  "mode" text NOT NULL CHECK ("mode" IN ('driving', 'transit', 'walking')),
  "departure_slot" timestamptz NOT NULL CHECK (extract(epoch FROM "departure_slot") % 900 = 0),
  "origin_place_id" text,
  "destination_place_id" text,
  "outcome" text NOT NULL CHECK ("outcome" IN ('route', 'no_route', 'failed')),
  "duration_seconds" integer CHECK ("duration_seconds" >= 0),
  "distance_meters" integer CHECK ("distance_meters" >= 0),
  "fetched_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("origin_hash", "destination_hash", "mode", "departure_slot"),
  CONSTRAINT "route_estimates_route_duration" CHECK (("outcome" = 'route') = ("duration_seconds" IS NOT NULL))
);

CREATE INDEX "route_estimates_fetched_idx" ON "app"."route_estimates" ("fetched_at");

ALTER TABLE "app"."route_estimates" ENABLE ROW LEVEL SECURITY;
