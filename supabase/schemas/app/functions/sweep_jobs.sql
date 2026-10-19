-- The every-minute recovery sweep run by pg_cron: when production work is due,
-- including jobs whose owner's lease expired, it requests the worker. A lost
-- wake-up therefore delays work by at most a minute.
CREATE FUNCTION "app"."sweep_jobs"()
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM app.jobs
    WHERE producer_environment = 'production'
      AND ((state = 'pending' AND run_after <= now()) OR (state = 'running' AND lease_expires_at <= now()))
  ) THEN
    RETURN app.request_worker();
  END IF;

  RETURN false;
END;
$$;
