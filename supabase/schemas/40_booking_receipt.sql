-- Shared final details are projected from the confirmed frozen attempt, never
-- from mutable request details, current calendars or private scheduling state.
create or replace function fmat.confirmed_booking_receipt(p_request_id uuid)
returns jsonb language plpgsql set search_path='' as $$
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
  'organizer',coalesce(a.provider_evidence->'organizer','null'::jsonb),'mode',p.details->>'mode','location',a.payload->>'location','participants',a.payload->'attendees',
  'calendarUrl',case when a.provider_evidence->>'eventUrl' ~ '^https://www\.google\.com/calendar/' then a.provider_evidence->>'eventUrl' else null end);
end;
$$;
revoke all on function fmat.confirmed_booking_receipt(uuid) from public,anon,authenticated,service_role;

create or replace function public.fmat_booking_receipt(p_credential jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r fmat.requests; actor jsonb; state jsonb; receipt jsonb; delivery text; viewer_audience text;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or not(p_input ? 'requestId') or exists(select 1 from jsonb_object_keys(p_input) k where k<>'requestId') then raise exception 'INVALID_INPUT';end if;
 select * into r from fmat.requests where id=(p_input->>'requestId')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if p_credential->>'kind'='host' then
  actor:=fmat.calendar_actor(p_credential);
  if actor->>'id' is distinct from r.host_id::text then raise exception 'NOT_FOUND';end if;
  viewer_audience:='host';
 elsif p_credential->>'kind'='booking_receipt' then
  if r.status<>'booked' or p_credential->>'requestId' is distinct from r.id::text or not exists(
   select 1 from fmat.booking_deliveries d join fmat.outbox o on o.id=d.outbox_id where d.request_id=r.id and d.receipt_token_hash=p_credential->>'tokenHash'
    and d.dispatched_at is not null and d.parent_token_hash=r.token_hash and d.receipt_expires_at>clock_timestamp() and r.token_expires_at>clock_timestamp()
    and o.audience='requester' and lower(o.recipient->>'email')=lower(r.contact_verified_email) and o.status in ('sending','sent','uncertain')) then raise exception 'NOT_FOUND';end if;
  viewer_audience:='requester';
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
$$;
revoke all on function public.fmat_booking_receipt(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_booking_receipt(jsonb,jsonb) to service_role;
