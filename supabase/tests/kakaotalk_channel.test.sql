-- Host KakaoTalk channel schema (host-kakaotalk-channel design 4, 5 and 7): the
-- four iMessage tables name KakaoTalk as a fourth channel and a host still has
-- one active binding across all four; a lease belongs to a dispatching KakaoTalk
-- row only; a nudge row is KakaoTalk only; the relay's nonce and heartbeat
-- tables are closed to the Data API roles; the relay check records one alert
-- when the relay goes down and another an hour later. The Mac relay
-- (host-kakaotalk-mac-relay designs 1 and 7): a leave_room row is KakaoTalk
-- only, and the heartbeat row names the relay that sent it, the phone by
-- default. Everything runs in a rolled-back transaction.
begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

select is_empty(
  $$
    select r.rolname || ' on ' || t.name
    from unnest(array['kakaotalk_relay_nonces', 'kakaotalk_relay_heartbeats', 'kakaotalk_groups', 'kakaotalk_group_messages']) as t(name)
    cross join pg_roles r
    where r.rolname in ('anon', 'authenticated')
      and has_table_privilege(r.oid, ('app.' || t.name)::regclass, 'select, insert, update, delete, truncate, references, trigger')
  $$,
  'anon and authenticated hold no privilege on the relay tables'
);

select is_empty(
  $$
    select t.name
    from unnest(array['kakaotalk_relay_nonces', 'kakaotalk_relay_heartbeats', 'kakaotalk_groups', 'kakaotalk_group_messages']) as t(name)
    join pg_class c on c.oid = ('app.' || t.name)::regclass
    where not c.relrowsecurity
  $$,
  'every relay table enables row-level security'
);

insert into app.host_accounts (id) values ('00000000-0000-4000-8000-0000000000e1');

select lives_ok(
  $$ insert into app.imessage_receipts (channel, message_id, webhook_id, sender_hash, space_hash, space_type, content_type, payload_sha256)
     values ('kakaotalk', 'kakaotalk:123:1700000000000:0', 'kakaotalk', repeat('a', 64), repeat('a', 64), 'dm', 'text', repeat('b', 64)) $$,
  'a KakaoTalk receipt is stored'
);

select lives_ok(
  $$ insert into app.imessage_links (channel, host_account_id, method, code_hash, expires_at)
     values ('kakaotalk', '00000000-0000-4000-8000-0000000000e1', 'code', repeat('c', 64), now() + interval '10 minutes') $$,
  'a host may start a KakaoTalk code attempt'
);

select lives_ok(
  $$ insert into app.imessage_bindings (channel, host_account_id, sender_hash, sender_ciphertext, sender_name_ciphertext, sealed_key_id)
     values ('kakaotalk', '00000000-0000-4000-8000-0000000000e1', repeat('d', 64), 'sealed', 'name', 'k') $$,
  'a host may bind a KakaoTalk chat with its sealed display name'
);

select throws_ok(
  $$ insert into app.imessage_bindings (channel, host_account_id, sender_hash, sender_ciphertext, sealed_key_id)
     values ('telegram', '00000000-0000-4000-8000-0000000000e1', repeat('e', 64), 'sealed', 'k') $$,
  '23505', null, 'a host has one active binding across the four channels'
);

select lives_ok(
  $$ insert into app.imessage_outbox (channel, kind, dedupe_key, recipient_hash, recipient_ciphertext, text_ciphertext, sealed_key_id,
                                      state, dispatched_at, lease_token_hash, lease_expires_at, claim_attempts)
     values ('kakaotalk', 'notice', 'kt1', repeat('f', 64), 'r', 't', 'k', 'dispatching', now(), repeat('1', 64), now() + interval '120 seconds', 1) $$,
  'a claimed KakaoTalk row holds its lease while dispatching'
);

select throws_ok(
  $$ insert into app.imessage_outbox (channel, kind, dedupe_key, recipient_hash, text_ciphertext, sealed_key_id, lease_token_hash, lease_expires_at)
     values ('kakaotalk', 'notice', 'kt2', repeat('f', 64), 't', 'k', repeat('2', 64), now() + interval '120 seconds') $$,
  '23514', null, 'a queued row holds no lease'
);

select throws_ok(
  $$ insert into app.imessage_outbox (channel, kind, dedupe_key, recipient_hash, text_ciphertext, sealed_key_id, state, dispatched_at,
                                      lease_token_hash, lease_expires_at)
     values ('telegram', 'notice', 'kt3', repeat('f', 64), 't', 'k', 'dispatching', now(), repeat('3', 64), now() + interval '120 seconds') $$,
  '23514', null, 'only a KakaoTalk row is leased to the relay'
);

