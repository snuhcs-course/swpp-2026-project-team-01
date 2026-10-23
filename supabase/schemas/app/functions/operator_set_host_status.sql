-- The administrator CLI's only write: sets a host account's status and records the
-- audit row in one statement. The target is a host account ID or a current handle.
-- Setup is untouched, so restoration brings the saved setup back. Execution is
-- revoked from PUBLIC; no web route calls it.
CREATE FUNCTION "app"."operator_set_host_status"(
  "target" text,
  "new_status" text,
  "operator_name" text,
  "reason" text,
  "environment" text
)
RETURNS TABLE ("result_host_account_id" uuid, "result_status" text, "result_previous_status" text)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  account_id uuid;
  old_status text;
BEGIN
  IF new_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'unsupported status' USING ERRCODE = '22023';
  END IF;

  IF target ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    account_id := target::uuid;
  ELSE
    SELECT h.host_account_id INTO account_id
    FROM app.host_handles h
    WHERE h.handle = lower(target) AND h.released_at IS NULL;
  END IF;

  SELECT a.status INTO old_status FROM app.host_accounts a WHERE a.id = account_id FOR UPDATE;

  IF old_status IS NULL THEN
    RAISE EXCEPTION 'unknown host' USING ERRCODE = 'P0002';
  END IF;

  -- A host whose data was deleted on request is never restored or changed.
  IF EXISTS (SELECT 1 FROM app.host_accounts a WHERE a.id = account_id AND a.deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'deleted host' USING ERRCODE = '55000';
  END IF;

  UPDATE app.host_accounts a SET status = new_status, updated_at = now() WHERE a.id = account_id;

  INSERT INTO app.operator_actions (operator, action, host_account_id, previous_status, reason, environment)
  VALUES (
    operator_name, CASE new_status WHEN 'suspended' THEN 'suspend' ELSE 'restore' END,
    account_id, old_status, reason, environment
  );

  RETURN QUERY SELECT account_id, new_status, old_status;
END;
$$;
