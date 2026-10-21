SET local check_function_bodies = off;

ALTER TABLE "app"."agent_sessions"
  DROP CONSTRAINT "agent_sessions_principal_type_check";

ALTER TABLE "app"."discussions"
  DROP CONSTRAINT "discussions_audience_check";

ALTER TABLE "app"."discussions"
  DROP CONSTRAINT "discussions_principal_type_check";

ALTER TABLE "app"."model_reservations"
  DROP CONSTRAINT "model_reservations_principal_type_check";

CREATE TABLE "app"."admission_windows" (
  "scope"        text                     NOT NULL,
  "scope_key"    text                     NOT NULL,
  "window_kind"  text                     NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "count"        integer                  NOT NULL DEFAULT 0,
  CONSTRAINT "admission_windows_count_check" CHECK ((count >= 0)),
  CONSTRAINT "admission_windows_pkey" PRIMARY KEY (scope, scope_key, window_kind),
  CONSTRAINT "admission_windows_scope_check" CHECK ((scope = ANY (ARRAY['host'::text, 'request'::text, 'intake'::text, 'service'::text]))),
  CONSTRAINT "admission_windows_window_kind_check" CHECK ((window_kind = ANY (ARRAY['minute'::text, 'hour'::text])))
);

ALTER TABLE "app"."admission_windows"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."agreements" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "proposal_id"      uuid                     NOT NULL,
  "request_revision" integer                  NOT NULL,
  "retry_key"        text                     NOT NULL,
  "agreed_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "agreements_pkey" PRIMARY KEY (id),
  CONSTRAINT "agreements_proposal_id_key" UNIQUE (proposal_id),
  CONSTRAINT "agreements_request_revision_check" CHECK ((request_revision >= 1)),
  CONSTRAINT "agreements_retry_key_check" CHECK (((char_length(retry_key) >= 1) AND (char_length(retry_key) <= 200)))
);

ALTER TABLE "app"."agreements"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."booking_links" (
  "request_id"      uuid                     NOT NULL,
  "link_hash"       text                     NOT NULL,
  "link_ciphertext" text                     NOT NULL,
  "link_key_id"     text                     NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at"      timestamp with time zone NOT NULL DEFAULT (now() + '30 days'::interval),
  CONSTRAINT "booking_links_link_hash_key" UNIQUE (link_hash),
  CONSTRAINT "booking_links_pkey" PRIMARY KEY (request_id)
);

ALTER TABLE "app"."booking_links"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."contact_confirmations" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "request_id"    uuid                     NOT NULL,
  "contact_email" text                     NOT NULL,
  "token_hash"    text                     NOT NULL,
  "delivery_id"   uuid,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "consumed_at"   timestamp with time zone,
  "superseded_at" timestamp with time zone,
  CONSTRAINT "contact_confirmations_pkey" PRIMARY KEY (id),
  CONSTRAINT "contact_confirmations_token_hash_key" UNIQUE (token_hash)
);

ALTER TABLE "app"."contact_confirmations"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."email_deliveries" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "kind"                text                     NOT NULL,
  "request_id"          uuid,
  "dedupe_key"          text,
  "sender"              text                     NOT NULL,
  "recipients"          text[]                   NOT NULL,
  "template"            text                     NOT NULL,
  "language"            text                     NOT NULL,
  "parameters"          jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "secret_ciphertext"   text,
  "secret_key_id"       text,
  "dispatch_id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "state"               text                     NOT NULL DEFAULT 'queued'::text,
  "evidence"            jsonb,
  "provider_message_id" text,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "dispatched_at"       timestamp with time zone,
  "completed_at"        timestamp with time zone,
  CONSTRAINT "email_deliveries_dispatch_id_key" UNIQUE (dispatch_id),
  CONSTRAINT "email_deliveries_final_secret" CHECK (((completed_at IS NULL) OR (secret_ciphertext IS NULL))),
  CONSTRAINT "email_deliveries_final" CHECK (((state = ANY (ARRAY['accepted'::text, 'rejected'::text, 'uncertain'::text, 'suppressed'::text])) = (completed_at IS NOT NULL))),
  CONSTRAINT "email_deliveries_kind_check" CHECK ((kind = ANY (ARRAY['request_creation'::text, 'link_resend'::text]))),
  CONSTRAINT "email_deliveries_kind_dedupe_key_key" UNIQUE (kind, dedupe_key),
  CONSTRAINT "email_deliveries_language_check" CHECK ((language = ANY (ARRAY['en'::text, 'ko'::text]))),
  CONSTRAINT "email_deliveries_parameters_check" CHECK ((jsonb_typeof(parameters) = 'object'::text)),
  CONSTRAINT "email_deliveries_pkey" PRIMARY KEY (id),
  CONSTRAINT "email_deliveries_recipients_check" CHECK ((cardinality(recipients) >= 1)),
  CONSTRAINT "email_deliveries_sealed_secret" CHECK (((secret_ciphertext IS NULL) = (secret_key_id IS NULL))),
  CONSTRAINT "email_deliveries_state_check"
    CHECK ((state = ANY (ARRAY['queued'::text, 'dispatching'::text, 'accepted'::text, 'rejected'::text, 'uncertain'::text, 'suppressed'::text])))
);

