-- Queued link resend work (design decision 7), recorded so the public answer
-- never waits on matching. The address is kept as a keyed hash and sealed for
-- the link_resend job, and the row is deleted once the job has processed it.
-- (address_hash, retry_key) makes a retried call one attempt.
CREATE TABLE "app"."link_resend_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "address_hash" text NOT NULL,
  "address_ciphertext" text NOT NULL,
  "address_key_id" text NOT NULL,
  "retry_key" text NOT NULL CHECK (char_length("retry_key") BETWEEN 1 AND 200),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "link_resend_attempts_retry_key" UNIQUE ("address_hash", "retry_key")
);

CREATE INDEX "link_resend_attempts_created_idx" ON "app"."link_resend_attempts" ("created_at");

ALTER TABLE "app"."link_resend_attempts" ENABLE ROW LEVEL SECURITY;
