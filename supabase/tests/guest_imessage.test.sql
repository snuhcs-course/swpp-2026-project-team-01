-- Guest iMessage and revised request schema (guest-flow-completion design 1, 2
-- and 5): the Data API roles reach no guest binding, which enables row-level
-- security; a request owns at most one open link attempt and one active
-- binding, while a sender may be bound on several requests; an outbound message
-- names at most one kind of binding; a closed request has at most one revised
-- request; and the retention cleanup ends guest bindings after 30 days and
-- deletes them 30 days after they ended. Everything runs in a rolled-back
-- transaction.
begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

select is_empty(
  $$
    select r.rolname from pg_roles r
    where r.rolname in ('anon', 'authenticated')
      and has_table_privilege(r.oid, 'app.requester_imessage_bindings', 'select, insert, update, delete, truncate, references, trigger')
  $$,
  'anon and authenticated hold no privilege on guest bindings'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'app.requester_imessage_bindings'::regclass),
  'guest bindings enable row-level security'
);

insert into app.host_accounts (id) values ('00000000-0000-4000-8000-0000000000c1');
insert into app.requests (id, host_account_id, requester_name, contact_email, expires_at)
values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c1', 'Grace', 'grace@example.test', now() + interval '7 days'),
       ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000c1', 'Grace', 'grace@example.test', now() + interval '7 days');

insert into app.imessage_links (request_id, method, code_hash, code_ciphertext, sealed_key_id, expires_at)
values ('00000000-0000-4000-8000-0000000000d1', 'code', repeat('1', 64), 'sealed', 'k', now() + interval '15 minutes');

select throws_ok(
  $$ insert into app.imessage_links (request_id, method, code_hash, expires_at)
     values ('00000000-0000-4000-8000-0000000000d1', 'code', repeat('2', 64), now() + interval '15 minutes') $$,
  '23505', null, 'a request has one open link attempt'
);

select throws_ok(
  $$ insert into app.imessage_links (host_account_id, request_id, method, code_hash, expires_at)
     values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000d2', 'code', repeat('3', 64), now() + interval '15 minutes') $$,
  '23514', null, 'a link attempt belongs to a host or to a request, not both'
);

insert into app.requester_imessage_bindings (request_id, sender_hash, sender_ciphertext, sealed_key_id)
values ('00000000-0000-4000-8000-0000000000d1', repeat('e', 64), 'sealed', 'k');

select throws_ok(
  $$ insert into app.requester_imessage_bindings (request_id, sender_hash, sender_ciphertext, sealed_key_id)
     values ('00000000-0000-4000-8000-0000000000d1', repeat('f', 64), 'sealed', 'k') $$,
  '23505', null, 'a request has one active guest binding'
);

select lives_ok(
  $$ insert into app.requester_imessage_bindings (request_id, sender_hash, sender_ciphertext, sealed_key_id)
     values ('00000000-0000-4000-8000-0000000000d2', repeat('e', 64), 'sealed', 'k') $$,
  'a sender may be bound on several requests'
);

select throws_ok(
  $$ insert into app.imessage_outbox (kind, dedupe_key, recipient_hash, binding_id, requester_binding_id)
     select 'notice', 'both', repeat('e', 64), b.id, g.id
     from (select gen_random_uuid() as id) b, app.requester_imessage_bindings g limit 1 $$,
  '23514', null, 'an outbound message names at most one binding'
);

update app.requests set state = 'declined', closed_at = now() where id = '00000000-0000-4000-8000-0000000000d1';
update app.requests set revised_from_request_id = '00000000-0000-4000-8000-0000000000d1' where id = '00000000-0000-4000-8000-0000000000d2';

select throws_ok(
  $$ insert into app.requests (host_account_id, requester_name, contact_email, expires_at, revised_from_request_id)
     values ('00000000-0000-4000-8000-0000000000c1', 'Grace', 'grace@example.test', now() + interval '7 days', '00000000-0000-4000-8000-0000000000d1') $$,
  '23505', null, 'a closed request has one revised request'
);

update app.requester_imessage_bindings set created_at = now() - interval '31 days' where request_id = '00000000-0000-4000-8000-0000000000d1';
select app.cleanup_imessage_records(500);

select ok(
  (select state = 'ended' and sender_ciphertext is null and ended_at is not null
   from app.requester_imessage_bindings where request_id = '00000000-0000-4000-8000-0000000000d1'),
  'a guest binding ends 30 days after it was made, its sealed sender cleared'
);

update app.requester_imessage_bindings set ended_at = now() - interval '31 days' where request_id = '00000000-0000-4000-8000-0000000000d1';
select app.cleanup_imessage_records(500);

select ok(
  not exists (select 1 from app.requester_imessage_bindings where request_id = '00000000-0000-4000-8000-0000000000d1')
    and exists (select 1 from app.requester_imessage_bindings where request_id = '00000000-0000-4000-8000-0000000000d2' and state = 'active'),
  'a guest binding that ended more than 30 days ago is deleted; an active one remains'
);

select * from finish();
rollback;