ALTER TABLE "app"."email_deliveries"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."evaluations" (
  "id"                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "request_id"           uuid                     NOT NULL,
  "request_revision"     integer                  NOT NULL,
  "settings_revision"    integer                  NOT NULL,
  "state"                text                     NOT NULL DEFAULT 'pending'::text,
  "deadline_at"          timestamp with time zone,
  "candidates"           jsonb,
  "requester_projection" jsonb,
  "ranking"              jsonb,
  "failure_category"     text,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at"         timestamp with time zone,
  CONSTRAINT "evaluations_candidates_check" CHECK ((jsonb_typeof(candidates) = 'array'::text)),
  CONSTRAINT "evaluations_completed" CHECK (((state = 'pending'::text) = (completed_at IS NULL))),
  CONSTRAINT "evaluations_pkey" PRIMARY KEY (id),
  CONSTRAINT "evaluations_ranking_check" CHECK ((jsonb_typeof(ranking) = 'array'::text)),
  CONSTRAINT "evaluations_request_revision_check" CHECK ((request_revision >= 1)),
  CONSTRAINT "evaluations_requester_projection_check" CHECK ((jsonb_typeof(requester_projection) = 'object'::text)),
  CONSTRAINT "evaluations_settings_revision_check" CHECK ((settings_revision >= 1)),
  CONSTRAINT "evaluations_state_check" CHECK ((state = ANY (ARRAY['pending'::text, 'completed'::text, 'incomplete'::text, 'failed'::text])))
);

ALTER TABLE "app"."evaluations"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."intakes" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "host_account_id" uuid                     NOT NULL,
  "token_hash"      text                     NOT NULL,
  "source_hash"     text                     NOT NULL,
  "discussion_id"   uuid                     NOT NULL,
  "draft"           jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "request_id"      uuid,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at"      timestamp with time zone NOT NULL DEFAULT (now() + '24:00:00'::interval),
  "closed_at"       timestamp with time zone,
  CONSTRAINT "intakes_discussion_id_key" UNIQUE (discussion_id),
  CONSTRAINT "intakes_draft_check" CHECK ((jsonb_typeof(draft) = 'object'::text)),
  CONSTRAINT "intakes_pkey" PRIMARY KEY (id),
  CONSTRAINT "intakes_request_closes" CHECK (((request_id IS NULL) OR (closed_at IS NOT NULL))),
  CONSTRAINT "intakes_request_id_key" UNIQUE (request_id),
  CONSTRAINT "intakes_token_hash_key" UNIQUE (token_hash)
);

ALTER TABLE "app"."intakes"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."link_resend_attempts" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "address_hash"       text                     NOT NULL,
  "address_ciphertext" text                     NOT NULL,
  "address_key_id"     text                     NOT NULL,
  "retry_key"          text                     NOT NULL,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "link_resend_attempts_pkey" PRIMARY KEY (id),
  CONSTRAINT "link_resend_attempts_retry_key_check" CHECK (((char_length(retry_key) >= 1) AND (char_length(retry_key) <= 200))),
  CONSTRAINT "link_resend_attempts_retry_key" UNIQUE (address_hash, retry_key)
);

