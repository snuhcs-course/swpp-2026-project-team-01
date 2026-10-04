-- Meeting scheduler MVP (apps/web). Must mirror the tables the app uses (apps/web/src/server/db/schema.ts for the Drizzle-typed ones).
-- The app connects as the database owner from the server only, so the Data API roles get no
-- table privileges, and RLS is enabled with no policies as a second layer.
--
-- Conventions: ids are text; instants are epoch milliseconds in `bigint` (the app reads them back as numbers);
-- the original MVP tables keep their ISO-8601 text instants; JSON documents are stored as text; 0/1 flags are `integer`.

create table users (
  id text primary key,
  name text not null,
  current_profile_version integer,
  setup_state text not null default 'not_started',
  revision integer not null default 0 check (revision >= 0),
  schedule_revision integer not null default 0,
  host_settings_revision integer not null default 0,
  annotation_revision integer not null default 0,
  calendar_use_state text not null default 'not_connected',
  calendar_use_revision integer not null default 0
);

-- Immutable, numbered snapshots of a confirmed meeting-time profile.
create table profile_versions (
  user_id text not null references users (id),
  version integer not null check (version > 0),
  values_json text not null,
  origin text not null,
  confirmed_at bigint,
  primary key (user_id, version)
);

alter table users
  add constraint users_current_profile_fk foreign key (id, current_profile_version)
  references profile_versions (user_id, version) deferrable initially deferred;

create function profile_versions_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'profile versions are immutable';
end;
$$;
revoke all on function profile_versions_immutable() from public, anon, authenticated;
create trigger profile_versions_immutable_update before update on profile_versions
  for each row execute function profile_versions_immutable();
create trigger profile_versions_immutable_delete before delete on profile_versions
  for each row execute function profile_versions_immutable();

create table availability_rules (
  user_id text not null references users (id),
  weekday integer not null check (weekday between 0 and 6),
  enabled boolean not null,
  start_min integer not null check (start_min between 0 and 1440),
  end_min integer not null check (end_min between 0 and 1440),
  check (not enabled or start_min < end_min),
  primary key (user_id, weekday)
);

create table places (
  id text primary key,
  host_id text not null references users (id),
  kind text not null,
  name text not null,
  revision integer not null default 0 check (revision >= 0),
  active integer not null default 1 check (active in (0, 1))
);

create table meeting_types (
  id text primary key,
  host_id text not null references users (id),
  name text not null,
  duration_min integer not null,
  revision integer not null default 0 check (revision >= 0),
  active integer not null default 1 check (active in (0, 1))
);

-- One booking search per visit to a host: conditions are inherited from the profile, overridden or disabled per search.
create table booking_searches (
  id text primary key,
  seq bigint generated always as identity,
  client_id text not null references users (id),
  host_id text not null references users (id),
  revision integer not null default 0 check (revision >= 0),
  inherited_profile_version integer,
  inherited_preferences_json text not null default '{"weekdays":null,"startTime":null,"meetingMode":null,"slack":null}',
  overrides_json text not null default '{}',
  initial_reply_state text not null default 'not_ready',
  last_result_json text,
  data_basis_json text,
  foreign key (client_id, inherited_profile_version) references profile_versions (user_id, version)
);
create index booking_searches_pair on booking_searches (client_id, host_id);

create table requests (
  id text primary key,
  client_id text not null references users (id),
  host_id text not null references users (id),
  start_at text not null,
  end_at text not null,
  place_id text not null references places (id),
  meeting_type_id text not null references meeting_types (id),
  message text not null,
  status text not null,
  created_at text not null,
  decided_at text,
  revision integer not null default 0 check (revision >= 0),
  search_id text references booking_searches (id) on delete set null,
  duration_min_snapshot integer,
  meeting_type_name_snapshot text,
  place_snapshot_json text,
  definition_state text not null default 'unconfirmed'
);
create index requests_client_status_start on requests (client_id, status, start_at);
create index requests_host_status_start on requests (host_id, status, start_at);

create table events (
  id text primary key,
  user_id text not null references users (id),
  title text not null,
  start_at text not null,
  end_at text not null,
  location_kind text not null,
  place_ref text,
  source text not null,
  request_id text references requests (id),
  revision integer not null default 0 check (revision >= 0),
  check (source <> 'booking' or request_id is not null)
);
create index events_user_interval on events (user_id, start_at, end_at);
create unique index events_booking_request_user on events (request_id, user_id) where source = 'booking';

create table conversations (
  id text primary key,
  client_id text not null,
  host_id text not null,
  filter_json text not null,
  unique (client_id, host_id)
);

create table messages (
  id text primary key,
  conversation_id text not null,
  role text not null,
  content text not null,
  options_json text,
  created_at text not null
);

create index messages_conv on messages (conversation_id, created_at);

