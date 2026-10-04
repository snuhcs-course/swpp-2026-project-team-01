SET local check_function_bodies = off;

ALTER TABLE "public"."meeting_requests"
  DROP CONSTRAINT "meeting_requests_duration_minutes_check";

ALTER TABLE "public"."meeting_requests"
  DROP CONSTRAINT "meeting_requests_status_check";

ALTER TABLE "public"."meeting_requests"
  ADD COLUMN "booking_owner_sub" text;

ALTER TABLE "public"."meeting_requests"
  ADD COLUMN "confirmed_start" timestamp WITH time zone;

ALTER TABLE "public"."meeting_requests"
  ADD COLUMN "confirmed_end" timestamp WITH time zone;

ALTER TABLE "public"."meeting_requests"
  ADD COLUMN "google_event_id" text;

ALTER TABLE "public"."meeting_requests"
  ADD COLUMN "google_event_url" text;

ALTER TABLE "public"."meeting_requests"
  ADD COLUMN "approval_attempt" uuid;

ALTER TABLE "public"."meeting_requests"
  ADD COLUMN "approval_locked_until" timestamp WITH time zone;

ALTER TABLE "public"."owner_calendars"
  ADD COLUMN "calendar_write_enabled" boolean NOT NULL DEFAULT false;

ALTER TABLE "public"."share_links"
  ADD COLUMN "meeting_duration_minutes" integer;

ALTER TABLE "public"."share_links"
  ADD COLUMN "publication_settings" jsonb;

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
    where r.id = p_request_id and l.owner_google_sub = p_owner_sub for update of r;
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

REVOKE ALL ON FUNCTION "public"."reserve_meeting_approval"(text, uuid, timestamp WITH time zone, uuid) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "public"."meeting_requests"
  ADD CONSTRAINT "meeting_requests_booking_owner_sub_fkey" FOREIGN KEY (booking_owner_sub) REFERENCES public.owner_calendars(google_sub) ON DELETE CASCADE;

ALTER TABLE "public"."meeting_requests"
  ADD CONSTRAINT "meeting_requests_duration_minutes_check" CHECK ((duration_minutes = ANY (ARRAY[30, 45, 60, 90, 120, 180, 240])));

ALTER TABLE "public"."meeting_requests"
  ADD CONSTRAINT "meeting_requests_status_check" CHECK ((status = ANY (ARRAY['needs_owner_review'::text, 'confirming'::text, 'approved'::text, 'declined'::text])));

ALTER TABLE "public"."share_links"
  ADD CONSTRAINT "share_links_meeting_duration_minutes_check" CHECK ((meeting_duration_minutes = ANY (ARRAY[30, 45, 60, 90, 120, 180, 240])));

CREATE INDEX meeting_requests_booking_owner_idx ON public.meeting_requests USING btree (booking_owner_sub)
  WHERE (booking_owner_sub IS NOT NULL);

CREATE UNIQUE INDEX meeting_requests_one_approval_per_owner_idx ON public.meeting_requests USING btree (booking_owner_sub)
  WHERE (status = 'confirming'::text);

GRANT EXECUTE ON FUNCTION "public"."reserve_meeting_approval"(text, uuid, timestamp WITH time zone, uuid) TO "postgres", "service_role";
