-- The schedule image in the outbox (messenger-schedule-image design 1): a
-- schedule_image row goes out on any channel without a settings review hash,
-- and only an image row (the settings preview) carries one. Everything runs in a
-- rolled-back transaction.
begin;

create extension if not exists pgtap with schema extensions;

select plan(3);

select lives_ok(
  $$ insert into app.imessage_outbox (channel, kind, dedupe_key, recipient_hash, text_ciphertext, sealed_key_id)
     values ('imessage', 'schedule_image', 'si1', repeat('f', 64), 'sealed', 'k'),
            ('whatsapp', 'schedule_image', 'si2', repeat('f', 64), 'sealed', 'k'),
            ('telegram', 'schedule_image', 'si3', repeat('f', 64), 'sealed', 'k') $$,
  'a schedule image is queued on every channel'
);

select throws_ok(
  $$ insert into app.imessage_outbox (channel, kind, dedupe_key, recipient_hash, review_hash)
     values ('imessage', 'schedule_image', 'si4', repeat('f', 64), repeat('a', 64)) $$,
  '23514', null, 'a schedule image is not a settings review'
);

select throws_ok(
  $$ insert into app.imessage_outbox (channel, kind, dedupe_key, recipient_hash)
     values ('imessage', 'image', 'si5', repeat('f', 64)) $$,
  '23514', null, 'a settings preview still needs its review hash'
);

select * from finish();
rollback;
