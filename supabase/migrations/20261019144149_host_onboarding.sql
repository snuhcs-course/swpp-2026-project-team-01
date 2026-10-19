SET local check_function_bodies = off;

CREATE TABLE "app"."calendar_analyses" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "host_account_id"  uuid                     NOT NULL,
  "roles_revision"   integer                  NOT NULL,
  "state"            text                     NOT NULL DEFAULT 'pending'::text,
  "range_start"      timestamp with time zone NOT NULL,
  "range_end"        timestamp with time zone NOT NULL,
  "calendars"        jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "evidence"         jsonb,
  "failure_category" text,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at"     timestamp with time zone,
  CONSTRAINT "calendar_analyses_pkey" PRIMARY KEY (id),
  CONSTRAINT "calendar_analyses_range" CHECK ((range_start < range_end)),
  CONSTRAINT "calendar_analyses_state_check" CHECK ((state = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text])))
);

ALTER TABLE "app"."calendar_analyses"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."calendar_roles" (
  "host_account_id"         uuid                     NOT NULL,
  "revision"                integer                  NOT NULL DEFAULT 1,
  "conflict_calendars"      jsonb                    NOT NULL,
  "booking_calendar"        jsonb                    NOT NULL,
  "destination_verified_at" timestamp with time zone NOT NULL,
  "created_at"              timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"              timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "calendar_roles_booking_calendar_check" CHECK ((jsonb_typeof(booking_calendar) = 'object'::text)),
  CONSTRAINT "calendar_roles_conflict_calendars_check" CHECK ((jsonb_typeof(conflict_calendars) = 'array'::text)),
  CONSTRAINT "calendar_roles_pkey" PRIMARY KEY (host_account_id),
  CONSTRAINT "calendar_roles_revision_check" CHECK ((revision >= 1))
);

ALTER TABLE "app"."calendar_roles"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."handle_assignments" (
  "id"              bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "host_account_id" uuid                     NOT NULL,
  "handle"          text                     NOT NULL,
  "assigned_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "handle_assignments_pkey" PRIMARY KEY (id)
);

ALTER TABLE "app"."handle_assignments"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."host_handles" (
  "handle"          text                     NOT NULL,
  "host_account_id" uuid                     NOT NULL,
  "assigned_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "released_at"     timestamp with time zone,
  CONSTRAINT "host_handles_handle_check" CHECK ((((char_length(handle) >= 3) AND (char_length(handle) <= 30)) AND (handle ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'::text))),
  CONSTRAINT "host_handles_pkey" PRIMARY KEY (handle)
);

ALTER TABLE "app"."host_handles"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."host_settings" (
  "host_account_id" uuid                     NOT NULL,
  "revision"        integer                  NOT NULL DEFAULT 1,
  "settings"        jsonb                    NOT NULL,
  "draft_revision"  integer                  NOT NULL,
  "confirmed_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "host_settings_pkey" PRIMARY KEY (host_account_id),
  CONSTRAINT "host_settings_revision_check" CHECK ((revision >= 1)),
  CONSTRAINT "host_settings_settings_check" CHECK ((jsonb_typeof(settings) = 'object'::text))
);

ALTER TABLE "app"."host_settings"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."operator_actions" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "operator"        text                     NOT NULL,
  "action"          text                     NOT NULL,
  "host_account_id" uuid                     NOT NULL,
  "previous_status" text                     NOT NULL,
  "reason"          text                     NOT NULL,
  "environment"     text                     NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "operator_actions_action_check" CHECK ((action = ANY (ARRAY['suspend'::text, 'restore'::text]))),
  CONSTRAINT "operator_actions_environment_check" CHECK (((char_length(environment) >= 1) AND (char_length(environment) <= 100))),
  CONSTRAINT "operator_actions_operator_check" CHECK (((char_length(operator) >= 1) AND (char_length(operator) <= 100))),
  CONSTRAINT "operator_actions_pkey" PRIMARY KEY (id),
  CONSTRAINT "operator_actions_reason_check" CHECK (((char_length(reason) >= 1) AND (char_length(reason) <= 500)))
);

ALTER TABLE "app"."operator_actions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."setup_drafts" (
  "host_account_id"  uuid                     NOT NULL,
  "revision"         integer                  NOT NULL DEFAULT 1,
  "fields"           jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "analysis_skipped" boolean                  NOT NULL DEFAULT false,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "setup_drafts_pkey" PRIMARY KEY (host_account_id),
  CONSTRAINT "setup_drafts_revision_check" CHECK ((revision >= 1))
);

ALTER TABLE "app"."setup_drafts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."signup_attempts" (
  "id"          bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "source_hash" text                     NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "signup_attempts_pkey" PRIMARY KEY (id)
);