select throws_ok(
  $$ insert into app.imessage_outbox (channel, kind, dedupe_key, recipient_hash, text_ciphertext, sealed_key_id, lease_token_hash)
     values ('kakaotalk', 'notice', 'kt4', repeat('f', 64), 't', 'k', repeat('4', 64)) $$,
  '23514', null, 'a lease token never comes without its expiry'
);

select lives_ok(
  $$ insert into app.imessage_outbox (channel, kind, dedupe_key, recipient_hash, text_ciphertext, sealed_key_id)
     values ('kakaotalk', 'nudge', 'kt5', repeat('f', 64), 't', 'k') $$,
  'a KakaoTalk nudge row is queued'
);

select throws_ok(
  $$ insert into app.imessage_outbox (channel, kind, dedupe_key, recipient_hash, text_ciphertext, sealed_key_id)
     values ('telegram', 'nudge', 'kt6', repeat('f', 64), 't', 'k') $$,
  '23514', null, 'a nudge is KakaoTalk only'
);

select lives_ok(
  $$ insert into app.imessage_outbox (channel, kind, dedupe_key, recipient_hash, text_ciphertext, sealed_key_id)
     values ('kakaotalk', 'leave_room', 'kt7', repeat('f', 64), 't', 'k') $$,
  'a KakaoTalk leave_room row is queued'
);

select throws_ok(
  $$ insert into app.imessage_outbox (channel, kind, dedupe_key, recipient_hash, text_ciphertext, sealed_key_id)
     values ('whatsapp', 'leave_room', 'kt8', repeat('f', 64), 't', 'k') $$,
  '23514', null, 'leaving a room is KakaoTalk only'
);

select throws_ok(
  $$ insert into app.kakaotalk_relay_nonces (nonce, route_class) values ('not-hex', 'inbound') $$,
  '23514', null, 'a nonce is 16 random bytes in hex'
);

select is(
  (select schedule || ' ' || command from cron.job where jobname = 'app-kakaotalk-relay'),
  '* * * * * select app.check_kakaotalk_relay()',
  'the relay health check runs every minute'
);

delete from app.kakaotalk_relay_heartbeats;

select is(app.check_kakaotalk_relay(), 'silent', 'a relay that never reported is down, and nothing is recorded');

insert into app.kakaotalk_relay_heartbeats (received_at, listener_enabled, accessibility_enabled, locked, kakaotalk_version, posted_rooms)
values (now() - interval '6 minutes', true, true, false, '26.10.1', 0);

select is(
  (select array[app.check_kakaotalk_relay(), app.check_kakaotalk_relay()]),
  array['silent', 'silent'],
  'a heartbeat older than five minutes means the relay is down'
);

update app.kakaotalk_relay_heartbeats set down_alerted_at = now() - interval '61 minutes';
select app.check_kakaotalk_relay();

select is(
  (select array[down_cause, down_alerts::text] from app.kakaotalk_relay_heartbeats),
  array['silent', '2'],
  'going down records one alert, and staying down an hour records another'
);

select lives_ok(
  $$ insert into app.discussions (principal_type, principal_id, audience)
     values ('kakaotalk_group', gen_random_uuid(), 'group_chat') $$,
  'a KakaoTalk group chat has its own discussion, owned by no host'
);

select is((select relay_kind from app.kakaotalk_relay_heartbeats), 'android', 'a heartbeat row names the phone unless the Mac relay sent it');

select throws_ok(
  $$ update app.kakaotalk_relay_heartbeats set relay_kind = 'windows' $$,
  '23514', null, 'the relay is the phone or the Mac'
);

insert into app.imessage_outbox (id, channel, kind, dedupe_key, recipient_hash, recipient_ciphertext, text_ciphertext, sealed_key_id,
                                 state, dispatched_at, lease_token_hash, lease_expires_at, claim_attempts)
values ('00000000-0000-4000-8000-0000000000e9', 'kakaotalk', 'notice', 'kt-expired', repeat('9', 64), 'r', 't', 'k',
        'dispatching', now() - interval '3 minutes', repeat('5', 64), now() - interval '1 minute', 1);
select app.check_kakaotalk_relay();

select is(
  (select array[state, failure_category, coalesce(lease_token_hash, 'cleared'), coalesce(text_ciphertext, 'cleared')]
   from app.imessage_outbox where id = '00000000-0000-4000-8000-0000000000e9'),
  array['uncertain', 'lease_expired', 'cleared', 'cleared'],
  'the every-minute check makes a message whose lease ended uncertain, with no relay call'
);

select * from finish();
rollback;
