-- Deletes discussions with their sessions, recorded events and inputs
-- (data-stewardship; operations-and-release design 8 and 9), in the order the
-- restrictive foreign keys need, as deleteDraft in lib/server/request-lifecycle.ts
-- does. Model spend stays recorded, detached from the deleted sessions, so it
-- still counts toward the allowances until its own retention ends. Returns the
-- number of discussions deleted.
CREATE FUNCTION "app"."delete_discussion_records"("p_ids" uuid[])
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
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
$$;

-- Deletes requests with everything under them: the host's review discussion,
-- the requester's discussion, the public-page intake that started it, and every
-- row that cascades from the request (intake, proposals, agreements, approvals,
-- bookings, booking link, deliveries, threads, bindings and grants). The host's
-- calendar events are not touched. Returns the number of requests deleted.
CREATE FUNCTION "app"."delete_request_records"("p_ids" uuid[])
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
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
$$;

-- Deletes one request on request (data-stewardship: deletion on request;
-- operations-and-release design 9, D10) and records the audit row with the state
-- found, in one statement. A booking whose write may exist is refused: its
-- outcome must be known first.
CREATE FUNCTION "app"."operator_delete_request"(
  "p_request" uuid,
  "operator_name" text,
  "reason" text,
  "environment" text
)
RETURNS TABLE ("result_request_id" uuid, "result_previous_state" text)
LANGUAGE plpgsql
SET search_path = ''
AS $$
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
$$;

-- Deletes a host's data on request (data-stewardship: deletion on request; D10):
-- every request, discussion and session, every row of every table that
-- references the account (found from the catalog, so a later table is included)
-- except its handle history and suspension audit, and its Auth user. The account
-- row stays, suspended, nameless and marked deleted, so a handle the host held
-- is never assigned to another host and restoration is refused. A booking whose
-- write may exist is refused: its outcome must be known first.
CREATE FUNCTION "app"."operator_delete_host"(
  "target" text,
  "operator_name" text,
  "reason" text,
  "environment" text
)
RETURNS TABLE ("result_host_account_id" uuid, "result_previous_status" text)
LANGUAGE plpgsql
SET search_path = ''
AS $$
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
$$;
