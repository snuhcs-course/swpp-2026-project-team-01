-- Requester intake and feasibility schema: the Data API roles reach none of the
-- new tables or the expiry function, the expiry schedule publishes one job only
-- when a request is due, and the record constraints hold. Everything runs in a
-- rolled-back transaction.
begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

select is_empty(
  $$
    select r.rolname || ' on ' || t.name
    from unnest(array[
      'intakes', 'requests', 'booking_links', 'request_creations', 'requester_oauth_transactions',
      'requester_grants', 'request_reviews', 'proposals', 'agreements', 'evaluations', 'travel_allowances',
      'route_estimates', 'contact_confirmations', 'email_deliveries', 'link_resend_issuances',
      'link_resend_attempts', 'admission_windows', 'resend_budget'
    ]) as t(name)
    cross join pg_roles r
    where r.rolname in ('anon', 'authenticated')
      and has_table_privilege(r.oid, ('app.' || t.name)::regclass, 'select, insert, update, delete, truncate, references, trigger')
  $$,
  'anon and authenticated hold no privilege on the new tables'
);

select is_empty(
  $$
    select t.name
    from unnest(array[
      'intakes', 'requests', 'booking_links', 'request_creations', 'requester_oauth_transactions',
      'requester_grants', 'request_reviews', 'proposals', 'agreements', 'evaluations', 'travel_allowances',
      'route_estimates', 'contact_confirmations', 'email_deliveries', 'link_resend_issuances',
      'link_resend_attempts', 'admission_windows', 'resend_budget'
    ]) as t(name)
    join pg_class c on c.oid = ('app.' || t.name)::regclass
    where not c.relrowsecurity
  $$,
  'every new table enables row-level security'
);

select ok(
  not has_function_privilege('anon', 'app.publish_request_expiry()', 'execute')
    and not has_function_privilege('authenticated', 'app.publish_request_expiry()', 'execute'),
  'Data API roles cannot run the expiry publication'
);

select is(
  (select command from cron.job where jobname = 'app-request-expiry'),
  'select app.publish_request_expiry()',
  'pg_cron runs the expiry publication'
);

select is(
  (select schedule from cron.job where jobname = 'app-request-expiry'),
  '*/5 * * * *',
  'the expiry publication runs every 5 minutes'
);

set local role anon;
select throws_ok('select * from app.requests', '42501', null, 'anon cannot read requests');
select throws_ok('select * from app.booking_links', '42501', null, 'anon cannot read booking links');
select throws_ok('select * from app.intakes', '42501', null, 'anon cannot read intakes');
select throws_ok('select app.publish_request_expiry()', '42501', null, 'anon cannot publish request expiry');
reset role;

set local role authenticated;
select throws_ok('select * from app.requests', '42501', null, 'authenticated cannot read requests');
select throws_ok('select * from app.requester_grants', '42501', null, 'authenticated cannot read requester grants');
select throws_ok('select * from app.email_deliveries', '42501', null, 'authenticated cannot read email deliveries');
select throws_ok('select app.publish_request_expiry()', '42501', null, 'authenticated cannot publish request expiry');
reset role;

-- A sandbox: no worker entries in Vault, so the job is produced for local.
delete from vault.secrets where name in ('worker_url', 'worker_secret');
delete from app.jobs where kind = 'request_expiry';

insert into app.host_accounts (id) values ('00000000-0000-4000-8000-0000000000c3');

insert into app.requests (id, host_account_id, requester_name, contact_email, expires_at) values
  ('00000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000c3', 'Requester', 'r@example.com',
   now() + interval '1 day');

select is(app.publish_request_expiry(), false, 'nothing is published while no request is due');

update app.requests set expires_at = now() - interval '1 minute' where id = '00000000-0000-4000-8000-0000000000d4';

select is(app.publish_request_expiry(), true, 'a due request publishes an expiry job');

select is(
  (select producer_environment from app.jobs where kind = 'request_expiry'),
  'local',
  'without the worker in Vault the job is produced for local'
);

select is(app.publish_request_expiry(), false, 'a pending expiry job is not duplicated');

select throws_ok(
  $$ update app.requests set state = 'withdrawn' where id = '00000000-0000-4000-8000-0000000000d4' $$,
  '23514', null, 'a closed state needs closed_at'
);

select throws_ok(
  $$ update app.requests set state = 'pending_review' where id = '00000000-0000-4000-8000-0000000000d4' $$,
  '23514', null, 'an unknown request state is rejected'
);

select throws_ok(
  $$ update app.requests set contact_confirmed_email = 'other@example.com' where id = '00000000-0000-4000-8000-0000000000d4' $$,
  '23514', null, 'only the current contact can be confirmed'
);

select throws_ok(
  $$ insert into app.request_reviews (request_id, base_revision, intent)
     values ('00000000-0000-4000-8000-0000000000d4', 1, 'question') $$,
  '23514', null, 'a question review needs a clarification'
);

select throws_ok(
  $$ insert into app.request_reviews (request_id, base_revision, intent, clarifications)
     values ('00000000-0000-4000-8000-0000000000d4', 1, 'question', array['missing_weather']) $$,
  '23514', null, 'an unknown clarification category is rejected'
);

insert into app.request_reviews (request_id, base_revision, intent, patch)
values ('00000000-0000-4000-8000-0000000000d4', 1, 'details', '{"purpose": "Coffee"}');

select throws_ok(
  $$ insert into app.request_reviews (request_id, base_revision, intent, clarifications)
     values ('00000000-0000-4000-8000-0000000000d4', 1, 'unknown', array['missing_date']) $$,
  '23505', null, 'a request has at most one pending review'
);

select throws_ok(
  $$ insert into app.email_deliveries
       (kind, request_id, sender, recipients, template, language, secret_ciphertext, secret_key_id, state, completed_at)
     values ('link_resend', '00000000-0000-4000-8000-0000000000d4', 'no-reply@findmeatime.com', array['r@example.com'],
       'link_resend', 'en', 'sealed', 'key', 'accepted', now()) $$,
  '23514', null, 'a final delivery holds no sealed secret'
);

select throws_ok(
  $$ insert into app.travel_allowances
       (request_id, party, candidate_start, candidate_end, direction, origin_hash, destination_hash, mode, minutes, confirmed_by)
     values ('00000000-0000-4000-8000-0000000000d4', 'requester', now(), now() + interval '1 hour', 'inbound',
       'a', 'b', 'transit', 7, 'requester') $$,
  '23514', null, 'an allowance is in 5-minute steps'
);

select * from finish();

rollback;
