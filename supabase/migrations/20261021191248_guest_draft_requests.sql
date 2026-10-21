SET local check_function_bodies = off;

DROP INDEX "app"."requests_actionable_expiry_idx";

ALTER TABLE "app"."requests"
  DROP CONSTRAINT "requests_state_check";

ALTER TABLE "app"."requests"
  ADD COLUMN "identity_requested_at" timestamp WITH time zone;

ALTER TABLE "app"."requests"
  ADD COLUMN "identified_at" timestamp WITH time zone;

ALTER TABLE "app"."requests"
  ALTER COLUMN "contact_email" DROP NOT NULL;

ALTER TABLE "app"."requests"
  ALTER COLUMN "requester_name" DROP NOT NULL;

CREATE OR REPLACE FUNCTION app.publish_request_expiry()
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  environment text;
  published uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.requests
    WHERE state IN ('draft', 'gathering', 'negotiating', 'awaiting_host_approval') AND expires_at <= now()
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM app.jobs WHERE kind = 'request_expiry' AND state IN ('pending', 'running')) THEN
    RETURN false;
  END IF;

  environment := CASE
    WHEN EXISTS (
      SELECT 1 FROM vault.decrypted_secrets WHERE name = 'worker_url' AND coalesce(decrypted_secret, '') <> ''
    ) THEN 'production'
    ELSE 'local'
  END;

  INSERT INTO app.jobs (kind, dedupe_key, producer_environment)
  VALUES (
    'request_expiry',
    'slot:' || to_char(date_bin('5 minutes', now(), timestamptz '2000-01-01 00:00:00+00') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
    environment
  )
  ON CONFLICT (kind, dedupe_key) DO NOTHING
  RETURNING id INTO published;

  RETURN published IS NOT NULL;
END;
$function$;

ALTER TABLE "app"."requests"
  ADD CONSTRAINT "requests_identified_contact" CHECK (((state = 'draft'::text) OR ((requester_name IS NOT NULL) AND (contact_email IS NOT NULL))));

ALTER TABLE "app"."requests"
  ADD CONSTRAINT "requests_state_check"
    CHECK
    ((state = ANY (ARRAY['draft'::text, 'gathering'::text, 'negotiating'::text, 'awaiting_host_approval'::text, 'booking'::text, 'booked'::text, 'declined'::text,
    'withdrawn'::text, 'expired'::text])));

CREATE INDEX requests_actionable_expiry_idx ON app.requests USING btree (expires_at)
  WHERE (state = ANY (ARRAY['draft'::text, 'gathering'::text, 'negotiating'::text, 'awaiting_host_approval'::text]));
