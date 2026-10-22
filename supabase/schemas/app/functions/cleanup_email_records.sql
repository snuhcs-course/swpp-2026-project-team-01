-- The email channel's retention (requester-email-channel design 9, D4), run
-- every 15 minutes by pg_cron: it voids expired pending link codes (clearing
-- their sealed copy), and deletes receipts and replies older than 30 days,
-- whatever their state, and the bindings and links of requests created more than
-- 30 days ago, at most row_limit rows of each per run. Returns the number of
-- rows deleted.
CREATE FUNCTION "app"."cleanup_email_records"("row_limit" integer)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  removed integer := 0;
  step integer;
BEGIN
  UPDATE app.email_links
  SET state = 'voided', ended_at = now(), code_ciphertext = NULL, code_key_id = NULL
  WHERE state = 'pending' AND expires_at <= now();

  DELETE FROM app.email_replies
  WHERE id IN (
    SELECT id FROM app.email_replies WHERE created_at < now() - interval '30 days' LIMIT row_limit
  );
  GET DIAGNOSTICS step = ROW_COUNT;
  removed := removed + step;

  DELETE FROM app.email_links
  WHERE id IN (
    SELECT l.id FROM app.email_links l JOIN app.requests r ON r.id = l.request_id
    WHERE r.created_at < now() - interval '30 days'
    LIMIT row_limit
  );
  GET DIAGNOSTICS step = ROW_COUNT;
  removed := removed + step;

  DELETE FROM app.email_threads
  WHERE id IN (
    SELECT t.id FROM app.email_threads t JOIN app.requests r ON r.id = t.request_id
    WHERE r.created_at < now() - interval '30 days'
    LIMIT row_limit
  );
  GET DIAGNOSTICS step = ROW_COUNT;
  removed := removed + step;

  DELETE FROM app.email_receipts
  WHERE id IN (
    SELECT id FROM app.email_receipts WHERE received_at < now() - interval '30 days' LIMIT row_limit
  );
  GET DIAGNOSTICS step = ROW_COUNT;
  removed := removed + step;

  RETURN removed;
END;
$$;
