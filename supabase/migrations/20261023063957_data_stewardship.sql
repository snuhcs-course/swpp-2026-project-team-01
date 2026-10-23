SET local check_function_bodies = off;

ALTER TABLE "app"."host_accounts"
  ADD COLUMN "deleted_at" timestamp WITH time zone;

CREATE OR REPLACE FUNCTION app.cleanup_retained_records (
  row_limit integer
)
  RETURNS TABLE (
    rule    text,
    deleted integer
  )
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  removed integer;
BEGIN
  IF row_limit IS NULL OR row_limit < 1 THEN
    RAISE EXCEPTION 'row limit must be positive' USING ERRCODE = '22023';
  END IF;

  rule := 'closed_requests';
  deleted := app.delete_request_records(array(
    SELECT r.id FROM app.requests r WHERE r.closed_at < now() - interval '90 days' ORDER BY r.closed_at LIMIT row_limit
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
$function$;

CREATE OR REPLACE FUNCTION app.delete_discussion_records (
  p_ids uuid[]
)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  removed integer;
BEGIN
  UPDATE app.model_reservations SET session_id = NULL
  WHERE session_id IN (SELECT s.session_id FROM app.agent_sessions s WHERE s.discussion_id = ANY (p_ids));

  DELETE FROM app.agent_session_events
  WHERE session_id IN (SELECT s.session_id FROM app.agent_sessions s WHERE s.discussion_id = ANY (p_ids));

  DELETE FROM app.conversation_inputs WHERE discussion_id = ANY (p_ids);
  DELETE FROM app.agent_sessions WHERE discussion_id = ANY (p_ids);
  DELETE FROM app.intakes WHERE discussion_id = ANY (p_ids);
  DELETE FROM app.discussions WHERE id = ANY (p_ids);
  GET DIAGNOSTICS removed = ROW_COUNT;

  RETURN removed;
END;
$function$;

CREATE OR REPLACE FUNCTION app.delete_request_records (
  p_ids uuid[]
)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  removed integer;
BEGIN
  PERFORM app.delete_discussion_records(array(
    SELECT d.id FROM app.discussions d
    WHERE d.request_id = ANY (p_ids)
       OR (d.principal_type = 'requester_request' AND d.principal_id = ANY (p_ids))
       OR d.id IN (SELECT i.discussion_id FROM app.intakes i WHERE i.request_id = ANY (p_ids))
  ));

  DELETE FROM app.command_outcomes WHERE actor = ANY (array(SELECT 'requester_request:' || id FROM unnest(p_ids) id));
  DELETE FROM app.requests WHERE id = ANY (p_ids);
  GET DIAGNOSTICS removed = ROW_COUNT;

  RETURN removed;
END;
$function$;

CREATE OR REPLACE FUNCTION app.operator_delete_host (
  target        text,
  operator_name text,
  reason        text,
  environment   text
)
  RETURNS TABLE (
    result_host_account_id uuid,
    result_previous_status text
  )
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  account_id uuid;
  old_status text;
  was_deleted timestamptz;
  auth_user uuid;
  reference record;
BEGIN
  IF target ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    account_id := target::uuid;
  ELSE
    SELECT h.host_account_id INTO account_id
    FROM app.host_handles h
    WHERE h.handle = lower(target) AND h.released_at IS NULL;
  END IF;

  SELECT a.status, a.deleted_at INTO old_status, was_deleted FROM app.host_accounts a WHERE a.id = account_id FOR UPDATE;

  IF old_status IS NULL THEN
    RAISE EXCEPTION 'unknown host' USING ERRCODE = 'P0002';
  END IF;

  IF was_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'host already deleted' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (SELECT 1 FROM app.bookings b WHERE b.host_account_id = account_id AND b.state = 'dispatching') THEN
    RAISE EXCEPTION 'booking in flight' USING ERRCODE = '55000';
  END IF;

  SELECT g.auth_user_id INTO auth_user FROM app.google_identities g WHERE g.host_account_id = account_id;

  PERFORM app.delete_request_records(array(SELECT r.id FROM app.requests r WHERE r.host_account_id = account_id));
  PERFORM app.delete_discussion_records(array(
    SELECT d.id FROM app.discussions d WHERE d.principal_type = 'host_account' AND d.principal_id = account_id
    UNION
    SELECT i.discussion_id FROM app.intakes i WHERE i.host_account_id = account_id
  ));
  DELETE FROM app.command_outcomes WHERE actor = 'host_account:' || account_id;

  FOR reference IN
    SELECT c.conrelid::regclass AS relation, a.attname AS column_name
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND c.confrelid = 'app.host_accounts'::regclass
      AND c.conrelid NOT IN ('app.host_handles'::regclass, 'app.handle_assignments'::regclass, 'app.operator_actions'::regclass)
    ORDER BY 1
  LOOP
    EXECUTE format('DELETE FROM %s WHERE %I = $1', reference.relation, reference.column_name) USING account_id;
  END LOOP;

  IF auth_user IS NOT NULL THEN
    DELETE FROM auth.users u WHERE u.id = auth_user;
  END IF;

  UPDATE app.host_accounts a
  SET status = 'suspended', display_name = NULL, deleted_at = now(), updated_at = now()
  WHERE a.id = account_id;

  INSERT INTO app.operator_operations (operator, action, target_id, previous_state, reason, environment)
  VALUES (operator_name, 'delete_host', account_id, old_status, reason, environment);

  RETURN QUERY SELECT account_id, old_status;
END;
$function$;

CREATE OR REPLACE FUNCTION app.operator_delete_request (
  p_request     uuid,
  operator_name text,
  reason        text,
  environment   text
)
  RETURNS TABLE (
    result_request_id     uuid,
    result_previous_state text
  )
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  found_state text;
BEGIN
  SELECT r.state INTO found_state FROM app.requests r WHERE r.id = p_request FOR UPDATE;

  IF found_state IS NULL THEN
    RAISE EXCEPTION 'unknown request' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (SELECT 1 FROM app.bookings b WHERE b.request_id = p_request AND b.state = 'dispatching') THEN
    RAISE EXCEPTION 'booking in flight' USING ERRCODE = '55000';
  END IF;

  PERFORM app.delete_request_records(array[p_request]);

  INSERT INTO app.operator_operations (operator, action, target_id, previous_state, reason, environment)
  VALUES (operator_name, 'delete_request', p_request, found_state, reason, environment);

  RETURN QUERY SELECT p_request, found_state;
END;
$function$;

CREATE OR REPLACE FUNCTION app.operator_set_host_status (
  target        text,
  new_status    text,
  operator_name text,
  reason        text,
  environment   text
)
  RETURNS TABLE (
    result_host_account_id uuid,
    result_status          text,
    result_previous_status text
  )
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;

ALTER TABLE "app"."host_accounts"
  ADD CONSTRAINT "host_accounts_deleted_suspended" CHECK (((deleted_at IS NULL) OR ((status = 'suspended'::text) AND (display_name IS NULL))));

REVOKE ALL ON FUNCTION "app"."cleanup_retained_records"(integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."cleanup_retained_records"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."cleanup_retained_records"(integer) TO "postgres";

REVOKE ALL ON FUNCTION "app"."delete_discussion_records"(uuid[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."delete_discussion_records"(uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."delete_discussion_records"(uuid[]) TO "postgres";

REVOKE ALL ON FUNCTION "app"."delete_request_records"(uuid[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."delete_request_records"(uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."delete_request_records"(uuid[]) TO "postgres";

REVOKE ALL ON FUNCTION "app"."operator_delete_host"(text, text, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."operator_delete_host"(text, text, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."operator_delete_host"(text, text, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "app"."operator_delete_request"(uuid, text, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."operator_delete_request"(uuid, text, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."operator_delete_request"(uuid, text, text, text) TO "postgres";

SELECT cron.schedule_in_database('app-retention', '17 * * * *', 'select app.cleanup_retained_records(1000)', 'postgres', NULL, true);