create table search_messages (
  id text primary key,
  search_id text not null references booking_searches (id) on delete cascade,
  operation_id text,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  options_json text,
  explanation_json text,
  created_at text not null,
  unique (operation_id, role)
);
create index search_messages_order on search_messages (search_id, created_at, id);

-- Idempotency keys, leases and fences for every state-changing command.
create table mutation_operations (
  id text primary key,
  owner_id text not null references users (id),
  kind text not null,
  key text not null,
  payload_hash text not null,
  state text not null check (state in ('running', 'succeeded', 'failed_retryable', 'failed_final')),
  phase text,
  reserved_resource_id text,
  attempt integer not null default 1 check (attempt > 0),
  fence integer not null default 1 check (fence > 0),
  lease_until bigint not null,
  result_json text,
  error_json text,
  revision integer not null default 0 check (revision >= 0),
  created_at bigint not null,
  updated_at bigint not null,
  unique (owner_id, kind, key)
);

alter table search_messages
  add constraint search_messages_operation_fk foreign key (operation_id) references mutation_operations (id);

create table service_leases (
  resource_key text primary key,
  owner_operation_id text not null references mutation_operations (id),
  fence integer not null check (fence > 0),
  lease_until bigint not null,
  revision integer not null default 0 check (revision >= 0)
);

create table storage_settings (
  id integer primary key check (id = 1),
  mode text not null check (mode in ('demo', 'real'))
);

create table auth_identities (
  id text primary key,
  user_id text not null references users (id),
  provider text not null,
  subject text not null,
  unique (provider, subject)
);

create table sessions (
  id text primary key,
  token_hash text not null unique,
  user_id text not null references users (id) on delete cascade,
  expires_at bigint not null,
  revoked_at bigint,
  revision integer not null default 0 check (revision >= 0)
);
create index sessions_user on sessions (user_id, expires_at);

create table oauth_attempts (
  id text primary key,
  state_hash text not null unique,
  nonce_hash text not null,
  browser_binding_hash text not null,
  purpose text not null check (purpose in ('login', 'calendar')),
  user_id text references users (id) on delete cascade,
  return_path text not null,
  expires_at bigint not null,
  consumed_at bigint,
  revision integer not null default 0 check (revision >= 0)
);

-- Calendar connections: the snapshot pointers are added after the snapshot tables exist.
create table calendar_connections (
  id text primary key,
  user_id text not null unique references users (id),
  subject text not null,
  status text not null,
  refresh_token_ciphertext text,
  key_version integer,
  granted_scopes_json text not null default '[]',
  revision integer not null default 0 check (revision >= 0),
  selection_revision integer not null default 0,
  generation integer not null default 0,
  analysis_snapshot_id text,
  schedule_snapshot_id text
);

create table calendar_sources (
  id text primary key,
  connection_id text not null references calendar_connections (id) on delete cascade,
  provider_calendar_id text not null,
  name text not null,
  timezone text,
  access_role text not null,
  selected integer not null default 0 check (selected in (0, 1)),
  revision integer not null default 0 check (revision >= 0),
  unique (connection_id, provider_calendar_id)
);

create table calendar_sync_runs (
  id text primary key,
  connection_id text not null references calendar_connections (id) on delete cascade,
  operation_id text not null references mutation_operations (id),
  selection_revision integer not null,
  base_generation integer not null,
  scope text not null check (scope in ('full', 'schedule')),
  from_at bigint not null,
  to_at bigint not null check (to_at > from_at),
  started_at bigint not null,
  lease_until bigint not null,
  fence integer not null,
  status text not null,
  error_json text,
  revision integer not null default 0 check (revision >= 0)
);

create table calendar_snapshots (
  id text primary key,
  connection_id text not null references calendar_connections (id) on delete cascade,
  sync_run_id text not null unique references calendar_sync_runs (id) on delete cascade,
  generation integer not null,
  scope text not null check (scope in ('full', 'schedule')),
  from_at bigint not null,
  to_at bigint not null check (to_at > from_at),
  selection_revision integer not null,
  started_at bigint not null,
  completed_at bigint not null check (completed_at >= started_at)
);

alter table calendar_connections
  add constraint calendar_connections_analysis_snapshot_fk foreign key (analysis_snapshot_id) references calendar_snapshots (id) on delete set null,
  add constraint calendar_connections_schedule_snapshot_fk foreign key (schedule_snapshot_id) references calendar_snapshots (id) on delete set null;

