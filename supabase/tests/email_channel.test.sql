-- Requester email channel schema: the Data API roles reach none of the email
-- tables, each enables row-level security, and the record constraints hold (one
-- enabled receiver per inbox, one receipt per provider event, delivery and
-- message; one active binding per thread and per request; one pending link
-- code per request; final replies hold no text) and the retention cleanup
-- removes only what is past 30 days. Everything runs in a rolled-back transaction.
begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

select is_empty(
  $$
    select r.rolname || ' on ' || t.name
    from unnest(array['email_receivers', 'email_receipts', 'email_threads', 'email_links', 'email_replies']) as t(name)
    cross join pg_roles r
    where r.rolname in ('anon', 'authenticated')
      and has_table_privilege(r.oid, ('app.' || t.name)::regclass, 'select, insert, update, delete, truncate, references, trigger')
  $$,
  'anon and authenticated hold no privilege on the email tables'
);

select is_empty(
  $$
    select t.name
    from unnest(array['email_receivers', 'email_receipts', 'email_threads', 'email_links', 'email_replies']) as t(name)
    join pg_class c on c.oid = ('app.' || t.name)::regclass
    where not c.relrowsecurity
  $$,
  'every email table enables row-level security'
);

insert into app.email_receivers (id, inbox_id, webhook_id, secret_fingerprint, operator, environment)
values ('00000000-0000-4000-8000-0000000000e1', 'inbox@example.test', 'ep_1', repeat('a', 64), 'tester', 'local');

select throws_ok(
  $$ insert into app.email_receivers (inbox_id, webhook_id, secret_fingerprint, operator, environment)
     values ('inbox@example.test', 'ep_2', repeat('b', 64), 'tester', 'local') $$,
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

insert into app.host_accounts (id) values ('00000000-0000-4000-8000-0000000000b7');
insert into app.requests (id, host_account_id, state, requester_name, contact_email, expires_at, created_at)
values ('00000000-0000-4000-8000-0000000000c7', '00000000-0000-4000-8000-0000000000b7', 'gathering', 'Guest', 'guest@example.test', now() + interval '1 day', now() - interval '31 days'),
       ('00000000-0000-4000-8000-0000000000c8', '00000000-0000-4000-8000-0000000000b7', 'gathering', 'Guest', 'guest@example.test', now() + interval '1 day', now());
insert into app.email_threads (request_id, inbox_id, thread_id, origin, sender_hash, bound_by_receipt_id, last_message_id)
values ('00000000-0000-4000-8000-0000000000c7', 'inbox@example.test', 'thr_old', 'started', repeat('a', 64), gen_random_uuid(), '<m@x>'),
       ('00000000-0000-4000-8000-0000000000c8', 'inbox@example.test', 'thr_new', 'linked', repeat('a', 64), gen_random_uuid(), '<m@x>');

select throws_ok(
  $$ insert into app.email_threads (request_id, inbox_id, thread_id, origin, sender_hash, bound_by_receipt_id, last_message_id)
     values ('00000000-0000-4000-8000-0000000000c8', 'inbox@example.test', 'thr_other', 'linked', repeat('a', 64), gen_random_uuid(), '<m@x>') $$,
  '23505', null, 'a request has one active thread'
);

insert into app.email_links (request_id, code_hash, code_ciphertext, code_key_id, expires_at)
values ('00000000-0000-4000-8000-0000000000c8', repeat('1', 64), 'sealed', 'k', now() + interval '30 minutes');

select throws_ok(
  $$ insert into app.email_links (request_id, code_hash, code_ciphertext, code_key_id, expires_at)
     values ('00000000-0000-4000-8000-0000000000c8', repeat('2', 64), 'sealed', 'k', now() + interval '30 minutes') $$,
  '23505', null, 'a request has one pending link code'
);

select throws_ok(
  $$ insert into app.email_replies (kind, dedupe_key, inbox_id, reply_to_message_id, text, state, completed_at)
     values ('closed', 'x', 'inbox@example.test', '<m@x>', 'kept text', 'accepted', now()) $$,
  '23514', null, 'a final reply holds no text'
);

update app.email_receipts set received_at = now() - interval '31 days' where event_id = 'evt_1';

select is(app.cleanup_email_records(500), 2, 'the cleanup removes two rows');

-- A later statement, so its snapshot sees the cleanup's deletions.
select ok(
  not exists (select 1 from app.email_threads where thread_id = 'thr_old')
    and exists (select 1 from app.email_threads where thread_id = 'thr_new')
    and not exists (select 1 from app.email_receipts where event_id = 'evt_1'),
  'the cleanup removes the old binding and receipt and keeps the recent binding'
);

select * from finish();
rollback;
