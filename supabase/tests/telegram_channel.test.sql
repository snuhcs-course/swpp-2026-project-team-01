-- Host Telegram channel schema (host-telegram-channel design 4 and 5): the four
-- iMessage tables name Telegram as a third channel; a host still has one active
-- binding across all three; a fallback attempt stays iMessage, a guest's attempt
-- stays iMessage and a template row stays WhatsApp. Everything runs in a
-- rolled-back transaction.
begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

insert into app.host_accounts (id) values ('00000000-0000-4000-8000-0000000000d1');

select lives_ok(
  $$ insert into app.imessage_receipts (channel, message_id, webhook_id, sender_hash, space_hash, space_type, content_type, payload_sha256)
     values ('telegram', 'update:1', 'telegram', repeat('a', 64), repeat('a', 64), 'dm', 'text', repeat('b', 64)) $$,
  'a Telegram receipt is stored'
);

select lives_ok(
  $$ insert into app.imessage_links (channel, host_account_id, method, code_hash, expires_at)
     values ('telegram', '00000000-0000-4000-8000-0000000000d1', 'code', repeat('c', 64), now() + interval '10 minutes') $$,
  'a host may start a Telegram code attempt'
);

select lives_ok(
  $$ insert into app.imessage_bindings (channel, host_account_id, sender_hash, sender_ciphertext, sealed_key_id)
     values ('telegram', '00000000-0000-4000-8000-0000000000d1', repeat('d', 64), 'sealed', 'k') $$,
  'a host may bind a Telegram sender'
);

select throws_ok(
  $$ insert into app.imessage_bindings (channel, host_account_id, sender_hash, sender_ciphertext, sealed_key_id)
     values ('imessage', '00000000-0000-4000-8000-0000000000d1', repeat('e', 64), 'sealed', 'k') $$,
  '23505', null, 'a host has one active binding across iMessage, WhatsApp and Telegram'
);

select lives_ok(
  $$ insert into app.imessage_outbox (channel, kind, dedupe_key, recipient_hash, text_ciphertext, sealed_key_id)
     values ('telegram', 'notice', 'tg1', repeat('f', 64), 'sealed', 'k') $$,
  'a Telegram outbox row is queued'
);

select throws_ok(
  $$ insert into app.imessage_outbox (channel, kind, template_name, dedupe_key, recipient_hash)
     values ('telegram', 'template', 'fmat_proposal_waiting', 'tg2', repeat('f', 64)) $$,
  '23514', null, 'a template row is WhatsApp only, never Telegram'
);

select throws_ok(
  $$ insert into app.imessage_links (channel, host_account_id, method, phone_hash, expires_at)
     values ('telegram', '00000000-0000-4000-8000-0000000000d1', 'fallback', repeat('9', 64), now() + interval '10 minutes') $$,
  '23514', null, 'the fallback code is iMessage only, never Telegram'
);

select throws_ok(
  $$ insert into app.imessage_receipts (channel, message_id, webhook_id, sender_hash, space_hash, space_type, content_type, payload_sha256)
     values ('signal', 'msg_signal', 'wh', repeat('8', 64), repeat('8', 64), 'dm', 'text', repeat('7', 64)) $$,
  '23514', null, 'a channel other than iMessage, WhatsApp or Telegram is refused'
);

select * from finish();
