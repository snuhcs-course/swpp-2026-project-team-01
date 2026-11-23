-- The host's notes for Thyme (host-preference-notes): at most 1000 characters,
-- null until answered, and cleared when the account is marked deleted.
-- Everything runs in a rolled-back transaction.
begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

insert into app.host_accounts (id) values ('00000000-0000-4000-8000-0000000000d1');

select is(
  (select assistant_notes from app.host_accounts where id = '00000000-0000-4000-8000-0000000000d1'),
  null,
  'a new host has not answered the notes step'
);

select lives_ok(
  $$ update app.host_accounts set assistant_notes = 'A first meeting is online.', assistant_notes_updated_at = now()
     where id = '00000000-0000-4000-8000-0000000000d1' $$,
  'a host may save notes'
);

select throws_ok(
  $$ update app.host_accounts set assistant_notes = repeat('x', 1001) where id = '00000000-0000-4000-8000-0000000000d1' $$,
  '23514', null, 'notes are at most 1000 characters'
);

update app.host_accounts
set status = 'suspended', display_name = null, deleted_at = now()
where id = '00000000-0000-4000-8000-0000000000d1';

select is(
  (select assistant_notes from app.host_accounts where id = '00000000-0000-4000-8000-0000000000d1'),
  null,
  'marking the account deleted clears its notes'
);

select is(
  (select assistant_notes_updated_at from app.host_accounts where id = '00000000-0000-4000-8000-0000000000d1'),
  null,
  'and when they were saved'
);

select * from finish();
rollback;
