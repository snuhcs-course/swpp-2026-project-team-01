-- Wake-up after jobs are inserted. Only production-produced jobs are worth a
-- request, because the worker claims nothing else. The wake-up is best effort:
-- a Vault or pg_net error is reported as a warning and never rolls back the
-- domain change that published the jobs; the every-minute sweep requests the
-- worker later.
CREATE FUNCTION "app"."wake_worker"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM inserted_jobs WHERE producer_environment = 'production') THEN
    BEGIN
      PERFORM app.request_worker();
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'job worker wake-up failed: %', SQLERRM;
    END;
  END IF;

  RETURN NULL;
END;
$$;
