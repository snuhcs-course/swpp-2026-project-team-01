-- Asks the job worker to run by posting to its URL with its shared secret, both
-- read from Vault. Without either entry (every sandbox and CI) it makes no request
-- and returns false. pg_net sends the request only if the calling transaction
-- commits.
CREATE FUNCTION "app"."request_worker"()
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
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
$$;
