-- Hourly counts of recognized command rejections (operational-diagnostics:
-- bounded rejection observations; operations-and-release design 5, D6). Only
-- the fixed category and the UTC hour are stored, never the operation, actor,
-- input or error. app.record_rejection increments a bucket atomically, caps it
-- at 10,000 with saturated set, and prunes buckets older than the preceding 23
-- hours on every write.
CREATE TABLE "app"."rejection_observations" (
  "category" text NOT NULL CHECK ("category" IN ('authorization_denied', 'stale_action')),
  "bucket" timestamptz NOT NULL CHECK (
    "bucket" = date_bin('1 hour', "bucket", timestamptz '2000-01-01 00:00:00+00')
  ),
  "count" integer NOT NULL CHECK ("count" BETWEEN 1 AND 10000),
  "saturated" boolean NOT NULL DEFAULT false,
  PRIMARY KEY ("category", "bucket")
);

ALTER TABLE "app"."rejection_observations" ENABLE ROW LEVEL SECURITY;
