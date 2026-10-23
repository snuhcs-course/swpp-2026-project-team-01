-- Host iMessage channel schema: the Data API roles reach none of the iMessage
-- tables, each enables row-level security, and the record constraints hold (one
-- receipt per provider message; one open link attempt per host; one active
-- binding per host and per sender; final outbound rows and processed receipts
-- hold no sealed value) and the retention cleanup removes only what is past its
-- period. Everything runs in a rolled-back transaction.
begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

select is_empty(
  $$
    select r.rolname || ' on ' || t.name
    from unnest(array['imessage_receipts', 'imessage_links', 'imessage_bindings', 'imessage_outbox']) as t(name)
    cross join pg_roles r
    where r.rolname in ('anon', 'authenticated')
      and has_table_privilege(r.oid, ('app.' || t.name)::regclass, 'select, insert, update, delete, truncate, references, trigger')
  $$,
  'anon and authenticated hold no privilege on the iMessage tables'
);

select is_empty(
  $$
    select t.name
    from unnest(array['imessage_receipts', 'imessage_links', 'imessage_bindings', 'imessage_outbox']) as t(name)
    join pg_class c on c.oid = ('app.' || t.name)::regclass
    where not c.relrowsecurity
  $$,
  'every iMessage table enables row-level security'
);

insert into app.imessage_receipts
  (message_id, webhook_id, sender_hash, space_hash, space_type, content_type, payload_sha256, text_ciphertext, sender_ciphertext, space_ciphertext, sealed_key_id)
values ('msg_1', 'wh_1', repeat('a', 64), repeat('b', 64), 'dm', 'text', repeat('c', 64), 't', 's', 'p', 'k');

select throws_ok(
  $$ insert into app.imessage_receipts (message_id, webhook_id, sender_hash, space_hash, space_type, content_type, payload_sha256)
     values ('msg_1', 'wh_2', repeat('a', 64), repeat('b', 64), 'dm', 'text', repeat('d', 64)) $$,
  '23505', null, 'one receipt per provider message'
);

select throws_ok(
  $$ update app.imessage_receipts set outcome = 'forwarded', processed_at = now() where message_id = 'msg_1' $$,
  '23514', null, 'a processed receipt holds no sealed text'
);

insert into app.host_accounts (id) values ('00000000-0000-4000-8000-0000000000b1'), ('00000000-0000-4000-8000-0000000000b2');

insert into app.imessage_links (host_account_id, method, code_hash, code_ciphertext, sealed_key_id, expires_at)
values ('00000000-0000-4000-8000-0000000000b1', 'code', repeat('1', 64), 'sealed', 'k', now() + interval '15 minutes');

select throws_ok(
  $$ insert into app.imessage_links (host_account_id, method, code_hash, expires_at)
     values ('00000000-0000-4000-8000-0000000000b1', 'code', repeat('2', 64), now() + interval '15 minutes') $$,
  '23505', null, 'a host has one open link attempt'
);

select throws_ok(
  $$ insert into app.imessage_links (host_account_id, method, code_hash, phone_hash, expires_at)
     values ('00000000-0000-4000-8000-0000000000b2', 'fallback', repeat('3', 64), repeat('4', 64), now() + interval '10 minutes') $$,
  '23514', null, 'a fallback attempt holds a number, not a link code'
);

insert into app.imessage_bindings (host_account_id, sender_hash, sender_ciphertext, sealed_key_id)
values ('00000000-0000-4000-8000-0000000000b1', repeat('e', 64), 'sealed', 'k');

select throws_ok(
  $$ insert into app.imessage_bindings (host_account_id, sender_hash, sender_ciphertext, sealed_key_id)
     values ('00000000-0000-4000-8000-0000000000b2', repeat('e', 64), 'sealed', 'k') $$,
  '23505', null, 'a sender is bound to one host'
);

select throws_ok(
  $$ insert into app.imessage_bindings (host_account_id, sender_hash, sender_ciphertext, sealed_key_id)
     values ('00000000-0000-4000-8000-0000000000b1', repeat('f', 64), 'sealed', 'k') $$,
  '23505', null, 'a host has one active binding'
);

select throws_ok(
  $$ insert into app.imessage_outbox (kind, dedupe_key, recipient_hash, text_ciphertext, state, completed_at)
     values ('command', 'x', repeat('e', 64), 'kept', 'accepted', now()) $$,
  '23514', null, 'a final outbound message holds no sealed text'
);

insert into app.imessage_outbox (kind, dedupe_key, recipient_hash, state, completed_at, created_at)
values ('unlinked_sender', 'old', repeat('e', 64), 'accepted', now(), now() - interval '31 days'),
       ('unlinked_sender', 'new', repeat('e', 64), 'accepted', now(), now());
update app.imessage_receipts set received_at = now() - interval '31 days' where message_id = 'msg_1';
insert into app.imessage_bindings (host_account_id, sender_hash, state, linked_at, ended_at)
values ('00000000-0000-4000-8000-0000000000b2', repeat('9', 64), 'unlinked', now() - interval '40 days', now() - interval '31 days');
update app.imessage_links set expires_at = now() - interval '1 minute';

select is(app.cleanup_imessage_records(500), 3, 'the cleanup removes the old outbound message, receipt and ended binding');

select ok(
  not exists (select 1 from app.imessage_outbox where dedupe_key = 'old')
    and exists (select 1 from app.imessage_outbox where dedupe_key = 'new')
    and not exists (select 1 from app.imessage_receipts where message_id = 'msg_1')
    and exists (select 1 from app.imessage_bindings where state = 'active'),
  'recent outbound messages and active bindings remain'
);

select ok(
  (select state = 'expired' and code_ciphertext is null and ended_at is not null from app.imessage_links where code_hash = repeat('1', 64)),
  'an expired open attempt is ended and its sealed code cleared'
);

update app.imessage_links set ended_at = now() - interval '31 days' where code_hash = repeat('1', 64);

select is(app.cleanup_imessage_records(500), 1, 'an attempt that ended more than 30 days ago is deleted');

select * from finish();
rollback;
