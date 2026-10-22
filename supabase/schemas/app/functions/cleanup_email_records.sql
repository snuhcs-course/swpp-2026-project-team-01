-- The email channel's retention (requester-email-channel design 9, D4), run
-- every 15 minutes by pg_cron: receipts older than 30 days, replies in a final
-- state older than 30 days, and the bindings and ended links of requests created
-- more than 30 days ago, at most row_limit rows of each per run. Returns the
-- number of rows deleted.
CREATE FUNCTION "app"."cleanup_email_records"("row_limit" integer)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  removed integer := 0;
  step integer;
BEGIN
  DELETE FROM app.email_replies
  WHERE id IN (
    SELECT id FROM app.email_replies
    WHERE completed_at IS NOT NULL AND created_at < now() - interval '30 days'
    LIMIT row_limit
  );
  GET DIAGNOSTICS step = ROW_COUNT;
  removed := removed + step;

  DELETE FROM app.email_links
  WHERE id IN (
    SELECT l.id FROM app.email_links l JOIN app.requests r ON r.id = l.request_id
    WHERE l.state <> 'pending' AND r.created_at < now() - interval '30 days'
    LIMIT row_limit
  );
  GET DIAGNOSTICS step = ROW_COUNT;
  removed := removed + step;

  DELETE FROM app.email_threads
  WHERE id IN (
    SELECT t.id FROM app.email_threads t JOIN app.requests r ON r.id = t.request_id
    WHERE r.created_at < now() - interval '30 days'
      AND NOT EXISTS (SELECT 1 FROM app.email_replies e WHERE e.binding_id = t.id AND e.completed_at IS NULL)
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
