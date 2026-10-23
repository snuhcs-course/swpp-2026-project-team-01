SET local check_function_bodies = off;

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

  -- A turn reply still waiting on an input can no longer be sent; deleting it
  -- first keeps the outboxes' turn-input checks satisfied.
  DELETE FROM app.email_replies
  WHERE completed_at IS NULL
    AND input_id IN (SELECT i.id FROM app.conversation_inputs i WHERE i.discussion_id = ANY (p_ids));
  DELETE FROM app.imessage_outbox
  WHERE completed_at IS NULL
    AND input_id IN (SELECT i.id FROM app.conversation_inputs i WHERE i.discussion_id = ANY (p_ids));
  DELETE FROM app.conversation_inputs WHERE discussion_id = ANY (p_ids);
  DELETE FROM app.agent_sessions WHERE discussion_id = ANY (p_ids);
  DELETE FROM app.intakes WHERE discussion_id = ANY (p_ids);
  DELETE FROM app.discussions WHERE id = ANY (p_ids);
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

  -- The booking worker locks a request before it commits a dispatch, so locking
  -- every request of the host first makes the check below see any dispatch that
  -- was in progress.
  PERFORM 1 FROM app.requests r WHERE r.host_account_id = account_id ORDER BY r.id FOR UPDATE;

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

CREATE OR REPLACE FUNCTION app.operator_requeue_job (
  p_job          uuid,
  extra_attempts integer,
  operator_name  text,
  reason         text,
  environment    text
)
  RETURNS TABLE (
    result_job_id         uuid,
    result_kind           text,
    result_previous_state text,
    result_max_attempts   integer
  )
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  job app.jobs;
  found_state text;
  new_max integer;
BEGIN
  IF extra_attempts IS NULL OR extra_attempts NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'attempts must be between 1 and 10' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO job FROM app.jobs j WHERE j.id = p_job FOR UPDATE;

  IF job.id IS NULL THEN
    RAISE EXCEPTION 'unknown job' USING ERRCODE = 'P0002';
  END IF;

  IF job.state <> 'exhausted' THEN
    RAISE EXCEPTION 'job not exhausted' USING ERRCODE = '55000';
  END IF;

  -- A booking job is not requeued while another one for the same booking is
  -- live, as recover booking requires.
  IF job.kind = 'booking' AND EXISTS (
    SELECT 1 FROM app.jobs j
    WHERE j.kind = 'booking' AND j.id <> job.id AND j.payload ->> 'bookingId' = job.payload ->> 'bookingId'
      AND j.state IN ('pending', 'running')
  ) THEN
    RAISE EXCEPTION 'reconciliation already running' USING ERRCODE = '55000';
  END IF;

  new_max := least(job.attempts + extra_attempts, 100);

  IF new_max <= job.attempts THEN
    RAISE EXCEPTION 'job attempt limit reached' USING ERRCODE = '55000';
  END IF;

  found_state := left('exhausted:' || coalesce(job.failure_category, 'unknown'), 100);

  UPDATE app.jobs j
  SET state = 'pending', max_attempts = new_max, run_after = now(), failure_category = NULL, updated_at = now()
  WHERE j.id = job.id;

  INSERT INTO app.operator_operations (operator, action, target_id, previous_state, reason, environment)
  VALUES (operator_name, 'requeue_job', job.id, found_state, reason, environment);

  RETURN QUERY SELECT job.id, job.kind, found_state, new_max;
END;
$function$;
