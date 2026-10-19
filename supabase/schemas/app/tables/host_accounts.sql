-- One host account per Google identity. Suspension is an operator decision
-- (Phase 2); setup readiness is derived from saved settings, not stored here.
CREATE TABLE "app"."host_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'suspended')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "app"."host_accounts" ENABLE ROW LEVEL SECURITY;
