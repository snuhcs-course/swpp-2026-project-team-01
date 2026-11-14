-- The weekly note check run by pg_cron (calendar-note-review design 9): publishes
-- one weekly_note_check job per active host with confirmed settings and a stored,
-- valid Google grant, keyed by the host and the week's Monday in Asia/Seoul, so a
-- repeated run in the same week publishes nothing new. The job itself checks the
-- host is ready, scans afresh and records the review. The job is produced for
-- production when the worker is configured in Vault (as only the production
-- database is) and for local otherwise, where npm run jobs:dev claims it. Returns
-- how many jobs were published. Execution is revoked from PUBLIC: only the owner
-- role runs it.
CREATE FUNCTION "app"."publish_weekly_note_checks"()
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  environment text;
  this_week text;
  published integer;
BEGIN
  environment := CASE
    WHEN EXISTS (
      SELECT 1 FROM vault.decrypted_secrets WHERE name = 'worker_url' AND coalesce(decrypted_secret, '') <> ''
    ) THEN 'production'
    ELSE 'local'
  END;
  this_week := to_char(date_trunc('week', now() AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD');

  INSERT INTO app.jobs (kind, payload, dedupe_key, producer_environment)
  SELECT 'weekly_note_check',
         jsonb_build_object('hostAccountId', a.id, 'week', this_week),
         'weekly_note_check:' || a.id::text || ':' || this_week,
         environment
  FROM app.host_accounts a
  JOIN app.host_settings s ON s.host_account_id = a.id
  JOIN app.provider_grants g ON g.host_account_id = a.id
  WHERE a.status = 'active' AND g.refresh_token_ciphertext IS NOT NULL AND g.invalidated_at IS NULL
  ON CONFLICT (kind, dedupe_key) DO NOTHING;

  GET DIAGNOSTICS published = ROW_COUNT;
  RETURN published;
END;
$$;