ALTER TABLE "app"."link_resend_attempts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."link_resend_issuances" (
  "id"             bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "request_id"     uuid,
  "recipient_hash" text                     NOT NULL,
  "retry_key"      text                     NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "link_resend_issuances_pkey" PRIMARY KEY (id),
  CONSTRAINT "link_resend_issuances_retry_key_check" CHECK (((char_length(retry_key) >= 1) AND (char_length(retry_key) <= 200)))
);

ALTER TABLE "app"."link_resend_issuances"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."proposals" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "request_id"    uuid                     NOT NULL,
  "version"       integer                  NOT NULL,
  "evaluation_id" uuid                     NOT NULL,
  "candidate_id"  text                     NOT NULL,
  "start_at"      timestamp with time zone NOT NULL,
  "end_at"        timestamp with time zone NOT NULL,
  "details"       jsonb                    NOT NULL,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "proposals_details_check" CHECK ((jsonb_typeof(details) = 'object'::text)),
  CONSTRAINT "proposals_interval" CHECK ((start_at < end_at)),
  CONSTRAINT "proposals_pkey" PRIMARY KEY (id),
  CONSTRAINT "proposals_request_version_key" UNIQUE (request_id, VERSION),
  CONSTRAINT "proposals_version_check" CHECK ((version >= 1))
);

ALTER TABLE "app"."proposals"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."request_creations" (
  "id"              bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "source_hash"     text                     NOT NULL,
  "host_account_id" uuid                     NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "request_creations_pkey" PRIMARY KEY (id)
);

ALTER TABLE "app"."request_creations"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."request_reviews" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "request_id"     uuid                     NOT NULL,
  "base_revision"  integer                  NOT NULL,
  "intent"         text                     NOT NULL,
  "patch"          jsonb,
  "clarifications" text[]                   NOT NULL DEFAULT '{}'::text[],
  "state"          text                     NOT NULL DEFAULT 'pending'::text,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at"    timestamp with time zone,
  CONSTRAINT "request_reviews_base_revision_check" CHECK ((base_revision >= 1)),
  CONSTRAINT "request_reviews_clarification_categories"
    CHECK
    ((clarifications <@ ARRAY['missing_date'::text, 'missing_time'::text, 'missing_timezone'::text, 'ambiguous_local_time'::text, 'missing_duration'::text, 'missing_mode'::text,
    'missing_location'::text, 'unclear_location'::text, 'missing_purpose'::text])),
  CONSTRAINT "request_reviews_intent_check" CHECK ((intent = ANY (ARRAY['details'::text, 'availability'::text, 'question'::text, 'unknown'::text]))),
  CONSTRAINT "request_reviews_intent_patch" CHECK ((((intent = ANY (ARRAY['details'::text, 'availability'::text])) AND (patch IS
    NOT NULL)) OR ((intent = ANY (ARRAY['question'::text, 'unknown'::text])) AND (patch IS NULL) AND (cardinality(clarifications) >= 1)))),
  CONSTRAINT "request_reviews_patch_check" CHECK ((jsonb_typeof(patch) = 'object'::text)),
  CONSTRAINT "request_reviews_pkey" PRIMARY KEY (id),
  CONSTRAINT "request_reviews_resolved" CHECK (((state = 'pending'::text) = (resolved_at IS NULL))),
  CONSTRAINT "request_reviews_state_check" CHECK ((state = ANY (ARRAY['pending'::text, 'applied'::text, 'superseded'::text, 'rejected'::text])))
);

