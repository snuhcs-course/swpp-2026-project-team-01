-- Guest WhatsApp schema (guest-whatsapp-link design 1): a request's link attempt
-- may be iMessage or WhatsApp but not Telegram; only an iMessage attempt keeps
-- Photon's assigned line number; a guest binding records its channel, iMessage
-- by default. Everything runs in a rolled-back transaction.
begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

insert into app.host_accounts (id) values ('00000000-0000-4000-8000-0000000000c2');
insert into app.requests (id, host_account_id, requester_name, contact_email, expires_at)
values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000c2', 'Grace', 'grace@example.test', now() + interval '7 days'),
       ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000c2', 'Grace', 'grace@example.test', now() + interval '7 days');

select lives_ok(
  $$ insert into app.imessage_links (request_id, channel, method, code_hash, expires_at)
     values ('00000000-0000-4000-8000-0000000000e1', 'whatsapp', 'code', repeat('4', 64), now() + interval '15 minutes') $$,
  'a guest may start a WhatsApp link'
);

select throws_ok(
  $$ insert into app.imessage_links (request_id, channel, method, code_hash, expires_at)
     values ('00000000-0000-4000-8000-0000000000e2', 'telegram', 'code', repeat('5', 64), now() + interval '15 minutes') $$,
  '23514', null, 'a guest may not start a Telegram link'
);

select throws_ok(
  $$ insert into app.imessage_links (host_account_id, channel, method, code_hash, line_number, expires_at)
     values ('00000000-0000-4000-8000-0000000000c2', 'whatsapp', 'code', repeat('6', 64), '+15550009999', now() + interval '15 minutes') $$,
  '23514', null, 'a WhatsApp attempt keeps no assigned line number'
);

insert into app.requester_imessage_bindings (request_id, sender_hash, sender_ciphertext, sealed_key_id)
values ('00000000-0000-4000-8000-0000000000e1', repeat('a', 64), 'sealed', 'k');

select is(
  (select channel from app.requester_imessage_bindings where request_id = '00000000-0000-4000-8000-0000000000e1'),
  'imessage',
  'a guest binding is iMessage by default'
);

select lives_ok(
  $$ insert into app.requester_imessage_bindings (request_id, channel, sender_hash, sender_ciphertext, sealed_key_id)
     values ('00000000-0000-4000-8000-0000000000e2', 'whatsapp', repeat('b', 64), 'sealed', 'k') $$,
  'a guest binding may be WhatsApp'
);

select throws_ok(
  $$ update app.requester_imessage_bindings set channel = 'telegram' where request_id = '00000000-0000-4000-8000-0000000000e2' $$,
  '23514', null, 'a guest binding may not be Telegram'
);

select * from finish();
