-- Claims at most 25 due jobs of the given kinds produced by the given environment.
-- A job is due when it is pending and its run_after has passed, or when its
-- owner's lease expired. Each claim takes a new lease and a higher fence.
-- A job whose lease expired after its last allowed attempt becomes exhausted with
-- the category lease_expired: the expiry is recorded, not treated as proof that
-- the step's effect failed.
CREATE FUNCTION "app"."claim_jobs"(
  "p_environment" text,
  "p_kinds" text[],
  "p_owner" text,
  "p_limit" integer,
  "p_lease_seconds" integer
)
RETURNS SETOF "app"."jobs"
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_lease_seconds NOT BETWEEN 1 AND 900 THEN
    RAISE EXCEPTION 'lease must be between 1 and 900 seconds' USING ERRCODE = '22023';
  END IF;

  UPDATE app.jobs j
  SET state = 'exhausted', failure_category = 'lease_expired', lease_owner = NULL, lease_expires_at = NULL,
      updated_at = now()
  WHERE j.id IN (
    SELECT e.id FROM app.jobs e
    WHERE e.producer_environment = p_environment
      AND e.kind = ANY (p_kinds)
      AND e.state = 'running'
      AND e.lease_expires_at <= now()
      AND e.attempts >= e.max_attempts
    FOR UPDATE SKIP LOCKED
  );

  RETURN QUERY
  WITH due AS (
    SELECT d.id FROM app.jobs d
    WHERE d.producer_environment = p_environment
      AND d.kind = ANY (p_kinds)
      AND ((d.state = 'pending' AND d.run_after <= now()) OR (d.state = 'running' AND d.lease_expires_at <= now()))
    ORDER BY d.run_after, d.created_at
    LIMIT least(greatest(p_limit, 0), 25)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE app.jobs j
  SET state = 'running', attempts = j.attempts + 1, fence = j.fence + 1, lease_owner = p_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
  FROM due
  WHERE j.id = due.id
  RETURNING j.*;
END;
$$;
