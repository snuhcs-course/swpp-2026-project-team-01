-- Meeting scheduler MVP (apps/web). Must mirror apps/web/src/server/db/schema.ts.
-- The app connects as the database owner from the server only, so the Data API roles get no
-- table privileges, and RLS is enabled with no policies as a second layer.

create table users (
  id text primary key,
  name text not null
);

create table availability_rules (
  user_id text not null,
  weekday integer not null,
  enabled boolean not null,
  start_min integer not null,
  end_min integer not null,
  primary key (user_id, weekday)
);

create table places (
  id text primary key,
  host_id text not null,
  kind text not null,
  name text not null
);

create table meeting_types (
  id text primary key,
  host_id text not null,
  name text not null,
  duration_min integer not null
);

create table events (
  id text primary key,
  user_id text not null,
  title text not null,
  start_at text not null,
  end_at text not null,
  location_kind text not null,
  place_ref text,
  source text not null,
  request_id text
);

create index events_user_start on events (user_id, start_at);

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

create table requests (
  id text primary key,
  client_id text not null,
  host_id text not null,
  start_at text not null,
  end_at text not null,
  place_id text not null,
  meeting_type_id text not null,
  message text not null,
  status text not null,
  created_at text not null,
  decided_at text
);

alter table users enable row level security;
alter table availability_rules enable row level security;
alter table places enable row level security;
alter table meeting_types enable row level security;
alter table events enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table requests enable row level security;

revoke all on table users, availability_rules, places, meeting_types, events, conversations, messages, requests
  from anon, authenticated;