ALTER TABLE "app"."signup_attempts"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "app"."host_accounts"
  ADD COLUMN "display_name" text;

ALTER TABLE "app"."provider_grants"
  ADD COLUMN "invalidated_at" timestamp WITH time zone;

CREATE OR REPLACE FUNCTION app.cleanup_calendar_analyses (
  batch integer DEFAULT 500
)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  removed integer;
BEGIN
  WITH doomed AS (
    SELECT a.id FROM app.calendar_analyses a
    WHERE a.created_at < now() - interval '24 hours'
    ORDER BY a.created_at
    LIMIT greatest(batch, 0)
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM app.calendar_analyses a USING doomed WHERE a.id = doomed.id;
  GET DIAGNOSTICS removed = ROW_COUNT;

  WITH doomed AS (
    SELECT s.id FROM app.signup_attempts s
    WHERE s.created_at < now() - interval '24 hours'
    ORDER BY s.created_at
    LIMIT greatest(batch, 0)
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM app.signup_attempts s USING doomed WHERE s.id = doomed.id;

  RETURN removed;
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

  UPDATE app.host_accounts a SET status = new_status, updated_at = now() WHERE a.id = account_id;

  INSERT INTO app.operator_actions (operator, action, host_account_id, previous_status, reason, environment)
  VALUES (
    operator_name, CASE new_status WHEN 'suspended' THEN 'suspend' ELSE 'restore' END,
    account_id, old_status, reason, environment
  );

  RETURN QUERY SELECT account_id, new_status, old_status;
END;
$function$;

ALTER TABLE "app"."calendar_analyses"
  ADD CONSTRAINT "calendar_analyses_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."calendar_roles"
  ADD CONSTRAINT "calendar_roles_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."handle_assignments"
  ADD CONSTRAINT "handle_assignments_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."host_accounts"
  ADD CONSTRAINT "host_accounts_display_name_check" CHECK ((char_length(display_name) <= 200));

ALTER TABLE "app"."host_handles"
  ADD CONSTRAINT "host_handles_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."handle_assignments"
  ADD CONSTRAINT "handle_assignments_handle_fkey" FOREIGN KEY (handle) REFERENCES app.host_handles(handle);

ALTER TABLE "app"."host_settings"
  ADD CONSTRAINT "host_settings_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."operator_actions"
  ADD CONSTRAINT "operator_actions_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."setup_drafts"
  ADD CONSTRAINT "setup_drafts_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

CREATE INDEX calendar_analyses_created_idx ON app.calendar_analyses USING btree (created_at);

CREATE INDEX calendar_analyses_host_idx ON app.calendar_analyses USING btree (host_account_id, created_at DESC);

CREATE INDEX handle_assignments_host_idx ON app.handle_assignments USING btree (host_account_id, assigned_at);

CREATE UNIQUE INDEX host_handles_one_current_idx ON app.host_handles USING btree (host_account_id)
  WHERE (released_at IS NULL);

CREATE INDEX operator_actions_host_idx ON app.operator_actions USING btree (host_account_id, created_at);

CREATE INDEX signup_attempts_created_idx ON app.signup_attempts USING btree (created_at);

CREATE INDEX signup_attempts_source_idx ON app.signup_attempts USING btree (source_hash, created_at);

REVOKE ALL ON FUNCTION "app"."cleanup_calendar_analyses"(integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."cleanup_calendar_analyses"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."cleanup_calendar_analyses"(integer) TO "postgres";

REVOKE ALL ON FUNCTION "app"."operator_set_host_status"(text, text, text, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."operator_set_host_status"(text, text, text, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."operator_set_host_status"(text, text, text, text, text) TO "postgres";
