-- One host account per Google identity. Suspension is an operator decision made
-- through the administrator CLI; setup readiness is derived from saved settings,
-- not stored here. display_name is the Google profile name at sign-in, the
-- starting point for the public display name the host confirms in setup.
CREATE TABLE "app"."host_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'suspended')),
  "display_name" text CHECK (char_length("display_name") <= 200),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "app"."host_accounts" ENABLE ROW LEVEL SECURITY;