ALTER TABLE "app"."request_reviews"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."requester_grants" (
  "id"                       uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "request_id"               uuid                     NOT NULL,
  "kind"                     text                     NOT NULL,
  "google_subject_hash"      text                     NOT NULL,
  "google_email"             text,
  "email_verified"           boolean                  NOT NULL DEFAULT false,
  "granted_scopes"           text[]                   NOT NULL DEFAULT '{}'::text[],
  "refresh_token_ciphertext" text,
  "refresh_token_key_id"     text,
  "calendar_ids"             text[]                   NOT NULL DEFAULT '{}'::text[],
  "created_at"               timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"               timestamp with time zone NOT NULL DEFAULT now(),
  "revoked_at"               timestamp with time zone,
  "provider_revocation"      text,
  CONSTRAINT "requester_grants_kind_check" CHECK ((kind = ANY (ARRAY['identity'::text, 'calendar'::text]))),
  CONSTRAINT "requester_grants_pkey" PRIMARY KEY (id),
  CONSTRAINT "requester_grants_provider_revocation_check" CHECK ((provider_revocation = ANY (ARRAY['not_needed'::text, 'revoked'::text, 'failed'::text]))),
  CONSTRAINT "requester_grants_revoked_token" CHECK (((revoked_at IS NULL) OR (refresh_token_ciphertext IS NULL))),
  CONSTRAINT "requester_grants_sealed_token" CHECK (((refresh_token_ciphertext IS NULL) = (refresh_token_key_id IS NULL))),
  CONSTRAINT "requester_grants_token_kind" CHECK (((kind = 'calendar'::text) OR (refresh_token_ciphertext IS NULL)))
);

ALTER TABLE "app"."requester_grants"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."requester_oauth_transactions" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "state_hash"          text                     NOT NULL,
  "binding_hash"        text                     NOT NULL,
  "verifier_ciphertext" text                     NOT NULL,
  "verifier_key_id"     text                     NOT NULL,
  "purpose"             text                     NOT NULL,
  "host_account_id"     uuid                     NOT NULL,
  "intake_id"           uuid,
  "request_id"          uuid,
  "draft"               jsonb,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at"          timestamp with time zone NOT NULL DEFAULT (now() + '00:10:00'::interval),
  "consumed_at"         timestamp with time zone,
  CONSTRAINT "requester_oauth_transactions_draft_check" CHECK ((jsonb_typeof(draft) = 'object'::text)),
  CONSTRAINT "requester_oauth_transactions_pkey" PRIMARY KEY (id),
  CONSTRAINT "requester_oauth_transactions_purpose_check" CHECK ((purpose = ANY (ARRAY['intake'::text, 'request'::text]))),
  CONSTRAINT "requester_oauth_transactions_purpose_target" CHECK ((((purpose = 'intake'::text) AND (intake_id IS
    NOT NULL) AND (request_id IS NULL)) OR ((purpose = 'request'::text) AND (request_id IS NOT NULL) AND (intake_id IS NULL)))),
  CONSTRAINT "requester_oauth_transactions_state_hash_key" UNIQUE (state_hash)
);

ALTER TABLE "app"."requester_oauth_transactions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."requests" (
  "id"                      uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "host_account_id"         uuid                     NOT NULL,
  "state"                   text                     NOT NULL DEFAULT 'gathering'::text,
  "revision"                integer                  NOT NULL DEFAULT 1,
  "details"                 jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "requester_name"          text                     NOT NULL,
  "contact_email"           text                     NOT NULL,
  "contact_confirmed_email" text,
  "created_at"              timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"              timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at"              timestamp with time zone NOT NULL,
  "closed_at"               timestamp with time zone,
  CONSTRAINT "requests_closed" CHECK (((state = ANY (ARRAY['booked'::text, 'declined'::text, 'withdrawn'::text, 'expired'::text])) = (closed_at IS NOT NULL))),
  CONSTRAINT "requests_confirmed_contact" CHECK (((contact_confirmed_email IS NULL) OR (contact_confirmed_email = contact_email))),
  CONSTRAINT "requests_contact_email_check" CHECK (((char_length(contact_email) >= 3) AND (char_length(contact_email) <= 320))),
  CONSTRAINT "requests_details_check" CHECK ((jsonb_typeof(details) = 'object'::text)),
  CONSTRAINT "requests_pkey" PRIMARY KEY (id),
  CONSTRAINT "requests_requester_name_check" CHECK (((char_length(requester_name) >= 1) AND (char_length(requester_name) <= 200))),
  CONSTRAINT "requests_revision_check" CHECK ((revision >= 1)),
  CONSTRAINT "requests_state_check"
    CHECK
    ((state = ANY (ARRAY['gathering'::text, 'negotiating'::text, 'awaiting_host_approval'::text, 'booking'::text, 'booked'::text, 'declined'::text, 'withdrawn'::text,
    'expired'::text])))
);

