-- Telegram decision buttons in the outbox (host-telegram-channel design 7, D8
-- and D9): a Telegram row may name the buttons it was sent with, which outlive
-- the row's final state; no other channel's row may; an edit_markup or
-- callback_answer row is Telegram only. Everything runs in a rolled-back
-- transaction.
begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select lives_ok(
  $$ insert into app.imessage_outbox (channel, kind, dedupe_key, recipient_hash, text_ciphertext, sealed_key_id, buttons)
     values ('telegram', 'notice', 'tgb1', repeat('f', 64), 'sealed', 'k', '{"kind":"decision","ref":"K7Q2MX","version":1}') $$,
  'a Telegram row carries decision buttons'
);

select lives_ok(
  $$ update app.imessage_outbox set state = 'accepted', provider_message_id = '42', recipient_ciphertext = null, text_ciphertext = null,
       completed_at = now() where dedupe_key = 'tgb1' $$,
  'the buttons stay once the row is final'
);

select throws_ok(
  $$ insert into app.imessage_outbox (channel, kind, dedupe_key, recipient_hash, buttons)
     values ('imessage', 'notice', 'tgb2', repeat('f', 64), '{"kind":"decision","ref":"K7Q2MX","version":1}') $$,
  '23514', null, 'an iMessage row carries no buttons'
);

select throws_ok(
  $$ insert into app.imessage_outbox (channel, kind, dedupe_key, recipient_hash, buttons)
     values ('telegram', 'notice', 'tgb3', repeat('f', 64), '{"kind":"anything"}') $$,
  '23514', null, 'buttons are a decision or a settings confirmation'
);

select lives_ok(
  $$ insert into app.imessage_outbox (channel, kind, dedupe_key, recipient_hash, text_ciphertext, sealed_key_id)
     values ('telegram', 'edit_markup', 'edit:tgb1', repeat('f', 64), 'sealed', 'k'),
            ('telegram', 'callback_answer', 'receipt:tgb:answer', repeat('f', 64), 'sealed', 'k') $$,
  'Telegram queues edits and callback answers'
);

select throws_ok(
  $$ insert into app.imessage_outbox (channel, kind, dedupe_key, recipient_hash)
     values ('whatsapp', 'edit_markup', 'edit:tgb4', repeat('f', 64)) $$,
  '23514', null, 'an edit is Telegram only'
);

select * from finish();
rollback;
