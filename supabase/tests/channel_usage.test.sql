-- Channel usage counts (channel-usage-report design 2 and 3): one UTC day's
-- active host bindings, inbound receipts, guest links and guest bookings per
-- channel, recounted idempotently, and the operator's day and week report over
-- them. Rows are dated in January 2000 so nothing else in the database falls in
-- the counted day. Everything runs in a rolled-back transaction.
begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

select is(
  (select schedule || ' ' || command from cron.job where jobname = 'app-channel-usage'),
  '23 * * * * select app.record_channel_usage(7)',
  'the channel usage count runs every hour over the last 7 days'
);

insert into app.host_accounts (id) values
  ('00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000a2'),
  ('00000000-0000-4000-8000-0000000000a3'),
  ('00000000-0000-4000-8000-0000000000a4');

-- a1: iMessage, active since before the day. a2: Telegram, unlinked during the
-- day. a3: Telegram, unlinked the hour before. a4: WhatsApp, linked the day after.
insert into app.imessage_bindings (host_account_id, channel, sender_hash, sender_ciphertext, sealed_key_id, state, linked_at, ended_at)
values
  ('00000000-0000-4000-8000-0000000000a1', 'imessage', repeat('1', 64), 'sealed', 'k', 'active', '2000-01-01T00:00:00Z', null),
  ('00000000-0000-4000-8000-0000000000a2', 'telegram', repeat('2', 64), null, 'k', 'unlinked', '2000-01-05T00:00:00Z', '2000-01-10T12:00:00Z'),
  ('00000000-0000-4000-8000-0000000000a3', 'telegram', repeat('3', 64), null, 'k', 'unlinked', '2000-01-05T00:00:00Z', '2000-01-09T23:00:00Z'),
  ('00000000-0000-4000-8000-0000000000a4', 'whatsapp', repeat('4', 64), 'sealed', 'k', 'active', '2000-01-11T00:00:00Z', null);

insert into app.imessage_receipts (channel, message_id, webhook_id, sender_hash, space_hash, space_type, content_type, payload_sha256, received_at)
values
  ('imessage', 'usage-1', 'w', repeat('5', 64), repeat('6', 64), 'dm', 'text', repeat('7', 64), '2000-01-10T00:00:00Z'),
  ('imessage', 'usage-2', 'w', repeat('5', 64), repeat('6', 64), 'dm', 'text', repeat('8', 64), '2000-01-10T23:59:59Z'),
  ('imessage', 'usage-3', 'w', repeat('5', 64), repeat('6', 64), 'dm', 'text', repeat('9', 64), '2000-01-11T00:00:00Z'),
  ('whatsapp', 'usage-4', 'w', repeat('5', 64), repeat('6', 64), 'dm', 'text', repeat('a', 64), '2000-01-10T08:00:00Z');

-- r1 is a guest's request linked on Telegram, booked and then changed; its
-- binding moved to the revised request r2. r3 is the host's sample request.
insert into app.requests (id, host_account_id, state, requester_name, contact_email, expires_at, closed_at)
values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 'booked', 'Grace', 'grace@example.test',
        '2000-01-17T00:00:00Z', '2000-01-10T10:00:00Z');
insert into app.requests (id, host_account_id, requester_name, contact_email, expires_at, revised_from_request_id)
values ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a1', 'Grace', 'grace@example.test',
        '2000-01-17T00:00:00Z', '00000000-0000-4000-8000-0000000000b1');
insert into app.requests (id, host_account_id, is_sample, requester_name, expires_at)
values ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a2', true, 'Sample', '2000-01-17T00:00:00Z');

insert into app.requester_imessage_bindings (request_id, channel, sender_hash, sealed_key_id, state, moved_to_request_id, created_at, ended_at)
values
  ('00000000-0000-4000-8000-0000000000b1', 'telegram', repeat('c', 64), 'k', 'moved', '00000000-0000-4000-8000-0000000000b2',
   '2000-01-10T09:00:00Z', '2000-01-10T13:00:00Z'),
  ('00000000-0000-4000-8000-0000000000b3', 'whatsapp', repeat('d', 64), 'k', 'ended', null, '2000-01-10T09:00:00Z', '2000-01-10T09:30:00Z');
insert into app.requester_imessage_bindings (request_id, channel, sender_hash, sender_ciphertext, sealed_key_id, created_at)
values ('00000000-0000-4000-8000-0000000000b2', 'telegram', repeat('c', 64), 'sealed', 'k', '2000-01-10T13:00:00Z');

insert into app.evaluations (id, request_id, request_revision, settings_revision)
values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 1, 1);
insert into app.proposals (id, request_id, version, evaluation_id, candidate_id, start_at, end_at, details)
values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000b1', 1, '00000000-0000-4000-8000-0000000000c1', 'c1',
        '2000-01-12T10:00:00Z', '2000-01-12T11:00:00Z', '{}');
insert into app.approvals (id, request_id, proposal_id, host_account_id, request_revision, retry_key)
values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000d1',
        '00000000-0000-4000-8000-0000000000a1', 1, 'usage');

-- The original booking, confirmed on the day and then replaced by a change after
-- booking confirmed the same day: only the original counts.
insert into app.bookings (id, request_id, proposal_id, approval_id, host_account_id, calendar_id, event_id, start_at, end_at,
                          reserved_start, reserved_end, state, payload, dispatched_at, confirmed_at)
values ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000d1',
        '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', 'primary', 'usage0000000001',
        '2000-01-12T10:00:00Z', '2000-01-12T11:00:00Z', '2000-01-12T10:00:00Z', '2000-01-12T11:00:00Z', 'cancelled', '{}',
        '2000-01-10T10:00:00Z', '2000-01-10T10:00:00Z');
insert into app.bookings (request_id, proposal_id, approval_id, host_account_id, calendar_id, event_id, start_at, end_at,
                          reserved_start, reserved_end, state, payload, dispatched_at, confirmed_at, replaces_booking_id)
values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1',
        '00000000-0000-4000-8000-0000000000a1', 'primary', 'usage0000000001', '2000-01-12T10:00:00Z', '2000-01-12T11:00:00Z',
        '2000-01-12T10:00:00Z', '2000-01-12T11:00:00Z', 'confirmed', '{}', '2000-01-10T11:00:00Z', '2000-01-10T11:00:00Z',
        '00000000-0000-4000-8000-0000000000f1');

select app.record_channel_usage_day('2000-01-10');
select app.record_channel_usage_day('2000-01-10');

select is(
  (select count(*)::int from app.channel_usage_days where day = '2000-01-10'),
  4,
  'counting a day twice keeps one row per channel'
);

select is(
  (select array[active_hosts, inbound_messages, guest_links, guest_bookings] from app.channel_usage_days
   where day = '2000-01-10' and channel = 'imessage'),
  array[1, 2, 0, 0],
  'iMessage: the active host and the two receipts of the UTC day'
);

select is(
  (select array[active_hosts, inbound_messages, guest_links, guest_bookings] from app.channel_usage_days
   where day = '2000-01-10' and channel = 'whatsapp'),
  array[0, 1, 0, 0],
  'WhatsApp: a host linked the next day and a sample request are not counted'
);

select is(
  (select array[active_hosts, inbound_messages, guest_links, guest_bookings] from app.channel_usage_days
   where day = '2000-01-10' and channel = 'telegram'),
  array[1, 0, 1, 1],
  'Telegram: a host unlinked during the day, one guest link (not the moved binding) and the original booking'
);

-- The sources are deleted after 30 days; the counts stay.
delete from app.imessage_receipts where message_id like 'usage-%';
delete from app.imessage_bindings where host_account_id in (
  '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2'
);

select is(
  (select sum(inbound_messages)::int + sum(active_hosts)::int from app.channel_usage_days where day = '2000-01-10'),
  5,
  'the day''s counts outlive the receipts and bindings they were counted from'
);

select is(
  app.operator_channel_usage_report('day', 2, '2000-01-10') -> 'channels' -> 0 -> 'periods',
  '[{"start": "2000-01-09", "recordedDays": 0, "activeHosts": 0, "inboundMessages": 0, "guestLinks": 0, "guestBookings": 0},
    {"start": "2000-01-10", "recordedDays": 1, "activeHosts": 1, "inboundMessages": 2, "guestLinks": 0, "guestBookings": 0}]'::jsonb,
  'a daily report zero-fills a day that was not recorded and says so'
);

insert into app.channel_usage_days (day, channel, active_hosts, inbound_messages, guest_links, guest_bookings)
values ('2000-01-11', 'telegram', 3, 4, 2, 1);

select is(
  app.operator_channel_usage_report('week', 1, '2000-01-14') -> 'channels' -> 2,
  '{"name": "telegram", "periods": [{"start": "2000-01-10", "recordedDays": 2, "activeHosts": 3, "inboundMessages": 4,
    "guestLinks": 3, "guestBookings": 2}]}'::jsonb,
  'a weekly report starts on Monday, sums the days and keeps the highest day''s active hosts'
);

select is(
  (select array_agg(c ->> 'name') from jsonb_array_elements(app.operator_channel_usage_report('week', 1, '2000-01-14') -> 'channels') c),
  array['imessage', 'whatsapp', 'telegram', 'kakaotalk'],
  'the report lists the four channels in a fixed order'
);

select is(
  (select array[r ->> 'from', r ->> 'to', r ->> 'period'] from (select app.operator_channel_usage_report('week', 2, '2000-01-14') r) x),
  array['2000-01-03', '2000-01-16', 'week'],
  'the report names its whole window'
);

select is(
  (select array_agg(k order by k) from jsonb_object_keys(
    app.operator_channel_usage_report('day', 1, '2000-01-10') -> 'channels' -> 0 -> 'periods' -> 0) k),
  array['activeHosts', 'guestBookings', 'guestLinks', 'inboundMessages', 'recordedDays', 'start'],
  'a period holds counts and its start date only'
);

select throws_ok(
  $$ select app.operator_channel_usage_report('month', 1, null) $$,
  '22023', 'period must be day or week', 'the report refuses an unknown period'
);

select throws_ok(
  $$ select app.operator_channel_usage_report('day', 91, null) $$,
  '22023', 'period count out of range', 'the daily report covers at most 90 days'
);

select throws_ok(
  $$ select app.record_channel_usage(31) $$,
  '22023', 'days back must be between 1 and 30', 'the count never reaches past the sources'' retention'
);

select is(app.record_channel_usage(2), 2, 'the hourly count recounts the requested recent days');

select * from finish();
rollback;
