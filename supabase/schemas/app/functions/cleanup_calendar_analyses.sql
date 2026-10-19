-- Scheduled maintenance: removes up to `batch` Calendar analysis rows older than 24
-- hours, and as many expired sign-up attempt rows, skipping rows another
-- transaction holds so a pass never waits on active work. Returns the number of
-- analysis rows removed. Execution is revoked from PUBLIC: only the owner role,
-- the database maintenance operator, runs it, from pg_cron every 15 minutes.
CREATE FUNCTION "app"."cleanup_calendar_analyses"("batch" integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  removed integer;
BEGIN
  WITH doomed AS (
    SELECT a.id FROM app.calendar_analyses a
    WHERE a.created_at < now() - interval '24 hours'
    ORDER BY a.created_at
    LIMIT greatest(batch, 0)
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM app.calendar_analyses a USING doomed WHERE a.id = doomed.id;
  GET DIAGNOSTICS removed = ROW_COUNT;

  WITH doomed AS (
    SELECT s.id FROM app.signup_attempts s
    WHERE s.created_at < now() - interval '24 hours'
    ORDER BY s.created_at
    LIMIT greatest(batch, 0)
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM app.signup_attempts s USING doomed WHERE s.id = doomed.id;

  RETURN removed;
END;
$$;
