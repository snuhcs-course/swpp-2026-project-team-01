-- AI provenance: OpenAI Codex; initially generated 2026-10-05 (Asia/Seoul); scope: file.
-- Authenticated account bindings and optional manual meeting requests.
-- Authored from the declarative schema because the local Docker engine could not start.
begin;
alter table public.owner_calendars add column account_id uuid unique references auth.users (id) on delete set null;
alter table public.meeting_requests alter column requester_calendar_id drop not null;
alter table public.meeting_requests add column request_mode text not null default 'google' check (request_mode in ('google', 'manual'));
alter table public.meeting_requests add constraint meeting_requests_mode_calendar_check
  check ((request_mode = 'manual' and requester_calendar_id is null) or (request_mode = 'google' and requester_calendar_id is not null));
-- Bind only after a completed, account-bound Google OAuth flow.
create function public.link_account_calendar(p_account_id uuid, p_google_sub text, p_email text, p_token text, p_write boolean)
returns void language plpgsql set search_path = '' as $$
begin
  perform id from auth.users where id = p_account_id for update;
  if not found then raise exception 'account_missing'; end if;
  if exists(select 1 from public.owner_calendars where account_id = p_account_id and google_sub <> p_google_sub) then
    raise exception 'different_google_account';
  end if;
  insert into public.owner_calendars(google_sub, account_id, email, encrypted_refresh_token, calendar_write_enabled)
    values(p_google_sub, p_account_id, p_email, p_token, p_write)
    on conflict(google_sub) do update set account_id = excluded.account_id, email = excluded.email,
      encrypted_refresh_token = excluded.encrypted_refresh_token,
      calendar_write_enabled = excluded.calendar_write_enabled,
      updated_at = now()
    where owner_calendars.account_id is null or owner_calendars.account_id = excluded.account_id;
  if not found then raise exception 'google_account_already_linked'; end if;
end;
$$;
revoke all on function public.link_account_calendar(uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.link_account_calendar(uuid, text, text, text, boolean) to service_role;

commit;
