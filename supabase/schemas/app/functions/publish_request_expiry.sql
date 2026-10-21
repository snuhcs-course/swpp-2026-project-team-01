-- The 5-minute expiry schedule run by pg_cron (design decision 4): when an
-- actionable request is past its expires_at, it publishes one request_expiry job,
-- whose handler closes due requests in batches of 200. A job that is still
-- pending or running is not duplicated, and the 5-minute slot is the dedupe key,
-- so a repeated run in the same slot publishes nothing. The job is produced for
-- production when the worker is configured in Vault (as only the production
-- database is) and for local otherwise, where npm run jobs:dev claims it.
-- Commands reject an expired request themselves, so a late sweep never lets a
-- decision through. Returns whether a job was published. Execution is revoked from
-- PUBLIC: only the owner role runs it.
CREATE FUNCTION "app"."publish_request_expiry"()
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  environment text;
  published uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.requests
    WHERE state IN ('gathering', 'negotiating', 'awaiting_host_approval') AND expires_at <= now()
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
$$;
