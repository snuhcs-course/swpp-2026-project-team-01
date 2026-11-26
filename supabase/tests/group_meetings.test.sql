-- Group meeting schema (group-scheduling design 1, 2 and 4): the Data API
-- roles reach no group table, which enables row-level security; the shared
-- link is unique by hash; a participant request belongs to its group and goes
-- with it; confirmed unavailable times keep a place only for calendar events;
-- an option is in person exactly when it has a place. Everything runs in a
-- rolled-back transaction.
begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select is_empty(
  $$
    select r.rolname || ':' || t.name from pg_roles r
    cross join (values ('app.group_meetings'), ('app.group_participants'), ('app.group_unavailable_times'), ('app.group_meeting_options')) as t(name)
    where r.rolname in ('anon', 'authenticated')
      and has_table_privilege(r.oid, t.name, 'select, insert, update, delete, truncate, references, trigger')
  $$,
  'anon and authenticated hold no privilege on group tables'
);

select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('app.group_meetings'::regclass, 'app.group_participants'::regclass,
                 'app.group_unavailable_times'::regclass, 'app.group_meeting_options'::regclass)),
  'group tables enable row-level security'
);

insert into app.host_accounts (id) values ('00000000-0000-4000-8000-0000000000c1');
insert into app.group_meetings
  (id, host_account_id, purpose, duration_minutes, range_start, range_end, timezone, language, participant_limit, link_hash, link_ciphertext, link_key_id)
values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 'Kickoff', 60, '2026-12-01', '2026-12-05', 'Asia/Seoul', 'ko', 4, repeat('a', 64), 'sealed', 'k');

select throws_ok(
  $$ insert into app.group_meetings
       (host_account_id, purpose, duration_minutes, range_start, range_end, timezone, language, participant_limit, link_hash, link_ciphertext, link_key_id)
     values ('00000000-0000-4000-8000-0000000000c1', 'Again', 60, '2026-12-01', '2026-12-05', 'Asia/Seoul', 'ko', 4, repeat('a', 64), 'sealed', 'k') $$,
  '23505', null, 'a shared link hash names one group'
);

select throws_ok(
  $$ insert into app.group_meetings
       (host_account_id, purpose, duration_minutes, range_start, range_end, timezone, language, participant_limit, link_hash, link_ciphertext, link_key_id)
     values ('00000000-0000-4000-8000-0000000000c1', 'Reversed', 60, '2026-12-05', '2026-12-01', 'Asia/Seoul', 'ko', 4, repeat('b', 64), 'sealed', 'k') $$,
  '23514', null, 'a range ends on or after its start'
);

select throws_ok(
  $$ update app.group_meetings set state = 'closed' where id = '00000000-0000-4000-8000-0000000000a1' $$,
  '23514', null, 'a closed group has closed_at'
);

select throws_ok(
  $$ update app.group_meetings set state = 'booked', closed_at = now() where id = '00000000-0000-4000-8000-0000000000a1' $$,
  '23514', null, 'a booked group has its option, event and booking time'
);

insert into app.requests (id, host_account_id, requester_name, contact_email, expires_at, group_meeting_id)
values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c1', 'Grace', 'grace@example.test',
        '9999-12-31T00:00:00Z', '00000000-0000-4000-8000-0000000000a1');
insert into app.group_participants (request_id) values ('00000000-0000-4000-8000-0000000000d1');

select throws_ok(
  $$ update app.group_participants set done_at = now() where request_id = '00000000-0000-4000-8000-0000000000d1' $$,
  '23514', null, 'a participant is done only after answering'
);

select lives_ok(
  $$ insert into app.group_unavailable_times (request_id, source, starts_at, ends_at, place)
     values ('00000000-0000-4000-8000-0000000000d1', 'calendar', '2026-12-01T03:00:00Z', '2026-12-01T04:00:00Z', '신촌') $$,
  'a calendar time keeps its place'
);

select throws_ok(
  $$ insert into app.group_unavailable_times (request_id, source, starts_at, ends_at, place)
     values ('00000000-0000-4000-8000-0000000000d1', 'stated', '2026-12-01T05:00:00Z', '2026-12-01T06:00:00Z', '신촌') $$,
  '23514', null, 'a stated time has no place'
);

select throws_ok(
  $$ insert into app.group_meeting_options (group_meeting_id, position, mode, starts_at, ends_at)
     values ('00000000-0000-4000-8000-0000000000a1', 1, 'in_person', '2026-12-01T05:00:00Z', '2026-12-01T06:00:00Z') $$,
  '23514', null, 'an in-person option has a place'
);

select lives_ok(
  $$ insert into app.group_meeting_options (group_meeting_id, position, mode, starts_at, ends_at)
     values ('00000000-0000-4000-8000-0000000000a1', 1, 'online', '2026-12-01T05:00:00Z', '2026-12-01T06:00:00Z') $$,
  'an online option has no place'
);

delete from app.group_meetings where id = '00000000-0000-4000-8000-0000000000a1';

select is_empty(
  $$ select 1 from app.requests where id = '00000000-0000-4000-8000-0000000000d1'
     union all select 1 from app.group_unavailable_times where request_id = '00000000-0000-4000-8000-0000000000d1' $$,
  'a deleted group takes its participant requests and their times with it'
);

select * from finish();
rollback;
