-- The audit record of operator recoveries and deletions (operations-and-release
-- design 6 and 9, D7 and D10), written in the same statement as the change by
-- the app.operator_* function that makes it. target_id has no foreign key, so
-- the audit of a deletion outlives the deleted rows; previous_state is the fixed
-- state the operator found, never stored content.
CREATE TABLE "app"."operator_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "operator" text NOT NULL CHECK (char_length("operator") BETWEEN 1 AND 100),
  "action" text NOT NULL CHECK ("action" IN ('requeue_job', 'reconcile_booking', 'delete_host', 'delete_request')),
  "target_id" uuid NOT NULL,
  "previous_state" text NOT NULL CHECK (char_length("previous_state") BETWEEN 1 AND 100),
  "reason" text NOT NULL CHECK (char_length("reason") BETWEEN 1 AND 500),
  "environment" text NOT NULL CHECK (char_length("environment") BETWEEN 1 AND 100),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "operator_operations_target_idx" ON "app"."operator_operations" ("target_id", "created_at");

ALTER TABLE "app"."operator_operations" ENABLE ROW LEVEL SECURITY;
