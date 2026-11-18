SET local check_function_bodies = off;

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
  -- A guest's outbox rows go with their binding, which goes with the request.
  -- Deleting them first keeps the request's deletion from setting request_id
  -- null on a row whose binding the same statement already removed (#269).
  DELETE FROM app.imessage_outbox
  WHERE requester_binding_id IN (SELECT b.id FROM app.requester_imessage_bindings b WHERE b.request_id = ANY (p_ids));

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
