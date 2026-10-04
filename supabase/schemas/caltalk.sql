create table public.owner_calendars (
  google_sub text primary key,
  email text not null,
  encrypted_refresh_token text not null,
  calendar_write_enabled boolean not null default false,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  owner_google_sub text not null references public.owner_calendars (google_sub) on delete cascade,
  active boolean not null default true,
  name text not null default '미팅 요청' check (char_length(btrim(name)) between 1 and 80),
  encrypted_code text,
  availability_start timestamptz,
  availability_end timestamptz,
  availability_windows jsonb,
  meeting_duration_minutes integer check (meeting_duration_minutes in (30, 45, 60, 90, 120, 180, 240)),
  publication_settings jsonb,
  deleted_at timestamptz,
  constraint share_links_availability_check check (
    (availability_start is null and availability_end is null and availability_windows is null)
    or (availability_start is not null and availability_end is not null and availability_windows is not null
      and availability_end > availability_start and jsonb_typeof(availability_windows) = 'array')
  ),
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
  duration_minutes integer not null check (duration_minutes in (30, 45, 60, 90, 120, 180, 240)),
  location text not null default '',
  candidate_slots jsonb not null default '[]'::jsonb,
  status text not null default 'needs_owner_review'
    check (status in ('needs_owner_review', 'confirming', 'approved', 'declined', 'calendar_conflict')),
  booking_owner_sub text references public.owner_calendars (google_sub) on delete cascade,
  confirmed_start timestamptz,
  confirmed_end timestamptz,
  google_event_id text,
  google_event_url text,
  approval_attempt uuid,
  approval_locked_until timestamptz,
  created_at timestamptz not null default now()
);

create index meeting_requests_link_created_idx
  on public.meeting_requests (share_link_id, created_at desc);

create unique index meeting_requests_one_approval_per_owner_idx
  on public.meeting_requests (booking_owner_sub) where status = 'confirming';
create index meeting_requests_booking_owner_idx
  on public.meeting_requests (booking_owner_sub) where booking_owner_sub is not null;

create function public.reserve_meeting_approval(p_owner_sub text, p_request_id uuid, p_start timestamptz, p_attempt uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  booking public.meeting_requests%rowtype;
  selected_end timestamptz;
begin
  perform google_sub from public.owner_calendars where google_sub = p_owner_sub for update;
  select r.* into booking from public.meeting_requests r
    join public.share_links l on l.id = r.share_link_id
    where r.id = p_request_id and l.owner_google_sub = p_owner_sub and l.deleted_at is null for update of r;
  if not found then raise exception 'request_not_found'; end if;
  if booking.status = 'approved' then return to_jsonb(booking); end if;
  if booking.status not in ('needs_owner_review', 'confirming') then raise exception 'request_not_pending'; end if;
  if exists (select 1 from public.meeting_requests where booking_owner_sub = p_owner_sub and status = 'confirming' and id <> p_request_id) then
    raise exception 'other_approval_pending';
  end if;
  if booking.status = 'confirming' then
    if booking.approval_locked_until > now() then raise exception 'approval_busy'; end if;
    if booking.confirmed_start <> p_start then raise exception 'approval_slot_locked'; end if;
  else
    select (slot->>'end')::timestamptz into selected_end
      from jsonb_array_elements(booking.candidate_slots) slot where (slot->>'start')::timestamptz = p_start limit 1;
    if selected_end is null or p_start <= now() or selected_end <= p_start then raise exception 'invalid_candidate'; end if;
    booking.confirmed_start := p_start;
    booking.confirmed_end := selected_end;
  end if;
  update public.meeting_requests set status = 'confirming', booking_owner_sub = p_owner_sub,
    confirmed_start = booking.confirmed_start, confirmed_end = booking.confirmed_end,
    google_event_id = 'caltalk' || replace(p_request_id::text, '-', ''), approval_attempt = p_attempt,
    approval_locked_until = now() + interval '2 minutes'
    where id = p_request_id returning * into booking;
  return to_jsonb(booking);
end;
$$;
revoke all on function public.reserve_meeting_approval(text, uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.reserve_meeting_approval(text, uuid, timestamptz, uuid) to service_role;

-- Share management and approval claims use the same owner lock, so deleting a
-- link cannot hide an in-flight approval that needs to be retried.
create function public.manage_share_link(p_owner_sub text, p_link_id uuid, p_active boolean, p_delete boolean)
returns jsonb language plpgsql set search_path = '' as $$
declare link public.share_links%rowtype;
begin
  perform google_sub from public.owner_calendars where google_sub = p_owner_sub for update;
  select * into link from public.share_links where id = p_link_id and owner_google_sub = p_owner_sub and deleted_at is null for update;
  if not found then raise exception 'link_not_found'; end if;
  if p_delete and exists (select 1 from public.meeting_requests where share_link_id = p_link_id and status = 'confirming') then
    raise exception 'link_approval_pending';
  end if;
  if not p_delete and p_active and link.availability_end <= now() then raise exception 'link_expired'; end if;
  update public.share_links set active = case when p_delete then false else p_active end,
    deleted_at = case when p_delete then now() else null end where id = p_link_id returning * into link;
  return jsonb_build_object('id', link.id, 'active', link.active);
end;
$$;
revoke all on function public.manage_share_link(text, uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.manage_share_link(text, uuid, boolean, boolean) to service_role;

alter table public.owner_calendars enable row level security;
-- Serialize submissions with closing/deleting a link, including requests already in flight.
create function public.require_open_share_link() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform id from public.share_links
    where id = new.share_link_id and active and deleted_at is null
      and (availability_end is null or availability_end > now())
    for share;
  if not found then
    raise exception 'share_link_unavailable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger meeting_requests_require_open_link
before insert on public.meeting_requests
for each row execute function public.require_open_share_link();

revoke all on function public.require_open_share_link() from public, anon, authenticated;
grant execute on function public.require_open_share_link() to service_role;

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
