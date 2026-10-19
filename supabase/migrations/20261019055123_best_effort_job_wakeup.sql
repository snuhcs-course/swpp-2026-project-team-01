SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION app.wake_worker()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;
