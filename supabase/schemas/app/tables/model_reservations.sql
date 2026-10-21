-- Model allowance, reserved durably before every provider attempt and never
-- released: a failed or uncertain attempt stays charged. Attempts are counted per
-- work item (an accepted conversation input or a ranking check), and spend per
-- principal and service-wide in fixed 24-hour windows. `anonymous` marks spend
-- that counts toward the anonymous allowance: an intake's, and a request's while
-- its contact is unconfirmed and it has no live Google identity grant.
CREATE TABLE "app"."model_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "work_kind" text NOT NULL CHECK ("work_kind" IN ('conversation_input', 'ranking_check')),
  "work_id" uuid NOT NULL,
  "principal_type" text NOT NULL CHECK ("principal_type" IN ('host_account', 'requester_request', 'public_intake')),
  "principal_id" uuid NOT NULL,
  "session_id" text REFERENCES "app"."agent_sessions" ("session_id"),
  "amount_usd" numeric(6, 2) NOT NULL CHECK ("amount_usd" > 0),
  "window_start" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "anonymous" boolean NOT NULL DEFAULT false
);

CREATE INDEX "model_reservations_work_idx" ON "app"."model_reservations" ("work_kind", "work_id");

CREATE INDEX "model_reservations_principal_window_idx"
  ON "app"."model_reservations" ("principal_type", "principal_id", "window_start");

CREATE INDEX "model_reservations_window_idx" ON "app"."model_reservations" ("window_start");

ALTER TABLE "app"."model_reservations" ENABLE ROW LEVEL SECURITY;
