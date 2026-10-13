SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION fmat.confirmed_booking_receipt (
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare r fmat.requests; a fmat.booking_attempts; p fmat.proposals;
begin
 select * into r from fmat.requests where id=p_request_id;
 if r.status is distinct from 'booked' then return null;end if;
 select * into a from fmat.booking_attempts where request_id=r.id and phase='confirmed' order by confirmed_at desc,id desc limit 1;
 if not found or a.confirmed_at is null or a.provider_evidence->>'eventId' is distinct from a.event_id
  or a.provider_evidence->>'calendarId' is distinct from a.calendar_id or a.provider_evidence->>'payloadFingerprint' is distinct from a.payload_fingerprint
  or r.event->>'id' is distinct from a.event_id then return null;end if;
 select * into strict p from fmat.proposals where request_id=r.id and version=a.proposal_version;
 return jsonb_build_object('confirmedAt',a.confirmed_at,'title',a.payload->>'summary','purpose',p.details->>'purpose',
  'start',a.payload->'start'->>'dateTime','end',a.payload->'end'->>'dateTime','timezone',a.payload->'start'->>'timeZone',
  'mode',p.details->>'mode','location',a.payload->>'location','participants',a.payload->'attendees',
  'calendarUrl',case when a.provider_evidence->>'eventUrl' ~ '^https://www\.google\.com/calendar/' then a.provider_evidence->>'eventUrl' else null end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_booking_receipt (
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare r fmat.requests; actor jsonb; state jsonb; receipt jsonb; delivery text; viewer_audience text;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or not(p_input ? 'requestId') or exists(select 1 from jsonb_object_keys(p_input) k where k<>'requestId') then raise exception 'INVALID_INPUT';end if;
 select * into r from fmat.requests where id=(p_input->>'requestId')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if p_credential->>'kind'='host' then
  actor:=fmat.calendar_actor(p_credential);
  if actor->>'id' is distinct from r.host_id::text then raise exception 'NOT_FOUND';end if;
  viewer_audience:='host';
 elsif p_credential->>'kind'='guest' then
  if p_credential->>'requestId' is distinct from r.id::text or p_credential->>'tokenHash' is distinct from r.token_hash or r.token_expires_at<=clock_timestamp()
   or (r.token_revoked_at is not null and r.status not in ('booked','declined','withdrawn','expired')) then raise exception 'NOT_FOUND';end if;
  viewer_audience:='requester';
 else raise exception 'UNAUTHORIZED';end if;
 state:=fmat.request_lifecycle_view(r.id,p_credential->>'kind');
 receipt:=fmat.confirmed_booking_receipt(r.id);
 if receipt is not null then
  select o.status into delivery from fmat.outbox o where o.dedupe_key='booking-confirmed:'||r.id::text||':'||viewer_audience;
 end if;
 return jsonb_build_object('requestId',r.id,'revision',r.revision,'status',state->>'status','closed',state->'closed','receipt',receipt,'emailStatus',case when receipt is null then null else coalesce(delivery,'pending') end);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_booking_receipt"(jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "fmat"."confirmed_booking_receipt"(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_booking_receipt"(jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_booking_receipt"(jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_booking_receipt"(jsonb, jsonb) TO "service_role";