ALTER TABLE "app"."requests"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."resend_budget" (
  "slot"         smallint                 NOT NULL,
  "minute_start" timestamp with time zone NOT NULL,
  "count"        integer                  NOT NULL DEFAULT 0,
  CONSTRAINT "resend_budget_count_check" CHECK ((count >= 0)),
  CONSTRAINT "resend_budget_pkey" PRIMARY KEY (slot),
  CONSTRAINT "resend_budget_slot_check" CHECK ((slot = ANY (ARRAY[0, 1])))
);

ALTER TABLE "app"."resend_budget"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."route_estimates" (
  "origin_hash"          text                     NOT NULL,
  "destination_hash"     text                     NOT NULL,
  "mode"                 text                     NOT NULL,
  "departure_slot"       timestamp with time zone NOT NULL,
  "origin_place_id"      text,
  "destination_place_id" text,
  "outcome"              text                     NOT NULL,
  "duration_seconds"     integer,
  "distance_meters"      integer,
  "fetched_at"           timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "route_estimates_departure_slot_check" CHECK (((EXTRACT(epoch FROM departure_slot) % (900)::numeric) = (0)::numeric)),
  CONSTRAINT "route_estimates_distance_meters_check" CHECK ((distance_meters >= 0)),
  CONSTRAINT "route_estimates_duration_seconds_check" CHECK ((duration_seconds >= 0)),
  CONSTRAINT "route_estimates_mode_check" CHECK ((mode = ANY (ARRAY['driving'::text, 'transit'::text, 'walking'::text]))),
  CONSTRAINT "route_estimates_outcome_check" CHECK ((outcome = ANY (ARRAY['route'::text, 'no_route'::text, 'failed'::text]))),
  CONSTRAINT "route_estimates_pkey" PRIMARY KEY (origin_hash, destination_hash, mode, departure_slot),
  CONSTRAINT "route_estimates_route_duration" CHECK (((outcome = 'route'::text) = (duration_seconds IS NOT NULL)))
);

ALTER TABLE "app"."route_estimates"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."travel_allowances" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "request_id"       uuid                     NOT NULL,
  "party"            text                     NOT NULL,
  "candidate_start"  timestamp with time zone NOT NULL,
  "candidate_end"    timestamp with time zone NOT NULL,
  "direction"        text                     NOT NULL,
  "origin_hash"      text                     NOT NULL,
  "destination_hash" text                     NOT NULL,
  "mode"             text                     NOT NULL,
  "minutes"          integer                  NOT NULL,
  "confirmed_by"     text                     NOT NULL,
  "confirmed_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "invalidated_at"   timestamp with time zone,
  CONSTRAINT "travel_allowances_confirmed_by_check" CHECK ((confirmed_by = ANY (ARRAY['host'::text, 'requester'::text]))),
  CONSTRAINT "travel_allowances_direction_check" CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text]))),
  CONSTRAINT "travel_allowances_interval" CHECK ((candidate_start < candidate_end)),
  CONSTRAINT "travel_allowances_minutes_check" CHECK ((((minutes >= 5) AND (minutes <= 240)) AND ((minutes % 5) = 0))),
  CONSTRAINT "travel_allowances_mode_check" CHECK ((mode = ANY (ARRAY['driving'::text, 'transit'::text, 'walking'::text]))),
  CONSTRAINT "travel_allowances_party_check" CHECK ((party = ANY (ARRAY['host'::text, 'requester'::text]))),
  CONSTRAINT "travel_allowances_pkey" PRIMARY KEY (id)
);

