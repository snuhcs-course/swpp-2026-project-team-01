-- Requeues an exhausted job (operational-recovery: exhausted job requeue;
-- operations-and-release design 6, D7): it becomes pending and due now with
-- extra_attempts (1 to 10) beyond those already used, and the audit row records
-- the failure category found, in one statement. The next claim raises the fence,
-- so a late result from an earlier claim records nothing.
CREATE FUNCTION "app"."operator_requeue_job"(
  "p_job" uuid,
  "extra_attempts" integer,
  "operator_name" text,
  "reason" text,
  "environment" text
)
RETURNS TABLE ("result_job_id" uuid, "result_kind" text, "result_previous_state" text, "result_max_attempts" integer)
LANGUAGE plpgsql
SET search_path = ''
AS $$
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
$$;

-- Starts the reconciliation of a booking whose write may exist
-- (operational-recovery: uncertain booking reconciliation): only for a
-- dispatching booking with no pending or running booking job, it publishes one
-- booking job marked with the environment whose worker claims it, and records
-- the audit row, in one statement. The job reads the event by its fixed ID
-- before any insert; nothing here changes the booking.
CREATE FUNCTION "app"."operator_reconcile_booking"(
  "p_booking" uuid,
  "producer" text,
  "operator_name" text,
  "reason" text,
  "environment" text
)
RETURNS TABLE ("result_booking_id" uuid, "result_job_id" uuid, "result_previous_state" text)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  booking_state text;
  audit_id uuid := gen_random_uuid();
  job_id uuid;
BEGIN
  IF producer IS NULL OR producer NOT IN ('production', 'local') THEN
    RAISE EXCEPTION 'unsupported producer environment' USING ERRCODE = '22023';
  END IF;

  SELECT b.state INTO booking_state FROM app.bookings b WHERE b.id = p_booking FOR UPDATE;

  IF booking_state IS NULL THEN
    RAISE EXCEPTION 'unknown booking' USING ERRCODE = 'P0002';
  END IF;

  IF booking_state <> 'dispatching' THEN
    RAISE EXCEPTION 'booking not dispatching' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM app.jobs j
    WHERE j.kind = 'booking' AND j.payload ->> 'bookingId' = p_booking::text AND j.state IN ('pending', 'running')
  ) THEN
    RAISE EXCEPTION 'reconciliation already running' USING ERRCODE = '55000';
  END IF;

  INSERT INTO app.jobs (kind, payload, dedupe_key, producer_environment, max_attempts)
  VALUES ('booking', jsonb_build_object('bookingId', p_booking), 'booking:' || p_booking || ':recover:' || audit_id, producer, 8)
  RETURNING id INTO job_id;

  INSERT INTO app.operator_operations (id, operator, action, target_id, previous_state, reason, environment)
  VALUES (audit_id, operator_name, 'reconcile_booking', p_booking, booking_state, reason, environment);

  RETURN QUERY SELECT p_booking, job_id, booking_state;
END;
$$;
