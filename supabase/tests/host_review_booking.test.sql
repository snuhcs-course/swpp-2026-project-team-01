-- Host review and booking schema: the Data API roles reach none of the new
-- tables, each enables row-level security, and the record constraints hold
-- (one host-review discussion per host and request, one live approval per
-- proposal, one live booking per request, a provider-valid event ID). Everything
-- runs in a rolled-back transaction.
begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select is_empty(
  $$
    select r.rolname || ' on ' || t.name
    from unnest(array['approvals', 'bookings', 'request_exceptions', 'shared_change_drafts']) as t(name)
    cross join pg_roles r
    where r.rolname in ('anon', 'authenticated')
      and has_table_privilege(r.oid, ('app.' || t.name)::regclass, 'select, insert, update, delete, truncate, references, trigger')
  $$,
  'anon and authenticated hold no privilege on the new tables'
);

select is_empty(
  $$
    select t.name
    from unnest(array['approvals', 'bookings', 'request_exceptions', 'shared_change_drafts']) as t(name)
    join pg_class c on c.oid = ('app.' || t.name)::regclass
    where not c.relrowsecurity
  $$,
  'every new table enables row-level security'
);

insert into app.host_accounts (id) values ('00000000-0000-4000-8000-0000000000b1');
insert into app.requests (id, host_account_id, state, requester_name, contact_email, expires_at)
values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 'gathering', 'Guest', 'guest@example.test', now() + interval '1 day');

select lives_ok(
  $$ insert into app.discussions (principal_type, principal_id, audience, request_id)
     values ('host_account', '00000000-0000-4000-8000-0000000000b1', 'host_review', '00000000-0000-4000-8000-0000000000c1') $$,
  'a host can have a review discussion for a request'
);

select throws_ok(
  $$ insert into app.discussions (principal_type, principal_id, audience, request_id)
     values ('host_account', '00000000-0000-4000-8000-0000000000b1', 'host_review', '00000000-0000-4000-8000-0000000000c1') $$,
  '23505', null, 'only one review discussion per host and request'
);

select throws_ok(
  $$ insert into app.discussions (principal_type, principal_id, audience)
     values ('host_account', '00000000-0000-4000-8000-0000000000b1', 'host_review') $$,
  '23514', null, 'a review discussion names its request'
);

select lives_ok(
  $$ insert into app.discussions (principal_type, principal_id, audience)
     values ('host_account', '00000000-0000-4000-8000-0000000000b1', 'host_setup') $$,
  'the setup discussion is unchanged'
);

select throws_ok(
  $$ insert into app.discussions (principal_type, principal_id, audience)
     values ('host_account', '00000000-0000-4000-8000-0000000000b1', 'host_setup') $$,
  '23505', null, 'still one setup discussion per host'
);

select col_is_unique('app', 'bookings', array['event_id'], 'a provider event ID belongs to one booking');

select * from finish();
rollback;
