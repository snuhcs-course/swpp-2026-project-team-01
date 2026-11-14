-- The weekly note check (calendar-note-review task 6.1): pg_cron runs the
-- publication every Monday at 00:00 UTC (09:00 in Asia/Seoul); it publishes one
-- job per active host with settings and a valid grant, once per week; the
-- weekly review holds one row per host and no title, only the owner sees it,
-- and deleting the host removes it.
begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

select ok(
  (select relrowsecurity from pg_class where oid = 'app.calendar_note_weekly_reviews'::regclass),
  'the weekly reviews enable row-level security'
);

select ok(
  not has_table_privilege('anon', 'app.calendar_note_weekly_reviews', 'select, insert, update, delete')
    and not has_table_privilege('authenticated', 'app.calendar_note_weekly_reviews', 'select, insert, update, delete'),
  'the Data API roles cannot read or change the weekly reviews'
);

select hasnt_column('app', 'calendar_note_weekly_reviews', 'title', 'a weekly review stores no event title');

select ok(
  not has_function_privilege('anon', 'app.publish_weekly_note_checks()', 'execute')
    and not has_function_privilege('authenticated', 'app.publish_weekly_note_checks()', 'execute'),
  'Data API roles cannot run the weekly publication'
);

select is(
  (select command from cron.job where jobname = 'app-weekly-note-check'),
  'select app.publish_weekly_note_checks()',
  'pg_cron runs the weekly publication'
);

select is(
  (select schedule from cron.job where jobname = 'app-weekly-note-check'),
  '0 0 * * 1',
  'the weekly publication runs on Monday at 00:00 UTC, 09:00 in Seoul'
);

-- A sandbox: no worker entries in Vault, so the jobs are produced for local.
delete from vault.secrets where name in ('worker_url', 'worker_secret');

insert into app.host_accounts (id) values
  ('00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000e2'),
  ('00000000-0000-4000-8000-0000000000e3');
-- e1: settings and a valid grant; e2: settings but an invalidated grant; e3: a grant but no settings.
insert into app.host_settings (host_account_id, settings, draft_revision) values
  ('00000000-0000-4000-8000-0000000000e1', '{}', 1),
  ('00000000-0000-4000-8000-0000000000e2', '{}', 1);
insert into app.provider_grants (host_account_id, granted_scopes, refresh_token_ciphertext, refresh_token_key_id, scopes_checked_at, invalidated_at) values
  ('00000000-0000-4000-8000-0000000000e1', '{}', 'sealed', 'key', now(), null),
  ('00000000-0000-4000-8000-0000000000e2', '{}', 'sealed', 'key', now(), now()),
  ('00000000-0000-4000-8000-0000000000e3', '{}', 'sealed', 'key', now(), null);

select ok(app.publish_weekly_note_checks() >= 1, 'the publication publishes jobs');

select is(
  (select array_agg(payload ->> 'hostAccountId' order by payload ->> 'hostAccountId') from app.jobs
   where kind = 'weekly_note_check' and payload ->> 'hostAccountId' like '00000000-0000-4000-8000-0000000000e_'),
  array['00000000-0000-4000-8000-0000000000e1'],
  'only an active host with settings and a valid grant is checked'
);

select is(
  (select payload ->> 'week' from app.jobs where kind = 'weekly_note_check' and payload ->> 'hostAccountId' = '00000000-0000-4000-8000-0000000000e1'),
  to_char(date_trunc('week', now() at time zone 'Asia/Seoul'), 'YYYY-MM-DD'),
  'the job names the Monday of the week in Seoul'
);

select is(
  (select producer_environment from app.jobs where kind = 'weekly_note_check' and payload ->> 'hostAccountId' = '00000000-0000-4000-8000-0000000000e1'),
  'local',
  'without the worker in Vault the job is produced for local'
);

select app.publish_weekly_note_checks();

select is(
  (select count(*)::integer from app.jobs where kind = 'weekly_note_check' and payload ->> 'hostAccountId' = '00000000-0000-4000-8000-0000000000e1'),
  1,
  'a second run in the same week publishes no second job'
);

insert into app.calendar_note_weekly_reviews (host_account_id, week, timezone, items)
values ('00000000-0000-4000-8000-0000000000e1', '2026-11-16', 'Asia/Seoul',
        '[{"calendarId": "host@example.test", "eventId": "birthday", "seriesId": null, "fingerprint": "f", "start": "2026-11-18", "end": "2026-11-19", "allDay": true, "verdict": "note"}]');

select throws_ok(
  $$ insert into app.calendar_note_weekly_reviews (host_account_id, week, timezone, items)
     values ('00000000-0000-4000-8000-0000000000e1', '2026-11-23', 'Asia/Seoul', '[{"eventId": "x"}]') $$,
  '23505', null, 'a host has one current weekly review'
);

delete from app.host_accounts where id = '00000000-0000-4000-8000-0000000000e1';

select is(
  (select count(*)::integer from app.calendar_note_weekly_reviews where host_account_id = '00000000-0000-4000-8000-0000000000e1'),
  0,
  'deleting the host deletes their weekly review'
);

select * from finish();
rollback;
