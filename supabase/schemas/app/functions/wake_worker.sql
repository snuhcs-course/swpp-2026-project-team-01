-- Wake-up after jobs are inserted. Only production-produced jobs are worth a
-- request, because the worker claims nothing else.
CREATE FUNCTION "app"."wake_worker"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM inserted_jobs WHERE producer_environment = 'production') THEN
    PERFORM app.request_worker();
  END IF;

  RETURN NULL;
END;
$$;
