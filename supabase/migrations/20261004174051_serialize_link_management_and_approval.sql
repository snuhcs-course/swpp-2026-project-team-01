SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.manage_share_link (
  p_owner_sub text,
  p_link_id   uuid,
  p_active    boolean,
  p_delete    boolean
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION "public"."manage_share_link"(text, uuid, boolean, boolean) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.reserve_meeting_approval (
  p_owner_sub  text,
  p_request_id uuid,
  p_start      timestamp with time zone,
  p_attempt    uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."manage_share_link"(text, uuid, boolean, boolean) TO "postgres", "service_role";
