create table public.owner_calendars (
  google_sub text primary key,
  email text not null,
  encrypted_refresh_token text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  owner_google_sub text not null references public.owner_calendars (google_sub) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index share_links_owner_created_idx
  on public.share_links (owner_google_sub, created_at desc);

create table public.requester_calendars (
  id uuid primary key default gen_random_uuid(),
  share_link_id uuid not null references public.share_links (id) on delete cascade,
  google_sub text not null,
  email text not null,
  encrypted_refresh_token text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (share_link_id, google_sub)
);

create index requester_calendars_link_idx
  on public.requester_calendars (share_link_id);

create table public.meeting_requests (
  id uuid primary key default gen_random_uuid(),
  share_link_id uuid not null references public.share_links (id) on delete cascade,
  requester_calendar_id uuid not null references public.requester_calendars (id) on delete restrict,
  requester_name text not null,
  requester_email text not null,
  purpose text not null,
  duration_minutes integer not null check (duration_minutes in (30, 45, 60, 90)),
  location text not null default '',
  candidate_slots jsonb not null default '[]'::jsonb,
  status text not null default 'needs_owner_review'
    check (status in ('needs_owner_review', 'approved', 'declined')),
  created_at timestamptz not null default now()
);

create index meeting_requests_link_created_idx
  on public.meeting_requests (share_link_id, created_at desc);

alter table public.owner_calendars enable row level security;
alter table public.share_links enable row level security;
alter table public.requester_calendars enable row level security;
alter table public.meeting_requests enable row level security;

revoke all on public.owner_calendars from anon, authenticated;
revoke all on public.share_links from anon, authenticated;
revoke all on public.requester_calendars from anon, authenticated;
revoke all on public.meeting_requests from anon, authenticated;

grant all on public.owner_calendars to service_role;
grant all on public.share_links to service_role;
grant all on public.requester_calendars to service_role;
grant all on public.meeting_requests to service_role;
