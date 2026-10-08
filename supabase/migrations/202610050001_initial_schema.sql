-- AI-generated with Codex; committed 2026-10-05 (b78494b).
create extension if not exists pgcrypto;

create type public.booking_status as enum (
  'collecting_details', 'pending_host_approval', 'approved', 'rejected',
  'confirmed', 'needs_new_proposal', 'cancelled'
);

create table public.host_preferences (
  host_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Asia/Seoul',
  preferences jsonb not null default '{}'::jsonb,
  travel_buffer_minutes integer not null default 30 check (travel_buffer_minutes between 0 and 240),
  updated_at timestamptz not null default now()
);

create table public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  requester_id uuid references auth.users(id) on delete set null,
  requester_name text,
  idempotency_key text not null,
  title text not null,
  purpose text not null,
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  timezone text not null default 'Asia/Seoul',
  requested_window jsonb not null default '{}'::jsonb,
  location text,
  proposed_start_at timestamptz,
  proposal_version integer not null default 1,
  status public.booking_status not null default 'collecting_details',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (host_id, idempotency_key)
);

create table public.request_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.booking_requests(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  sender_role text not null check (sender_role in ('host', 'requester', 'assistant')),
  body text not null check (length(body) <= 8000),
  created_at timestamptz not null default now()
);

create table public.booking_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.booking_requests(id) on delete cascade,
  host_id uuid not null references auth.users(id) on delete cascade,
  provider_event_id text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index booking_requests_host_status_idx on public.booking_requests(host_id, status, created_at desc);
create index request_messages_request_created_idx on public.request_messages(request_id, created_at);

alter table public.host_preferences enable row level security;
alter table public.booking_requests enable row level security;
alter table public.request_messages enable row level security;
alter table public.booking_events enable row level security;

create policy "host reads own preferences" on public.host_preferences for select to authenticated using (host_id = (select auth.uid()));
create policy "host inserts own preferences" on public.host_preferences for insert to authenticated with check (host_id = (select auth.uid()));
create policy "host updates own preferences" on public.host_preferences for update to authenticated using (host_id = (select auth.uid())) with check (host_id = (select auth.uid()));

create policy "host reads own requests" on public.booking_requests for select to authenticated using (host_id = (select auth.uid()));
create policy "host creates requests for own calendar" on public.booking_requests for insert to authenticated with check (host_id = (select auth.uid()));
create policy "host reads own messages" on public.request_messages for select to authenticated using (
  exists (select 1 from public.booking_requests r where r.id = request_id and r.host_id = (select auth.uid()))
);
create policy "host reads own booked events" on public.booking_events for select to authenticated using (host_id = (select auth.uid()));

create or replace function public.respond_to_booking_request(request_id uuid, response text, expected_version integer)
returns public.booking_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result public.booking_requests;
begin
  if response not in ('approved', 'rejected') then
    raise exception 'Unsupported response';
  end if;
  update public.booking_requests as br
     set status = response::public.booking_status,
         proposal_version = proposal_version + 1,
         updated_at = now()
   where br.id = request_id
     and br.host_id = (select auth.uid())
     and br.status = 'pending_host_approval'
     and br.proposal_version = expected_version
   returning * into result;
  if result.id is null then
    raise exception 'Request is unavailable or no longer pending';
  end if;
  return result;
end;
$$;

grant execute on function public.respond_to_booking_request(uuid, text, integer) to authenticated;
