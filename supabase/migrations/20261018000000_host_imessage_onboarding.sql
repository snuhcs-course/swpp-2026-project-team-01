create table host_phone_connections (
  id text primary key,
  host_id text not null references users (id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^[+][1-9][0-9]{7,14}$'),
  status text not null check (status in ('pending','sent','failed','uncertain','connected','expired')),
  space_id text,
  line_id text,
  created_at bigint not null,
  expires_at bigint not null,
  updated_at bigint not null,
  revision integer not null default 0 check (revision >= 0),
  failure_category text,
  check (expires_at > created_at)
);
create unique index host_phone_connections_active_host on host_phone_connections(host_id)
  where status in ('pending','sent','failed','uncertain','connected');
create unique index host_phone_connections_active_phone on host_phone_connections(phone_e164)
  where status in ('pending','sent','failed','uncertain','connected');

create table photon_outbound_attempts (
  id text primary key,
  connection_id text not null references host_phone_connections(id) on delete cascade,
  attempt_no integer not null check (attempt_no between 1 and 3),
  status text not null check (status in ('queued','sending','sent','failed','uncertain')),
  purpose text not null check (purpose = 'welcome'),
  created_at bigint not null,
  updated_at bigint not null,
  available_at bigint not null,
  provider_message_id text,
  failure_category text,
  unique(connection_id, attempt_no)
);
create index photon_outbound_attempts_queue on photon_outbound_attempts(status, available_at, created_at);

create table photon_inbound_events (
  webhook_id text not null,
  message_id text not null,
  event_type text not null,
  platform text,
  direction text,
  sender_id text,
  space_id text,
  space_type text,
  line_id text,
  content_type text,
  body text,
  message_at bigint,
  received_at bigint not null,
  status text not null check (status in ('pending','processing','processed','ignored','failed')),
  processed_at bigint,
  failure_category text,
  primary key(webhook_id, message_id)
);
create index photon_inbound_events_pending on photon_inbound_events(received_at) where status in ('pending','failed');

create table host_imessage_messages (
  id text primary key,
  host_id text not null references users (id) on delete cascade,
  connection_id text not null references host_phone_connections(id) on delete cascade,
  conversation_id text not null,
  direction text not null check (direction in ('inbound','outbound')),
  message_id text not null,
  body text not null,
  created_at bigint not null,
  unique(connection_id, message_id)
);
create index host_imessage_messages_history on host_imessage_messages(host_id, conversation_id, created_at, id);

alter table host_phone_connections enable row level security;
alter table photon_outbound_attempts enable row level security;
alter table photon_inbound_events enable row level security;
alter table host_imessage_messages enable row level security;
revoke all on table host_phone_connections, photon_outbound_attempts, photon_inbound_events, host_imessage_messages
  from anon, authenticated;
