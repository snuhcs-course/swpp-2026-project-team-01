SET local check_function_bodies = off;

DROP INDEX "public"."events_user_start";

CREATE TABLE "public"."analysis_evidence" (
  "id"                    text    NOT NULL,
  "analysis_id"           text    NOT NULL,
  "imported_event_id"     text,
  "aggregation_rule_json" text    NOT NULL,
  "observation_count"     integer NOT NULL,
  "from_at"               bigint  NOT NULL,
  "to_at"                 bigint  NOT NULL,
  CONSTRAINT "analysis_evidence_check" CHECK ((to_at > from_at)),
  CONSTRAINT "analysis_evidence_observation_count_check" CHECK ((observation_count >= 0)),
  CONSTRAINT "analysis_evidence_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."analysis_evidence"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."analysis_evidence" FROM "anon", "authenticated";

CREATE TABLE "public"."analysis_runs" (
  "id"                  text    NOT NULL,
  "user_id"             text    NOT NULL,
  "snapshot_id"         text    NOT NULL,
  "annotation_revision" integer NOT NULL,
  "from_at"             bigint  NOT NULL,
  "to_at"               bigint  NOT NULL,
  "status"              text    NOT NULL,
  "coverage_json"       text    NOT NULL,
  "summary_json"        text    NOT NULL,
  "revision"            integer NOT NULL DEFAULT 0,
  CONSTRAINT "analysis_runs_check" CHECK ((to_at > from_at)),
  CONSTRAINT "analysis_runs_pkey" PRIMARY KEY (id),
  CONSTRAINT "analysis_runs_revision_check" CHECK ((revision >= 0))
);

ALTER TABLE "public"."analysis_runs"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."analysis_runs" FROM "anon", "authenticated";

CREATE TABLE "public"."auth_identities" (
  "id"       text NOT NULL,
  "user_id"  text NOT NULL,
  "provider" text NOT NULL,
  "subject"  text NOT NULL,
  CONSTRAINT "auth_identities_pkey" PRIMARY KEY (id),
  CONSTRAINT "auth_identities_provider_subject_key" UNIQUE (PROVIDER, subject)
);

ALTER TABLE "public"."auth_identities"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."auth_identities" FROM "anon", "authenticated";

CREATE TABLE "public"."booking_searches" (
  "id"                         text    NOT NULL,
  "seq"                        bigint  GENERATED ALWAYS AS IDENTITY NOT NULL,
  "client_id"                  text    NOT NULL,
  "host_id"                    text    NOT NULL,
  "revision"                   integer NOT NULL DEFAULT 0,
  "inherited_profile_version"  integer,
  "inherited_preferences_json" text    NOT NULL DEFAULT '{"weekdays":null,"startTime":null,"meetingMode":null,"slack":null}'::text,
  "overrides_json"             text    NOT NULL DEFAULT '{}'::text,
  "initial_reply_state"        text    NOT NULL DEFAULT 'not_ready'::text,
  "last_result_json"           text,
  "data_basis_json"            text,
  CONSTRAINT "booking_searches_pkey" PRIMARY KEY (id),
  CONSTRAINT "booking_searches_revision_check" CHECK ((revision >= 0))
);

ALTER TABLE "public"."booking_searches"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."booking_searches" FROM "anon", "authenticated";

CREATE TABLE "public"."calendar_connections" (
  "id"                       text    NOT NULL,
  "user_id"                  text    NOT NULL,
  "subject"                  text    NOT NULL,
  "status"                   text    NOT NULL,
  "refresh_token_ciphertext" text,
  "key_version"              integer,
  "granted_scopes_json"      text    NOT NULL DEFAULT '[]'::text,
  "revision"                 integer NOT NULL DEFAULT 0,
  "selection_revision"       integer NOT NULL DEFAULT 0,
  "generation"               integer NOT NULL DEFAULT 0,
  "analysis_snapshot_id"     text,
  "schedule_snapshot_id"     text,
  CONSTRAINT "calendar_connections_pkey" PRIMARY KEY (id),
  CONSTRAINT "calendar_connections_revision_check" CHECK ((revision >= 0)),
  CONSTRAINT "calendar_connections_user_id_key" UNIQUE (user_id)
);

ALTER TABLE "public"."calendar_connections"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."calendar_connections" FROM "anon", "authenticated";

CREATE TABLE "public"."calendar_snapshots" (
  "id"                 text    NOT NULL,
  "connection_id"      text    NOT NULL,
  "sync_run_id"        text    NOT NULL,
  "generation"         integer NOT NULL,
  "scope"              text    NOT NULL,
  "from_at"            bigint  NOT NULL,
  "to_at"              bigint  NOT NULL,
  "selection_revision" integer NOT NULL,
  "started_at"         bigint  NOT NULL,
  "completed_at"       bigint  NOT NULL,
  CONSTRAINT "calendar_snapshots_check1" CHECK ((completed_at >= started_at)),
  CONSTRAINT "calendar_snapshots_check" CHECK ((to_at > from_at)),
  CONSTRAINT "calendar_snapshots_pkey" PRIMARY KEY (id),
  CONSTRAINT "calendar_snapshots_scope_check" CHECK ((scope = ANY (ARRAY['full'::text, 'schedule'::text]))),
  CONSTRAINT "calendar_snapshots_sync_run_id_key" UNIQUE (sync_run_id)
);

ALTER TABLE "public"."calendar_snapshots"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."calendar_snapshots" FROM "anon", "authenticated";

CREATE TABLE "public"."calendar_sources" (
  "id"                   text    NOT NULL,
  "connection_id"        text    NOT NULL,
  "provider_calendar_id" text    NOT NULL,
  "name"                 text    NOT NULL,
  "timezone"             text,
  "access_role"          text    NOT NULL,
  "selected"             integer NOT NULL DEFAULT 0,
  "revision"             integer NOT NULL DEFAULT 0,
  CONSTRAINT "calendar_sources_connection_id_provider_calendar_id_key" UNIQUE (connection_id, provider_calendar_id),
  CONSTRAINT "calendar_sources_pkey" PRIMARY KEY (id),
  CONSTRAINT "calendar_sources_revision_check" CHECK ((revision >= 0)),
  CONSTRAINT "calendar_sources_selected_check" CHECK ((selected = ANY (ARRAY[0, 1])))
);

ALTER TABLE "public"."calendar_sources"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."calendar_sources" FROM "anon", "authenticated";

CREATE TABLE "public"."calendar_sync_runs" (
  "id"                 text    NOT NULL,
  "connection_id"      text    NOT NULL,
  "operation_id"       text    NOT NULL,
  "selection_revision" integer NOT NULL,
  "base_generation"    integer NOT NULL,
  "scope"              text    NOT NULL,
  "from_at"            bigint  NOT NULL,
  "to_at"              bigint  NOT NULL,
  "started_at"         bigint  NOT NULL,
  "lease_until"        bigint  NOT NULL,
  "fence"              integer NOT NULL,
  "status"             text    NOT NULL,
  "error_json"         text,
  "revision"           integer NOT NULL DEFAULT 0,
  CONSTRAINT "calendar_sync_runs_check" CHECK ((to_at > from_at)),
  CONSTRAINT "calendar_sync_runs_pkey" PRIMARY KEY (id),
  CONSTRAINT "calendar_sync_runs_revision_check" CHECK ((revision >= 0)),
  CONSTRAINT "calendar_sync_runs_scope_check" CHECK ((scope = ANY (ARRAY['full'::text, 'schedule'::text])))
);

ALTER TABLE "public"."calendar_sync_runs"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."calendar_sync_runs" FROM "anon", "authenticated";

CREATE TABLE "public"."draft_messages" (
  "id"            text   NOT NULL,
  "draft_id"      text   NOT NULL,
  "operation_id"  text   NOT NULL,
  "role"          text   NOT NULL,
  "content"       text   NOT NULL,
  "proposal_json" text,
  "evidence_id"   text,
  "created_at"    bigint NOT NULL,
  CONSTRAINT "draft_messages_operation_id_role_key" UNIQUE (operation_id, ROLE),
  CONSTRAINT "draft_messages_pkey" PRIMARY KEY (id),
  CONSTRAINT "draft_messages_role_check" CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);

ALTER TABLE "public"."draft_messages"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."draft_messages" FROM "anon", "authenticated";

CREATE TABLE "public"."event_annotations" (
  "id"                      text    NOT NULL,
  "connection_id"           text    NOT NULL,
  "calendar_id"             text    NOT NULL,
  "provider_event_id"       text    NOT NULL,
  "revision"                integer NOT NULL DEFAULT 0,
  "field_fingerprints_json" text    NOT NULL,
  "values_json"             text    NOT NULL,
  "confirmations_json"      text    NOT NULL,
  CONSTRAINT "event_annotations_connection_id_calendar_id_provider_event__key" UNIQUE (connection_id, calendar_id, provider_event_id),
  CONSTRAINT "event_annotations_pkey" PRIMARY KEY (id),
  CONSTRAINT "event_annotations_revision_check" CHECK ((revision >= 0))
);

ALTER TABLE "public"."event_annotations"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."event_annotations" FROM "anon", "authenticated";

CREATE TABLE "public"."event_classifications" (
  "id"                  text    NOT NULL,
  "seq"                 bigint  GENERATED ALWAYS AS IDENTITY NOT NULL,
  "user_id"             text    NOT NULL,
  "connection_id"       text    NOT NULL,
  "calendar_id"         text    NOT NULL,
  "provider_event_id"   text    NOT NULL,
  "content_fingerprint" text    NOT NULL,
  "model_version"       text    NOT NULL,
  "schema_version"      integer NOT NULL,
  "proposal_json"       text    NOT NULL,
  CONSTRAINT "event_classifications_pkey" PRIMARY KEY (id),
  CONSTRAINT "event_classifications_user_id_connection_id_calendar_id_pro_key" UNIQUE
    (user_id, connection_id, calendar_id, provider_event_id, content_fingerprint, model_version, schema_version)
);

ALTER TABLE "public"."event_classifications"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."event_classifications" FROM "anon", "authenticated";

CREATE TABLE "public"."imported_busy_intervals" (
  "id"          text   NOT NULL,
  "snapshot_id" text   NOT NULL,
  "calendar_id" text   NOT NULL,
  "start_at"    bigint NOT NULL,
  "end_at"      bigint NOT NULL,
  CONSTRAINT "imported_busy_intervals_check" CHECK ((end_at > start_at)),
  CONSTRAINT "imported_busy_intervals_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."imported_busy_intervals"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."imported_busy_intervals" FROM "anon", "authenticated";

CREATE TABLE "public"."imported_events" (
  "id"                      text    NOT NULL,
  "snapshot_id"             text    NOT NULL,
  "calendar_id"             text    NOT NULL,
  "provider_event_id"       text    NOT NULL,
  "recurring_event_id"      text,
  "original_start_time"     text,
  "ical_uid"                text,
  "title"                   text,
  "description"             text,
  "location"                text,
  "status"                  text,
  "transparency"            text,
  "start_at"                bigint  NOT NULL,
  "end_at"                  bigint  NOT NULL,
  "all_day"                 integer NOT NULL DEFAULT 0,
  "start_date"              text,
  "end_date"                text,
  "timezone"                text,
  "busy"                    integer NOT NULL DEFAULT 1,
  "location_kind"           text,
  "place_ref"               text,
  "content_fingerprint"     text    NOT NULL,
  "field_fingerprints_json" text    NOT NULL DEFAULT '{}'::text,
  CONSTRAINT "imported_events_all_day_check" CHECK ((all_day = ANY (ARRAY[0, 1]))),
  CONSTRAINT "imported_events_busy_check" CHECK ((busy = ANY (ARRAY[0, 1]))),
  CONSTRAINT "imported_events_check" CHECK ((end_at > start_at)),
  CONSTRAINT "imported_events_pkey" PRIMARY KEY (id),
  CONSTRAINT "imported_events_snapshot_id_calendar_id_provider_event_id_key" UNIQUE (snapshot_id, calendar_id, provider_event_id)
);

ALTER TABLE "public"."imported_events"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."imported_events" FROM "anon", "authenticated";

CREATE TABLE "public"."mutation_operations" (
  "id"                   text    NOT NULL,
  "owner_id"             text    NOT NULL,
  "kind"                 text    NOT NULL,
  "key"                  text    NOT NULL,
  "payload_hash"         text    NOT NULL,
  "state"                text    NOT NULL,
  "phase"                text,
  "reserved_resource_id" text,
  "attempt"              integer NOT NULL DEFAULT 1,
  "fence"                integer NOT NULL DEFAULT 1,
  "lease_until"          bigint  NOT NULL,
  "result_json"          text,
  "error_json"           text,
  "revision"             integer NOT NULL DEFAULT 0,
  "created_at"           bigint  NOT NULL,
  "updated_at"           bigint  NOT NULL,
  CONSTRAINT "mutation_operations_attempt_check" CHECK ((attempt > 0)),
  CONSTRAINT "mutation_operations_fence_check" CHECK ((fence > 0)),
  CONSTRAINT "mutation_operations_owner_id_kind_key_key" UNIQUE (owner_id, kind, key),
  CONSTRAINT "mutation_operations_pkey" PRIMARY KEY (id),
  CONSTRAINT "mutation_operations_revision_check" CHECK ((revision >= 0)),
  CONSTRAINT "mutation_operations_state_check" CHECK ((state = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed_retryable'::text, 'failed_final'::text])))
);

ALTER TABLE "public"."mutation_operations"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."mutation_operations" FROM "anon", "authenticated";

CREATE TABLE "public"."oauth_attempts" (
  "id"                   text    NOT NULL,
  "state_hash"           text    NOT NULL,
  "nonce_hash"           text    NOT NULL,
  "browser_binding_hash" text    NOT NULL,
  "purpose"              text    NOT NULL,
  "user_id"              text,
  "return_path"          text    NOT NULL,
  "expires_at"           bigint  NOT NULL,
  "consumed_at"          bigint,
  "revision"             integer NOT NULL DEFAULT 0,
  CONSTRAINT "oauth_attempts_pkey" PRIMARY KEY (id),
  CONSTRAINT "oauth_attempts_purpose_check" CHECK ((purpose = ANY (ARRAY['login'::text, 'calendar'::text]))),
  CONSTRAINT "oauth_attempts_revision_check" CHECK ((revision >= 0)),
  CONSTRAINT "oauth_attempts_state_hash_key" UNIQUE (state_hash)
);

ALTER TABLE "public"."oauth_attempts"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."oauth_attempts" FROM "anon", "authenticated";

CREATE TABLE "public"."profile_drafts" (
  "id"                       text    NOT NULL,
  "user_id"                  text    NOT NULL,
  "status"                   text    NOT NULL DEFAULT 'active'::text,
  "revision"                 integer NOT NULL DEFAULT 0,
  "base_profile_version"     integer,
  "values_json"              text    NOT NULL,
  "topic_confirmations_json" text    NOT NULL,
  "analysis_id"              text,
  "updated_at"               bigint  NOT NULL,
  CONSTRAINT "profile_drafts_pkey" PRIMARY KEY (id),
  CONSTRAINT "profile_drafts_revision_check" CHECK ((revision >= 0))
);

ALTER TABLE "public"."profile_drafts"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."profile_drafts" FROM "anon", "authenticated";

CREATE TABLE "public"."profile_versions" (
  "user_id"      text    NOT NULL,
  "version"      integer NOT NULL,
  "values_json"  text    NOT NULL,
  "origin"       text    NOT NULL,
  "confirmed_at" bigint,
  CONSTRAINT "profile_versions_pkey" PRIMARY KEY (user_id, VERSION),
  CONSTRAINT "profile_versions_version_check" CHECK ((version > 0))
);

ALTER TABLE "public"."profile_versions"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."profile_versions" FROM "anon", "authenticated";

CREATE TABLE "public"."search_messages" (
  "id"               text NOT NULL,
  "search_id"        text NOT NULL,
  "operation_id"     text,
  "role"             text NOT NULL,
  "content"          text NOT NULL,
  "options_json"     text,
  "explanation_json" text,
  "created_at"       text NOT NULL,
  CONSTRAINT "search_messages_operation_id_role_key" UNIQUE (operation_id, ROLE),
  CONSTRAINT "search_messages_pkey" PRIMARY KEY (id),
  CONSTRAINT "search_messages_role_check" CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);

ALTER TABLE "public"."search_messages"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."search_messages" FROM "anon", "authenticated";

CREATE TABLE "public"."service_leases" (
  "resource_key"       text    NOT NULL,
  "owner_operation_id" text    NOT NULL,
  "fence"              integer NOT NULL,
  "lease_until"        bigint  NOT NULL,
  "revision"           integer NOT NULL DEFAULT 0,
  CONSTRAINT "service_leases_fence_check" CHECK ((fence > 0)),
  CONSTRAINT "service_leases_pkey" PRIMARY KEY (resource_key),
  CONSTRAINT "service_leases_revision_check" CHECK ((revision >= 0))
);

ALTER TABLE "public"."service_leases"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."service_leases" FROM "anon", "authenticated";

CREATE TABLE "public"."sessions" (
  "id"         text    NOT NULL,
  "token_hash" text    NOT NULL,
  "user_id"    text    NOT NULL,
  "expires_at" bigint  NOT NULL,
  "revoked_at" bigint,
  "revision"   integer NOT NULL DEFAULT 0,
  CONSTRAINT "sessions_pkey" PRIMARY KEY (id),
  CONSTRAINT "sessions_revision_check" CHECK ((revision >= 0)),
  CONSTRAINT "sessions_token_hash_key" UNIQUE (token_hash)
);

ALTER TABLE "public"."sessions"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."sessions" FROM "anon", "authenticated";

CREATE TABLE "public"."storage_settings" (
  "id"   integer NOT NULL,
  "mode" text    NOT NULL,
  CONSTRAINT "storage_settings_id_check" CHECK ((id = 1)),
  CONSTRAINT "storage_settings_mode_check" CHECK ((mode = ANY (ARRAY['demo'::text, 'real'::text]))),
  CONSTRAINT "storage_settings_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."storage_settings"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."storage_settings" FROM "anon", "authenticated";

ALTER TABLE "public"."events"
  ADD COLUMN "revision" integer NOT NULL DEFAULT 0;

ALTER TABLE "public"."meeting_types"
  ADD COLUMN "revision" integer NOT NULL DEFAULT 0;

ALTER TABLE "public"."meeting_types"
  ADD COLUMN "active" integer NOT NULL DEFAULT 1;

ALTER TABLE "public"."places"
  ADD COLUMN "revision" integer NOT NULL DEFAULT 0;

ALTER TABLE "public"."places"
  ADD COLUMN "active" integer NOT NULL DEFAULT 1;

ALTER TABLE "public"."requests"
  ADD COLUMN "revision" integer NOT NULL DEFAULT 0;

ALTER TABLE "public"."requests"
  ADD COLUMN "search_id" text;

ALTER TABLE "public"."requests"
  ADD COLUMN "duration_min_snapshot" integer;

ALTER TABLE "public"."requests"
  ADD COLUMN "meeting_type_name_snapshot" text;

ALTER TABLE "public"."requests"
  ADD COLUMN "place_snapshot_json" text;

ALTER TABLE "public"."requests"
  ADD COLUMN "definition_state" text NOT NULL DEFAULT 'unconfirmed'::text;

ALTER TABLE "public"."users"
  ADD COLUMN "current_profile_version" integer;

ALTER TABLE "public"."users"
  ADD COLUMN "setup_state" text NOT NULL DEFAULT 'not_started'::text;

ALTER TABLE "public"."users"
  ADD COLUMN "revision" integer NOT NULL DEFAULT 0;

ALTER TABLE "public"."users"
  ADD COLUMN "schedule_revision" integer NOT NULL DEFAULT 0;

ALTER TABLE "public"."users"
  ADD COLUMN "host_settings_revision" integer NOT NULL DEFAULT 0;

ALTER TABLE "public"."users"
  ADD COLUMN "annotation_revision" integer NOT NULL DEFAULT 0;

ALTER TABLE "public"."users"
  ADD COLUMN "calendar_use_state" text NOT NULL DEFAULT 'not_connected'::text;

ALTER TABLE "public"."users"
  ADD COLUMN "calendar_use_revision" integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.profile_versions_immutable()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  raise exception 'profile versions are immutable';
end;
$function$;

REVOKE ALL ON FUNCTION "public"."profile_versions_immutable"() FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "public"."analysis_evidence"
  ADD CONSTRAINT "analysis_evidence_analysis_id_fkey" FOREIGN KEY (analysis_id) REFERENCES public.analysis_runs(id) ON DELETE CASCADE;

ALTER TABLE "public"."analysis_runs"
  ADD CONSTRAINT "analysis_runs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE "public"."auth_identities"
  ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE "public"."availability_rules"
  ADD CONSTRAINT "availability_rules_check" CHECK (((NOT enabled) OR (start_min < end_min)));

ALTER TABLE "public"."availability_rules"
  ADD CONSTRAINT "availability_rules_end_min_check" CHECK (((end_min >= 0) AND (end_min <= 1440)));

ALTER TABLE "public"."availability_rules"
  ADD CONSTRAINT "availability_rules_start_min_check" CHECK (((start_min >= 0) AND (start_min <= 1440)));

ALTER TABLE "public"."availability_rules"
  ADD CONSTRAINT "availability_rules_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE "public"."availability_rules"
  ADD CONSTRAINT "availability_rules_weekday_check" CHECK (((weekday >= 0) AND (weekday <= 6)));

ALTER TABLE "public"."booking_searches"
  ADD CONSTRAINT "booking_searches_client_id_fkey" FOREIGN KEY (client_id) REFERENCES public.users(id);

ALTER TABLE "public"."booking_searches"
  ADD CONSTRAINT "booking_searches_host_id_fkey" FOREIGN KEY (host_id) REFERENCES public.users(id);

ALTER TABLE "public"."calendar_connections"
  ADD CONSTRAINT "calendar_connections_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE "public"."calendar_snapshots"
  ADD CONSTRAINT "calendar_snapshots_connection_id_fkey" FOREIGN KEY (connection_id) REFERENCES public.calendar_connections(id) ON DELETE CASCADE;

ALTER TABLE "public"."analysis_runs"
  ADD CONSTRAINT "analysis_runs_snapshot_id_fkey" FOREIGN KEY (snapshot_id) REFERENCES public.calendar_snapshots(id) ON DELETE CASCADE;

ALTER TABLE "public"."calendar_connections"
  ADD CONSTRAINT "calendar_connections_analysis_snapshot_fk" FOREIGN KEY (analysis_snapshot_id) REFERENCES public.calendar_snapshots(id) ON DELETE SET NULL;

ALTER TABLE "public"."calendar_connections"
  ADD CONSTRAINT "calendar_connections_schedule_snapshot_fk" FOREIGN KEY (schedule_snapshot_id) REFERENCES public.calendar_snapshots(id) ON DELETE SET NULL;

ALTER TABLE "public"."calendar_sources"
  ADD CONSTRAINT "calendar_sources_connection_id_fkey" FOREIGN KEY (connection_id) REFERENCES public.calendar_connections(id) ON DELETE CASCADE;

ALTER TABLE "public"."calendar_sync_runs"
  ADD CONSTRAINT "calendar_sync_runs_connection_id_fkey" FOREIGN KEY (connection_id) REFERENCES public.calendar_connections(id) ON DELETE CASCADE;

ALTER TABLE "public"."calendar_snapshots"
  ADD CONSTRAINT "calendar_snapshots_sync_run_id_fkey" FOREIGN KEY (sync_run_id) REFERENCES public.calendar_sync_runs(id) ON DELETE CASCADE;

ALTER TABLE "public"."draft_messages"
  ADD CONSTRAINT "draft_messages_evidence_id_fkey" FOREIGN KEY (evidence_id) REFERENCES public.analysis_evidence(id) ON DELETE SET NULL;

ALTER TABLE "public"."event_annotations"
  ADD CONSTRAINT "event_annotations_connection_id_fkey" FOREIGN KEY (connection_id) REFERENCES public.calendar_connections(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_classifications"
  ADD CONSTRAINT "event_classifications_connection_id_fkey" FOREIGN KEY (connection_id) REFERENCES public.calendar_connections(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_classifications"
  ADD CONSTRAINT "event_classifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_check" CHECK (((source <> 'booking'::text) OR (request_id IS NOT NULL)));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_request_id_fkey" FOREIGN KEY (request_id) REFERENCES public.requests(id);

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_revision_check" CHECK ((revision >= 0));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE "public"."imported_busy_intervals"
  ADD CONSTRAINT "imported_busy_intervals_snapshot_id_fkey" FOREIGN KEY (snapshot_id) REFERENCES public.calendar_snapshots(id) ON DELETE CASCADE;

ALTER TABLE "public"."analysis_evidence"
  ADD CONSTRAINT "analysis_evidence_imported_event_id_fkey" FOREIGN KEY (imported_event_id) REFERENCES public.imported_events(id) ON DELETE CASCADE;

ALTER TABLE "public"."imported_events"
  ADD CONSTRAINT "imported_events_snapshot_id_fkey" FOREIGN KEY (snapshot_id) REFERENCES public.calendar_snapshots(id) ON DELETE CASCADE;

ALTER TABLE "public"."meeting_types"
  ADD CONSTRAINT "meeting_types_active_check" CHECK ((active = ANY (ARRAY[0, 1])));

ALTER TABLE "public"."meeting_types"
  ADD CONSTRAINT "meeting_types_host_id_fkey" FOREIGN KEY (host_id) REFERENCES public.users(id);

ALTER TABLE "public"."meeting_types"
  ADD CONSTRAINT "meeting_types_revision_check" CHECK ((revision >= 0));

ALTER TABLE "public"."mutation_operations"
  ADD CONSTRAINT "mutation_operations_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES public.users(id);

ALTER TABLE "public"."calendar_sync_runs"
  ADD CONSTRAINT "calendar_sync_runs_operation_id_fkey" FOREIGN KEY (operation_id) REFERENCES public.mutation_operations(id);

ALTER TABLE "public"."draft_messages"
  ADD CONSTRAINT "draft_messages_operation_id_fkey" FOREIGN KEY (operation_id) REFERENCES public.mutation_operations(id);

ALTER TABLE "public"."oauth_attempts"
  ADD CONSTRAINT "oauth_attempts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."places"
  ADD CONSTRAINT "places_active_check" CHECK ((active = ANY (ARRAY[0, 1])));

ALTER TABLE "public"."places"
  ADD CONSTRAINT "places_host_id_fkey" FOREIGN KEY (host_id) REFERENCES public.users(id);

ALTER TABLE "public"."places"
  ADD CONSTRAINT "places_revision_check" CHECK ((revision >= 0));

ALTER TABLE "public"."profile_drafts"
  ADD CONSTRAINT "profile_drafts_analysis_id_fkey" FOREIGN KEY (analysis_id) REFERENCES public.analysis_runs(id) ON DELETE SET NULL;

ALTER TABLE "public"."draft_messages"
  ADD CONSTRAINT "draft_messages_draft_id_fkey" FOREIGN KEY (draft_id) REFERENCES public.profile_drafts(id) ON DELETE CASCADE;

ALTER TABLE "public"."profile_drafts"
  ADD CONSTRAINT "profile_drafts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE "public"."booking_searches"
  ADD CONSTRAINT "booking_searches_client_id_inherited_profile_version_fkey" FOREIGN KEY (client_id, inherited_profile_version) REFERENCES public.profile_versions(user_id, VERSION);

ALTER TABLE "public"."profile_drafts"
  ADD CONSTRAINT "profile_drafts_user_id_base_profile_version_fkey" FOREIGN KEY (user_id, base_profile_version) REFERENCES public.profile_versions(user_id, VERSION);

ALTER TABLE "public"."profile_versions"
  ADD CONSTRAINT "profile_versions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE "public"."requests"
  ADD CONSTRAINT "requests_client_id_fkey" FOREIGN KEY (client_id) REFERENCES public.users(id);

ALTER TABLE "public"."requests"
  ADD CONSTRAINT "requests_host_id_fkey" FOREIGN KEY (host_id) REFERENCES public.users(id);

ALTER TABLE "public"."requests"
  ADD CONSTRAINT "requests_meeting_type_id_fkey" FOREIGN KEY (meeting_type_id) REFERENCES public.meeting_types(id);

ALTER TABLE "public"."requests"
  ADD CONSTRAINT "requests_place_id_fkey" FOREIGN KEY (place_id) REFERENCES public.places(id);

ALTER TABLE "public"."requests"
  ADD CONSTRAINT "requests_revision_check" CHECK ((revision >= 0));

ALTER TABLE "public"."requests"
  ADD CONSTRAINT "requests_search_id_fkey" FOREIGN KEY (search_id) REFERENCES public.booking_searches(id) ON DELETE SET NULL;

ALTER TABLE "public"."search_messages"
  ADD CONSTRAINT "search_messages_operation_fk" FOREIGN KEY (operation_id) REFERENCES public.mutation_operations(id);

ALTER TABLE "public"."search_messages"
  ADD CONSTRAINT "search_messages_search_id_fkey" FOREIGN KEY (search_id) REFERENCES public.booking_searches(id) ON DELETE CASCADE;

ALTER TABLE "public"."service_leases"
  ADD CONSTRAINT "service_leases_owner_operation_id_fkey" FOREIGN KEY (owner_operation_id) REFERENCES public.mutation_operations(id);

ALTER TABLE "public"."sessions"
  ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."users"
  ADD CONSTRAINT "users_current_profile_fk" FOREIGN KEY (id, current_profile_version) REFERENCES public.profile_versions(user_id, VERSION) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "public"."users"
  ADD CONSTRAINT "users_revision_check" CHECK ((revision >= 0));

CREATE INDEX booking_searches_pair ON public.booking_searches USING btree (client_id, host_id);

CREATE INDEX draft_messages_order ON public.draft_messages USING btree (draft_id, created_at, id);

CREATE UNIQUE INDEX events_booking_request_user ON public.events USING btree (request_id, user_id)
  WHERE (source = 'booking'::text);

CREATE INDEX events_user_interval ON public.events USING btree (user_id, start_at, end_at);

CREATE INDEX imported_busy_interval ON public.imported_busy_intervals USING btree (snapshot_id, start_at, end_at);

CREATE INDEX imported_events_interval ON public.imported_events USING btree (snapshot_id, start_at, end_at);

CREATE UNIQUE INDEX profile_drafts_active ON public.profile_drafts USING btree (user_id)
  WHERE (status = 'active'::text);

CREATE INDEX requests_client_status_start ON public.requests USING btree (client_id, status, start_at);

CREATE INDEX requests_host_status_start ON public.requests USING btree (host_id, status, start_at);

CREATE INDEX search_messages_order ON public.search_messages USING btree (search_id, created_at, id);

CREATE INDEX sessions_user ON public.sessions USING btree (user_id, expires_at);

CREATE TRIGGER profile_versions_immutable_delete
  BEFORE DELETE ON public.profile_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.profile_versions_immutable();

CREATE TRIGGER profile_versions_immutable_update
  BEFORE UPDATE ON public.profile_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.profile_versions_immutable();

GRANT EXECUTE ON FUNCTION "public"."profile_versions_immutable"() TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."analysis_evidence" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."analysis_runs" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."auth_identities" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."booking_searches" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."calendar_connections" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."calendar_snapshots" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."calendar_sources" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."calendar_sync_runs" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."draft_messages" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."event_annotations" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."event_classifications" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."imported_busy_intervals" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."imported_events" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."mutation_operations" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."oauth_attempts" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profile_drafts" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profile_versions" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."search_messages" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."service_leases" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."sessions" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."storage_settings" TO "postgres", "service_role";
