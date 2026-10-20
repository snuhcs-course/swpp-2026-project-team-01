-- Host onboarding schema: the maintenance and operator functions stay with the
-- owner, the cleanup pass is scheduled, and the handle registry enforces the
-- format and never reassigns a handle.
begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select ok(
  not has_function_privilege('anon', 'app.cleanup_calendar_analyses(integer)', 'execute')
    and not has_function_privilege('authenticated', 'app.cleanup_calendar_analyses(integer)', 'execute'),
  'Data API roles cannot run the analysis cleanup'
);

select ok(
  not has_function_privilege('anon', 'app.operator_set_host_status(text, text, text, text, text)', 'execute')
    and not has_function_privilege('authenticated', 'app.operator_set_host_status(text, text, text, text, text)', 'execute'),
  'Data API roles cannot change a host status'
);

select is(
  (select schedule from cron.job where jobname = 'app-analysis-cleanup'),
  '*/15 * * * *',
  'the analysis cleanup runs every 15 minutes'
);

insert into app.host_accounts (id) values
  ('00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000b2');

select throws_ok(
  $$ insert into app.host_handles (handle, host_account_id) values ('Alice', '00000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'an uppercase handle violates the format'
);

select throws_ok(
  $$ insert into app.host_handles (handle, host_account_id) values ('ab', '00000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'a two-character handle violates the format'
);

select throws_ok(
  $$ insert into app.host_handles (handle, host_account_id) values ('al--ice', '00000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'a double hyphen violates the format'
);

select lives_ok(
  $$ insert into app.host_handles (handle, host_account_id) values ('alice', '00000000-0000-4000-8000-0000000000a1') $$,
  'a valid handle is assigned'
);

update app.host_handles set released_at = now() where handle = 'alice';

select throws_ok(
  $$ insert into app.host_handles (handle, host_account_id) values ('alice', '00000000-0000-4000-8000-0000000000b2') $$,
  '23505', null, 'a released handle cannot be assigned to another host'
);

select lives_ok(
  $$ insert into app.host_handles (handle, host_account_id) values ('alice-two', '00000000-0000-4000-8000-0000000000a1') $$,
  'a host can hold a new current handle after releasing one'
);

select throws_ok(
  $$ insert into app.host_handles (handle, host_account_id) values ('alice-three', '00000000-0000-4000-8000-0000000000a1') $$,
  '23505', null, 'a host has at most one current handle'
);

select is(
  (select result_status from app.operator_set_host_status('alice-two', 'suspended', 'test-operator', 'pgTAP check', 'local')),
  'suspended',
  'the operator function suspends by current handle'
);

select is(
  (select count(*)::integer from app.operator_actions
   where host_account_id = '00000000-0000-4000-8000-0000000000a1' and action = 'suspend' and previous_status = 'active'),
  1,
  'the suspension is audited with the previous status'
);

select * from finish();

rollback;
