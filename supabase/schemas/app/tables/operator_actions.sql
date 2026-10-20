-- The audit record of operator suspensions and restorations, written in the same
-- statement as the status change by app.operator_set_host_status.
CREATE TABLE "app"."operator_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "operator" text NOT NULL CHECK (char_length("operator") BETWEEN 1 AND 100),
  "action" text NOT NULL CHECK ("action" IN ('suspend', 'restore')),
  "host_account_id" uuid NOT NULL REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE,
  "previous_status" text NOT NULL,
  "reason" text NOT NULL CHECK (char_length("reason") BETWEEN 1 AND 500),
  "environment" text NOT NULL CHECK (char_length("environment") BETWEEN 1 AND 100),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "operator_actions_host_idx" ON "app"."operator_actions" ("host_account_id", "created_at");

ALTER TABLE "app"."operator_actions" ENABLE ROW LEVEL SECURITY;
