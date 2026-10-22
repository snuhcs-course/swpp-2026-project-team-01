-- Requester email channel schema: the Data API roles reach none of the email
-- tables, each enables row-level security, and the record constraints hold (one
-- enabled receiver per inbox, one receipt per provider event, delivery and
-- message). Everything runs in a rolled-back transaction.
begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select is_empty(
  $$
    select r.rolname || ' on ' || t.name
    from unnest(array['email_receivers', 'email_receipts']) as t(name)
    cross join pg_roles r
    where r.rolname in ('anon', 'authenticated')
      and has_table_privilege(r.oid, ('app.' || t.name)::regclass, 'select, insert, update, delete, truncate, references, trigger')
  $$,
  'anon and authenticated hold no privilege on the email tables'
);

select is_empty(
  $$
    select t.name
    from unnest(array['email_receivers', 'email_receipts']) as t(name)
    join pg_class c on c.oid = ('app.' || t.name)::regclass
    where not c.relrowsecurity
  $$,
  'every email table enables row-level security'
);

insert into app.email_receivers (id, inbox_id, webhook_id, secret_fingerprint, operator)
values ('00000000-0000-4000-8000-0000000000e1', 'inbox@example.test', 'ep_1', repeat('a', 64), 'tester');

select throws_ok(
  $$ insert into app.email_receivers (inbox_id, webhook_id, secret_fingerprint, operator)
     values ('inbox@example.test', 'ep_2', repeat('b', 64), 'tester') $$,
  '23505', null, 'only one enabled receiver per inbox'
);

insert into app.email_receipts (receiver_id, event_id, delivery_id, event_type, inbox_id, thread_id, message_id, payload_sha256)
values ('00000000-0000-4000-8000-0000000000e1', 'evt_1', 'msg_1', 'message.received', 'inbox@example.test', 'thr_1', '<m1@example.test>', repeat('c', 64));

select throws_ok(
  $$ insert into app.email_receipts (receiver_id, event_id, delivery_id, event_type, inbox_id, thread_id, message_id, payload_sha256)
     values ('00000000-0000-4000-8000-0000000000e1', 'evt_2', 'msg_2', 'message.received', 'inbox@example.test', 'thr_1', '<m1@example.test>', repeat('c', 64)) $$,
  '23505', null, 'one receipt per inbox message'
);

select throws_ok(
  $$ insert into app.email_receipts (receiver_id, event_id, delivery_id, event_type, inbox_id, thread_id, message_id, payload_sha256)
     values ('00000000-0000-4000-8000-0000000000e1', 'evt_1', 'msg_3', 'message.received', 'inbox@example.test', 'thr_2', '<m2@example.test>', repeat('d', 64)) $$,
  '23505', null, 'one receipt per provider event'
);

select throws_ok(
  $$ insert into app.email_receipts (receiver_id, event_id, delivery_id, event_type, inbox_id, thread_id, message_id, payload_sha256)
     values ('00000000-0000-4000-8000-0000000000e1', 'evt_4', 'msg_4', 'message.sent', 'inbox@example.test', 'thr_3', '<m3@example.test>', repeat('e', 64)) $$,
  '23514', null, 'only received messages are stored'
);

select * from finish();
rollback;
