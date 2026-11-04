-- A Telegram sender's sealed display name (host-telegram-channel design 3) is
-- kept only beside the sealed sender: clearing the sender clears the name, on a
-- link attempt and on a binding, whichever path ends it. Everything runs in a
-- rolled-back transaction.
begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

insert into app.host_accounts (id) values ('00000000-0000-4000-8000-0000000000e1');

insert into app.imessage_links (id, channel, host_account_id, method, code_hash, state, sender_hash, sender_ciphertext, sender_name_ciphertext,
                                space_ciphertext, sender_key_id, expires_at, confirm_by)
values ('00000000-0000-4000-8000-0000000000e2', 'telegram', '00000000-0000-4000-8000-0000000000e1', 'code', repeat('c', 64), 'received',
        repeat('d', 64), 'sealed', 'sealed-name', 'sealed', 'k', now() + interval '10 minutes', now() + interval '10 minutes');

update app.imessage_links
set state = 'voided', ended_at = now(), code_ciphertext = null, sender_ciphertext = null, space_ciphertext = null
where id = '00000000-0000-4000-8000-0000000000e2';

select is(
  (select sender_name_ciphertext from app.imessage_links where id = '00000000-0000-4000-8000-0000000000e2'),
  null,
  'ending an attempt clears the sender name with the sender'
);

insert into app.imessage_bindings (id, channel, host_account_id, sender_hash, sender_ciphertext, sender_name_ciphertext, sealed_key_id)
values ('00000000-0000-4000-8000-0000000000e3', 'telegram', '00000000-0000-4000-8000-0000000000e1', repeat('e', 64), 'sealed', 'sealed-name', 'k');

select is(
  (select sender_name_ciphertext from app.imessage_bindings where id = '00000000-0000-4000-8000-0000000000e3'),
  'sealed-name',
  'an active binding keeps the sealed name'
);

update app.imessage_bindings
set state = 'unlinked', ended_at = now(), sender_ciphertext = null, space_ciphertext = null
where id = '00000000-0000-4000-8000-0000000000e3';

select is(
  (select sender_name_ciphertext from app.imessage_bindings where id = '00000000-0000-4000-8000-0000000000e3'),
  null,
  'ending a binding clears the sender name with the sender'
);

with stored as (
  insert into app.imessage_bindings (channel, host_account_id, sender_hash, sender_ciphertext, sender_name_ciphertext, sealed_key_id, state, ended_at)
  values ('telegram', '00000000-0000-4000-8000-0000000000e1', repeat('f', 64), null, 'sealed-name', 'k', 'unlinked', now())
  returning sender_name_ciphertext
)
select is((select sender_name_ciphertext from stored), null, 'a name without a sender is never stored');

select * from finish();
rollback;
