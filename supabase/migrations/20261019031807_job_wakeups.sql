SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION app.request_worker()
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  worker_url text;
  worker_secret text;
BEGIN
  SELECT decrypted_secret INTO worker_url FROM vault.decrypted_secrets WHERE name = 'worker_url';
  SELECT decrypted_secret INTO worker_secret FROM vault.decrypted_secrets WHERE name = 'worker_secret';

  IF coalesce(worker_url, '') = '' OR coalesce(worker_secret, '') = '' THEN
    RETURN false;
  END IF;

  PERFORM net.http_post(
    url := worker_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('authorization', 'Bearer ' || worker_secret, 'content-type', 'application/json'),
    timeout_milliseconds := 5000
  );

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION app.sweep_jobs()
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION app.wake_worker()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM inserted_jobs WHERE producer_environment = 'production') THEN
    PERFORM app.request_worker();
  END IF;

  RETURN NULL;
END;
$function$;

CREATE TRIGGER jobs_wake_worker
  AFTER INSERT ON app.jobs REFERENCING NEW TABLE AS inserted_jobs
  FOR EACH STATEMENT
  EXECUTE FUNCTION app.wake_worker();

REVOKE ALL ON FUNCTION "app"."request_worker"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."request_worker"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."request_worker"() TO "postgres";

REVOKE ALL ON FUNCTION "app"."sweep_jobs"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."sweep_jobs"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."sweep_jobs"() TO "postgres";

REVOKE ALL ON FUNCTION "app"."wake_worker"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."wake_worker"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."wake_worker"() TO "postgres";
