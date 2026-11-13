-- Calendar note decisions (calendar-note-review task 2.1): only the owner sees
-- them, they hold one row per decided item, a not_writable state belongs to a free
-- decision and a failure always names its reason, the analysis cleanup keeps them,
-- and deleting the host removes them.
begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

select ok(
  (select relrowsecurity from pg_class where oid = 'app.calendar_note_decisions'::regclass),
  'the decisions enable row-level security'
);

select ok(
  not has_table_privilege('anon', 'app.calendar_note_decisions', 'select, insert, update, delete')
    and not has_table_privilege('authenticated', 'app.calendar_note_decisions', 'select, insert, update, delete'),
  'the Data API roles cannot read or change the decisions'
);

select hasnt_column('app', 'calendar_note_decisions', 'title', 'a decision stores no event title');

insert into app.host_accounts (id) values ('00000000-0000-4000-8000-0000000000c1');

select lives_ok(
  $$ insert into app.calendar_note_decisions (host_account_id, calendar_id, event_id, scope, fingerprint, decision, writeback_state)
     values ('00000000-0000-4000-8000-0000000000c1', 'host@example.test', 'recycling', 'series', '2026-10-05T00:00:00.000Z', 'free', 'pending') $$,
  'a free series decision is recorded with a pending writeback'
);

select throws_ok(
  $$ insert into app.calendar_note_decisions (host_account_id, calendar_id, event_id, scope, fingerprint, decision)
     values ('00000000-0000-4000-8000-0000000000c1', 'host@example.test', 'recycling', 'occurrence', 'f', 'keep_busy') $$,
  '23505', null, 'one decided item has one row'
);

select throws_ok(
  $$ insert into app.calendar_note_decisions (host_account_id, calendar_id, event_id, scope, fingerprint, decision, writeback_state)
     values ('00000000-0000-4000-8000-0000000000c1', 'birthdays', 'dad', 'series', 'f', 'keep_busy', 'not_writable') $$,
  '23514', null, 'only a free decision is recorded as not writable'
);

select throws_ok(
  $$ insert into app.calendar_note_decisions (host_account_id, calendar_id, event_id, scope, fingerprint, decision, writeback_state)
     values ('00000000-0000-4000-8000-0000000000c1', 'host@example.test', 'gym', 'occurrence', 'f', 'free', 'failed') $$,
  '23514', null, 'a failed writeback names its reason'
);

select throws_ok(
  $$ insert into app.calendar_note_decisions (host_account_id, calendar_id, event_id, scope, fingerprint, decision)
     values ('00000000-0000-4000-8000-0000000000c1', 'host@example.test', 'gym', 'weekly', 'f', 'free') $$,
  '23514', null, 'the scope is series or occurrence'
);

update app.calendar_note_decisions set created_at = now() - interval '3 days', updated_at = now() - interval '3 days';
select app.cleanup_calendar_analyses(500);

select is(
  (select count(*)::integer from app.calendar_note_decisions where host_account_id = '00000000-0000-4000-8000-0000000000c1'),
  1,
  'the analysis cleanup keeps host decisions'
);

delete from app.host_accounts where id = '00000000-0000-4000-8000-0000000000c1';

select is(
  (select count(*)::integer from app.calendar_note_decisions where host_account_id = '00000000-0000-4000-8000-0000000000c1'),
  0,
  'deleting the host deletes their decisions'
);

select * from finish();
rollback;
