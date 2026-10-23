-- The retention pass (data-stewardship: retention schedule; operations-and-
-- release design 8, D9), run every hour by pg_cron. Each rule deletes at most
-- row_limit rows per run, so a backlog drains over several runs instead of
-- holding locks (closed requests count per request, at most 100 per run, since
-- each cascades to many rows): closed requests with everything under them 90 days after
-- closure; completed jobs, command outcomes, link-resend records, admission
-- windows and agent protocol attempts after 30 days; exhausted jobs and model
-- reservations after 90 days; operator audit rows after a year. Returns the
-- number of rows deleted per rule.
CREATE FUNCTION "app"."cleanup_retained_records"("row_limit" integer)
RETURNS TABLE ("rule" text, "deleted" integer)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  removed integer;
BEGIN
  IF row_limit IS NULL OR row_limit < 1 THEN
    RAISE EXCEPTION 'row limit must be positive' USING ERRCODE = '22023';
  END IF;

  rule := 'closed_requests';
  deleted := app.delete_request_records(array(
    SELECT r.id FROM app.requests r
    WHERE r.closed_at < now() - interval '90 days'
      -- A booking whose write may exist keeps its record until reconciled.
      AND NOT EXISTS (SELECT 1 FROM app.bookings b WHERE b.request_id = r.id AND b.state = 'dispatching')
    ORDER BY r.closed_at
    LIMIT least(row_limit, 100)
  ));
  RETURN NEXT;

  DELETE FROM app.jobs WHERE id IN (
    SELECT j.id FROM app.jobs j
    WHERE j.state = 'completed' AND coalesce(j.completed_at, j.updated_at) < now() - interval '30 days' LIMIT row_limit
  );
  GET DIAGNOSTICS removed = ROW_COUNT;
  rule := 'completed_jobs'; deleted := removed; RETURN NEXT;

  DELETE FROM app.jobs WHERE id IN (
    SELECT j.id FROM app.jobs j WHERE j.state = 'exhausted' AND j.updated_at < now() - interval '90 days' LIMIT row_limit
  );
  GET DIAGNOSTICS removed = ROW_COUNT;
  rule := 'exhausted_jobs'; deleted := removed; RETURN NEXT;

  DELETE FROM app.command_outcomes WHERE ctid IN (
    SELECT c.ctid FROM app.command_outcomes c WHERE c.created_at < now() - interval '30 days' LIMIT row_limit
  );
  GET DIAGNOSTICS removed = ROW_COUNT;
  rule := 'command_outcomes'; deleted := removed; RETURN NEXT;

  DELETE FROM app.link_resend_attempts WHERE id IN (
    SELECT a.id FROM app.link_resend_attempts a WHERE a.created_at < now() - interval '30 days' LIMIT row_limit
  );
  GET DIAGNOSTICS removed = ROW_COUNT;
  rule := 'link_resend_attempts'; deleted := removed; RETURN NEXT;

  DELETE FROM app.link_resend_issuances WHERE id IN (
    SELECT i.id FROM app.link_resend_issuances i WHERE i.created_at < now() - interval '30 days' LIMIT row_limit
  );
  GET DIAGNOSTICS removed = ROW_COUNT;
  rule := 'link_resend_issuances'; deleted := removed; RETURN NEXT;

  DELETE FROM app.admission_windows WHERE ctid IN (
    SELECT w.ctid FROM app.admission_windows w WHERE w.window_start < now() - interval '30 days' LIMIT row_limit
  );
  GET DIAGNOSTICS removed = ROW_COUNT;
  rule := 'admission_windows'; deleted := removed; RETURN NEXT;

  DELETE FROM app.agent_protocol_attempts WHERE id IN (
    SELECT p.id FROM app.agent_protocol_attempts p WHERE p.created_at < now() - interval '30 days' LIMIT row_limit
  );
  GET DIAGNOSTICS removed = ROW_COUNT;
  rule := 'agent_protocol_attempts'; deleted := removed; RETURN NEXT;

  DELETE FROM app.model_reservations WHERE id IN (
    SELECT m.id FROM app.model_reservations m WHERE m.created_at < now() - interval '90 days' LIMIT row_limit
  );
  GET DIAGNOSTICS removed = ROW_COUNT;
  rule := 'model_reservations'; deleted := removed; RETURN NEXT;

  DELETE FROM app.operator_actions WHERE id IN (
    SELECT o.id FROM app.operator_actions o WHERE o.created_at < now() - interval '1 year' LIMIT row_limit
  );
  GET DIAGNOSTICS removed = ROW_COUNT;
  rule := 'operator_actions'; deleted := removed; RETURN NEXT;

  DELETE FROM app.operator_operations WHERE id IN (
    SELECT o.id FROM app.operator_operations o WHERE o.created_at < now() - interval '1 year' LIMIT row_limit
  );
  GET DIAGNOSTICS removed = ROW_COUNT;
  rule := 'operator_operations'; deleted := removed; RETURN NEXT;
END;
$$;
