-- Host WhatsApp channel schema (host-whatsapp-channel design 4 and 5): the four
-- iMessage tables carry a channel that defaults to iMessage and names only
-- iMessage or WhatsApp; a host has one active binding across both channels; a
-- fallback attempt stays iMessage; a template row is a WhatsApp row with a
-- template name, and only a template row names one. Everything runs in a
-- rolled-back transaction.
begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

insert into app.host_accounts (id) values ('00000000-0000-4000-8000-0000000000c1');

insert into app.imessage_bindings (host_account_id, sender_hash, sender_ciphertext, sealed_key_id)
values ('00000000-0000-4000-8000-0000000000c1', repeat('a', 64), 'sealed', 'k');

select is(
  (select channel from app.imessage_bindings where sender_hash = repeat('a', 64)),
  'imessage',
  'a row written without a channel is iMessage, as every row before this change'
);

select throws_ok(
  $$ insert into app.imessage_receipts (channel, message_id, webhook_id, sender_hash, space_hash, space_type, content_type, payload_sha256)
     values ('sms', 'msg_sms', 'wh', repeat('b', 64), repeat('b', 64), 'dm', 'text', repeat('c', 64)) $$,
  '23514', null, 'a channel other than iMessage or WhatsApp is refused'
);

select throws_ok(
  $$ insert into app.imessage_bindings (channel, host_account_id, sender_hash, sender_ciphertext, sealed_key_id)
     values ('whatsapp', '00000000-0000-4000-8000-0000000000c1', repeat('d', 64), 'sealed', 'k') $$,
  '23505', null, 'a host has one active binding across iMessage and WhatsApp'
);

select throws_ok(
  $$ insert into app.imessage_links (channel, host_account_id, method, phone_hash, expires_at)
     values ('whatsapp', '00000000-0000-4000-8000-0000000000c1', 'fallback', repeat('e', 64), now() + interval '10 minutes') $$,
  '23514', null, 'the fallback code is iMessage only'
);

select lives_ok(
  $$ insert into app.imessage_outbox (channel, kind, template_name, dedupe_key, recipient_hash, text_ciphertext, sealed_key_id)
     values ('whatsapp', 'template', 'fmat_proposal_waiting', 't1', repeat('f', 64), 'sealed', 'k') $$,
  'a WhatsApp template row names its template'
);

select throws_ok(
  $$ insert into app.imessage_outbox (kind, template_name, dedupe_key, recipient_hash)
     values ('template', 'fmat_proposal_waiting', 't2', repeat('f', 64)) $$,
  '23514', null, 'a template row is WhatsApp only'
);

select throws_ok(
  $$ insert into app.imessage_outbox (channel, kind, template_name, dedupe_key, recipient_hash)
     values ('whatsapp', 'notice', 'fmat_proposal_waiting', 't3', repeat('f', 64)) $$,
  '23514', null, 'only a template row names a template'
);

select * from finish();