ALTER TABLE "app"."travel_allowances"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "app"."conversation_inputs"
  ADD COLUMN "protected_fingerprint" text;

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

  WITH doomed AS (
    SELECT c.id FROM app.request_creations c
    WHERE c.created_at < now() - interval '24 hours'
    ORDER BY c.created_at
    LIMIT greatest(batch, 0)
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM app.request_creations c USING doomed WHERE c.id = doomed.id;

  RETURN removed;
END;
$function$;

CREATE OR REPLACE FUNCTION app.publish_request_expiry()
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  environment text;
  published uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.requests
    WHERE state IN ('gathering', 'negotiating', 'awaiting_host_approval') AND expires_at <= now()
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM app.jobs WHERE kind = 'request_expiry' AND state IN ('pending', 'running')) THEN
    RETURN false;
  END IF;

  environment := CASE
    WHEN EXISTS (
      SELECT 1 FROM vault.decrypted_secrets WHERE name = 'worker_url' AND coalesce(decrypted_secret, '') <> ''
    ) THEN 'production'
    ELSE 'local'
  END;

  INSERT INTO app.jobs (kind, dedupe_key, producer_environment)
  VALUES (
    'request_expiry',
    'slot:' || to_char(date_bin('5 minutes', now(), timestamptz '2000-01-01 00:00:00+00') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
    environment
  )
  ON CONFLICT (kind, dedupe_key) DO NOTHING
  RETURNING id INTO published;

  RETURN published IS NOT NULL;
END;
$function$;

ALTER TABLE "app"."agent_sessions"
  ADD CONSTRAINT "agent_sessions_principal_type_check" CHECK ((principal_type = ANY (ARRAY['host_account'::text, 'requester_request'::text, 'public_intake'::text])));

ALTER TABLE "app"."discussions"
  ADD CONSTRAINT "discussions_audience_check" CHECK ((audience = ANY (ARRAY['host_setup'::text, 'public_intake'::text, 'requester'::text])));

ALTER TABLE "app"."discussions"
  ADD CONSTRAINT "discussions_principal_type_check" CHECK ((principal_type = ANY (ARRAY['host_account'::text, 'requester_request'::text, 'public_intake'::text])));

ALTER TABLE "app"."contact_confirmations"
  ADD CONSTRAINT "contact_confirmations_delivery_id_fkey" FOREIGN KEY (delivery_id) REFERENCES app.email_deliveries(id);

ALTER TABLE "app"."intakes"
  ADD CONSTRAINT "intakes_discussion_id_fkey" FOREIGN KEY (discussion_id) REFERENCES app.discussions(id);

ALTER TABLE "app"."intakes"
  ADD CONSTRAINT "intakes_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."model_reservations"
  ADD CONSTRAINT "model_reservations_principal_type_check" CHECK ((principal_type = ANY (ARRAY['host_account'::text, 'requester_request'::text, 'public_intake'::text])));

ALTER TABLE "app"."proposals"
  ADD CONSTRAINT "proposals_evaluation_id_fkey" FOREIGN KEY (evaluation_id) REFERENCES app.evaluations(id);

ALTER TABLE "app"."agreements"
  ADD CONSTRAINT "agreements_proposal_id_fkey" FOREIGN KEY (proposal_id) REFERENCES app.proposals(id) ON DELETE CASCADE;

ALTER TABLE "app"."request_creations"
  ADD CONSTRAINT "request_creations_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."requester_oauth_transactions"
  ADD CONSTRAINT "requester_oauth_transactions_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."requester_oauth_transactions"
  ADD CONSTRAINT "requester_oauth_transactions_intake_id_fkey" FOREIGN KEY (intake_id) REFERENCES app.intakes(id) ON DELETE CASCADE;

ALTER TABLE "app"."requests"
  ADD CONSTRAINT "requests_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."booking_links"
  ADD CONSTRAINT "booking_links_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

ALTER TABLE "app"."contact_confirmations"
  ADD CONSTRAINT "contact_confirmations_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

ALTER TABLE "app"."email_deliveries"
  ADD CONSTRAINT "email_deliveries_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

ALTER TABLE "app"."evaluations"
  ADD CONSTRAINT "evaluations_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

ALTER TABLE "app"."intakes"
  ADD CONSTRAINT "intakes_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id);

ALTER TABLE "app"."link_resend_issuances"
  ADD CONSTRAINT "link_resend_issuances_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

ALTER TABLE "app"."proposals"
  ADD CONSTRAINT "proposals_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

ALTER TABLE "app"."request_reviews"
  ADD CONSTRAINT "request_reviews_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

ALTER TABLE "app"."requester_grants"
  ADD CONSTRAINT "requester_grants_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

ALTER TABLE "app"."requester_oauth_transactions"
  ADD CONSTRAINT "requester_oauth_transactions_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

ALTER TABLE "app"."travel_allowances"
  ADD CONSTRAINT "travel_allowances_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

CREATE INDEX contact_confirmations_delivery_idx ON app.contact_confirmations USING btree (delivery_id);

CREATE INDEX contact_confirmations_email_idx ON app.contact_confirmations USING btree (contact_email, created_at);

CREATE INDEX contact_confirmations_request_idx ON app.contact_confirmations USING btree (request_id, created_at);

CREATE INDEX email_deliveries_created_idx ON app.email_deliveries USING btree (kind, created_at);

CREATE INDEX email_deliveries_request_idx ON app.email_deliveries USING btree (request_id, kind, created_at);

CREATE INDEX evaluations_request_idx ON app.evaluations USING btree (request_id, created_at DESC);

CREATE INDEX intakes_host_idx ON app.intakes USING btree (host_account_id);

CREATE INDEX intakes_source_idx ON app.intakes USING btree (source_hash, created_at);

CREATE INDEX link_resend_attempts_created_idx ON app.link_resend_attempts USING btree (created_at);

CREATE INDEX link_resend_issuances_created_idx ON app.link_resend_issuances USING btree (created_at);

CREATE INDEX link_resend_issuances_recipient_idx ON app.link_resend_issuances USING btree (recipient_hash, created_at);

CREATE INDEX link_resend_issuances_request_idx ON app.link_resend_issuances USING btree (request_id, created_at);

CREATE INDEX proposals_evaluation_idx ON app.proposals USING btree (evaluation_id);

CREATE INDEX request_creations_created_idx ON app.request_creations USING btree (created_at);

CREATE INDEX request_creations_host_idx ON app.request_creations USING btree (host_account_id);

CREATE INDEX request_creations_source_idx ON app.request_creations USING btree (source_hash, created_at);

CREATE UNIQUE INDEX request_reviews_one_pending_idx ON app.request_reviews USING btree (request_id)
  WHERE (state = 'pending'::text);

CREATE INDEX request_reviews_request_idx ON app.request_reviews USING btree (request_id, created_at);

CREATE INDEX requester_grants_live_subject_idx ON app.requester_grants USING btree (google_subject_hash)
  WHERE (revoked_at IS NULL);

CREATE UNIQUE INDEX requester_grants_one_live_idx ON app.requester_grants USING btree (request_id, kind)
  WHERE (revoked_at IS NULL);

CREATE INDEX requester_oauth_transactions_host_idx ON app.requester_oauth_transactions USING btree (host_account_id);

CREATE INDEX requester_oauth_transactions_intake_idx ON app.requester_oauth_transactions USING btree (intake_id);

CREATE INDEX requester_oauth_transactions_request_idx ON app.requester_oauth_transactions USING btree (request_id);

CREATE INDEX requests_actionable_expiry_idx ON app.requests USING btree (expires_at)
  WHERE (state = ANY (ARRAY['gathering'::text, 'negotiating'::text, 'awaiting_host_approval'::text]));

CREATE INDEX requests_confirmed_contact_idx ON app.requests USING btree (contact_confirmed_email)
  WHERE ((closed_at IS NULL) AND (contact_confirmed_email IS NOT NULL));

CREATE INDEX requests_host_idx ON app.requests USING btree (host_account_id, created_at DESC);

CREATE INDEX route_estimates_fetched_idx ON app.route_estimates USING btree (fetched_at);

CREATE UNIQUE INDEX travel_allowances_one_live_idx ON app.travel_allowances
  USING btree (request_id, party, candidate_start, candidate_end, direction, origin_hash, destination_hash, mode)
  WHERE (invalidated_at IS NULL);

REVOKE ALL ON FUNCTION "app"."publish_request_expiry"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."publish_request_expiry"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."publish_request_expiry"() TO "postgres";
