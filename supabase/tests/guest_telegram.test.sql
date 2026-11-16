-- Guest Telegram schema (guest-telegram-link design 1): a request's link attempt
-- and a guest binding may be Telegram; a binding's sealed Telegram name lives
-- only beside its sealed sender and is cleared with it. Everything runs in a
-- rolled-back transaction.
begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

insert into app.host_accounts (id) values ('00000000-0000-4000-8000-0000000000c3');
insert into app.requests (id, host_account_id, requester_name, contact_email, expires_at)
values ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000c3', 'Grace', 'grace@example.test', now() + interval '7 days'),
       ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000c3', 'Grace', 'grace@example.test', now() + interval '7 days');

select lives_ok(
  $$ insert into app.imessage_links (request_id, channel, method, code_hash, expires_at)
     values ('00000000-0000-4000-8000-0000000000f1', 'telegram', 'code', repeat('7', 64), now() + interval '15 minutes') $$,
  'a guest may start a Telegram link'
);

select throws_ok(
  $$ insert into app.imessage_links (request_id, channel, method, code_hash, line_number, expires_at)
     values ('00000000-0000-4000-8000-0000000000f2', 'telegram', 'code', repeat('8', 64), '+15550009999', now() + interval '15 minutes') $$,
  '23514', null, 'a Telegram attempt keeps no line number'
);

select lives_ok(
  $$ insert into app.requester_imessage_bindings (request_id, channel, sender_hash, sender_ciphertext, sender_name_ciphertext, sealed_key_id)
     values ('00000000-0000-4000-8000-0000000000f1', 'telegram', repeat('c', 64), 'sealed', 'sealed-name', 'k') $$,
  'a guest binding may be Telegram, with its sender''s sealed name'
);

insert into app.requester_imessage_bindings (request_id, channel, sender_hash, sender_ciphertext, sender_name_ciphertext, sealed_key_id, state, ended_at)
values ('00000000-0000-4000-8000-0000000000f2', 'telegram', repeat('d', 64), null, 'sealed-name', 'k', 'unlinked', now());

select is(
  (select sender_name_ciphertext from app.requester_imessage_bindings where request_id = '00000000-0000-4000-8000-0000000000f2'),
  null,
  'a binding without a sealed sender keeps no sealed name'
);

update app.requester_imessage_bindings
set state = 'unlinked', ended_at = now(), sender_ciphertext = null, space_ciphertext = null
where request_id = '00000000-0000-4000-8000-0000000000f1';

select is(
  (select sender_name_ciphertext from app.requester_imessage_bindings where request_id = '00000000-0000-4000-8000-0000000000f1'),
  null,
  'unlinking clears the sealed name with the sender'
);

select is(
  (select channel from app.requester_imessage_bindings where request_id = '00000000-0000-4000-8000-0000000000f1'),
  'telegram',
  'the ended binding keeps its channel'
);

select * from finish();
