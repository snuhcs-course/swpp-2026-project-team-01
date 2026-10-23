SET local check_function_bodies = off;

CREATE TABLE "app"."operator_operations" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "operator"       text                     NOT NULL,
  "action"         text                     NOT NULL,
  "target_id"      uuid                     NOT NULL,
  "previous_state" text                     NOT NULL,
  "reason"         text                     NOT NULL,
  "environment"    text                     NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "operator_operations_action_check" CHECK ((action = ANY (ARRAY['requeue_job'::text, 'reconcile_booking'::text, 'delete_host'::text, 'delete_request'::text]))),
  CONSTRAINT "operator_operations_environment_check" CHECK (((char_length(environment) >= 1) AND (char_length(environment) <= 100))),
  CONSTRAINT "operator_operations_operator_check" CHECK (((char_length(operator) >= 1) AND (char_length(operator) <= 100))),
  CONSTRAINT "operator_operations_pkey" PRIMARY KEY (id),
  CONSTRAINT "operator_operations_previous_state_check" CHECK (((char_length(previous_state) >= 1) AND (char_length(previous_state) <= 100))),
  CONSTRAINT "operator_operations_reason_check" CHECK (((char_length(reason) >= 1) AND (char_length(reason) <= 500)))
);

ALTER TABLE "app"."operator_operations"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION app.operator_reconcile_booking (
  p_booking     uuid,
  producer      text,
  operator_name text,
  reason        text,
  environment   text
)
  RETURNS TABLE (
    result_booking_id     uuid,
    result_job_id         uuid,
    result_previous_state text
  )
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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

CREATE INDEX operator_operations_target_idx ON app.operator_operations USING btree (target_id, created_at);

REVOKE ALL ON FUNCTION "app"."operator_reconcile_booking"(uuid, text, text, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."operator_reconcile_booking"(uuid, text, text, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."operator_reconcile_booking"(uuid, text, text, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "app"."operator_requeue_job"(uuid, integer, text, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."operator_requeue_job"(uuid, integer, text, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."operator_requeue_job"(uuid, integer, text, text, text) TO "postgres";
