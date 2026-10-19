SET local check_function_bodies = off;

CREATE TABLE "app"."jobs" (
  "id"                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "kind"                 text                     NOT NULL,
  "payload"              jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "dedupe_key"           text,
  "producer_environment" text                     NOT NULL,
  "state"                text                     NOT NULL DEFAULT 'pending'::text,
  "attempts"             integer                  NOT NULL DEFAULT 0,
  "max_attempts"         integer                  NOT NULL DEFAULT 5,
  "run_after"            timestamp with time zone NOT NULL DEFAULT now(),
  "fence"                integer                  NOT NULL DEFAULT 0,
  "lease_owner"          text,
  "lease_expires_at"     timestamp with time zone,
  "failure_category"     text,
  "outcome"              jsonb,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at"         timestamp with time zone,
  CONSTRAINT "jobs_kind_dedupe_key_key" UNIQUE (kind, dedupe_key),
  CONSTRAINT "jobs_max_attempts_check" CHECK (((max_attempts >= 1) AND (max_attempts <= 100))),
  CONSTRAINT "jobs_pkey" PRIMARY KEY (id),
  CONSTRAINT "jobs_producer_environment_check"
    CHECK ((producer_environment = ANY (ARRAY['production'::text, 'preview'::text, 'development'::text, 'local'::text, 'unknown'::text]))),
  CONSTRAINT "jobs_running_lease" CHECK (((state = 'running'::text) = (lease_expires_at IS NOT NULL))),
  CONSTRAINT "jobs_state_check" CHECK ((state = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'exhausted'::text])))
);

ALTER TABLE "app"."jobs"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION app.claim_jobs (
  p_environment   text,
  p_kinds         text[],
  p_owner         text,
  p_limit         integer,
  p_lease_seconds integer
)
  RETURNS SETOF app.jobs
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE INDEX jobs_claimable_idx ON app.jobs USING btree (producer_environment, kind, run_after)
  WHERE (state = ANY (ARRAY['pending'::text, 'running'::text]));

REVOKE ALL ON FUNCTION "app"."claim_jobs"(text, text[], text, integer, integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."claim_jobs"(text, text[], text, integer, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."claim_jobs"(text, text[], text, integer, integer) TO "postgres";