create table imported_events (
  id text primary key,
  snapshot_id text not null references calendar_snapshots (id) on delete cascade,
  calendar_id text not null,
  provider_event_id text not null,
  recurring_event_id text,
  original_start_time text,
  ical_uid text,
  title text,
  description text,
  location text,
  status text,
  transparency text,
  start_at bigint not null,
  end_at bigint not null check (end_at > start_at),
  all_day integer not null default 0 check (all_day in (0, 1)),
  start_date text,
  end_date text,
  timezone text,
  busy integer not null default 1 check (busy in (0, 1)),
  location_kind text,
  place_ref text,
  content_fingerprint text not null,
  field_fingerprints_json text not null default '{}',
  unique (snapshot_id, calendar_id, provider_event_id)
);
create index imported_events_interval on imported_events (snapshot_id, start_at, end_at);

create table imported_busy_intervals (
  id text primary key,
  snapshot_id text not null references calendar_snapshots (id) on delete cascade,
  calendar_id text not null,
  start_at bigint not null,
  end_at bigint not null check (end_at > start_at)
);
create index imported_busy_interval on imported_busy_intervals (snapshot_id, start_at, end_at);

create table event_annotations (
  id text primary key,
  connection_id text not null references calendar_connections (id) on delete cascade,
  calendar_id text not null,
  provider_event_id text not null,
  revision integer not null default 0 check (revision >= 0),
  field_fingerprints_json text not null,
  values_json text not null,
  confirmations_json text not null,
  unique (connection_id, calendar_id, provider_event_id)
);

create table event_classifications (
  id text primary key,
  seq bigint generated always as identity,
  user_id text not null references users (id),
  connection_id text not null references calendar_connections (id) on delete cascade,
  calendar_id text not null,
  provider_event_id text not null,
  content_fingerprint text not null,
  model_version text not null,
  schema_version integer not null,
  proposal_json text not null,
  unique (user_id, connection_id, calendar_id, provider_event_id, content_fingerprint, model_version, schema_version)
);

create table analysis_runs (
  id text primary key,
  user_id text not null references users (id),
  snapshot_id text not null references calendar_snapshots (id) on delete cascade,
  annotation_revision integer not null,
  from_at bigint not null,
  to_at bigint not null check (to_at > from_at),
  status text not null,
  coverage_json text not null,
  summary_json text not null,
  revision integer not null default 0 check (revision >= 0)
);

create table analysis_evidence (
  id text primary key,
  analysis_id text not null references analysis_runs (id) on delete cascade,
  imported_event_id text references imported_events (id) on delete cascade,
  aggregation_rule_json text not null,
  observation_count integer not null check (observation_count >= 0),
  from_at bigint not null,
  to_at bigint not null check (to_at > from_at)
);

create table profile_drafts (
  id text primary key,
  user_id text not null references users (id),
  status text not null default 'active',
  revision integer not null default 0 check (revision >= 0),
  base_profile_version integer,
  values_json text not null,
  topic_confirmations_json text not null,
  analysis_id text references analysis_runs (id) on delete set null,
  updated_at bigint not null,
  foreign key (user_id, base_profile_version) references profile_versions (user_id, version)
);
create unique index profile_drafts_active on profile_drafts (user_id) where status = 'active';

create table draft_messages (
  id text primary key,
  draft_id text not null references profile_drafts (id) on delete cascade,
  operation_id text not null references mutation_operations (id),
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  proposal_json text,
  evidence_id text references analysis_evidence (id) on delete set null,
  created_at bigint not null,
  unique (operation_id, role)
);
create index draft_messages_order on draft_messages (draft_id, created_at, id);

alter table users enable row level security;
alter table profile_versions enable row level security;
alter table availability_rules enable row level security;
alter table places enable row level security;
alter table meeting_types enable row level security;
alter table booking_searches enable row level security;
alter table requests enable row level security;
alter table events enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table search_messages enable row level security;
alter table mutation_operations enable row level security;
alter table service_leases enable row level security;
alter table storage_settings enable row level security;
alter table auth_identities enable row level security;
alter table sessions enable row level security;
alter table oauth_attempts enable row level security;
alter table calendar_connections enable row level security;
alter table calendar_sources enable row level security;
alter table calendar_sync_runs enable row level security;
alter table calendar_snapshots enable row level security;
alter table imported_events enable row level security;
alter table imported_busy_intervals enable row level security;
alter table event_annotations enable row level security;
alter table event_classifications enable row level security;
alter table analysis_runs enable row level security;
alter table analysis_evidence enable row level security;
alter table profile_drafts enable row level security;
alter table draft_messages enable row level security;

revoke all on table
  users, profile_versions, availability_rules, places, meeting_types, booking_searches, requests, events, conversations, messages,
  search_messages, mutation_operations, service_leases, storage_settings, auth_identities, sessions, oauth_attempts,
  calendar_connections, calendar_sources, calendar_sync_runs, calendar_snapshots, imported_events, imported_busy_intervals,
  event_annotations, event_classifications, analysis_runs, analysis_evidence, profile_drafts, draft_messages
  from anon, authenticated;
