begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temporary table onboarding_fixture(name text primary key,value jsonb not null);
insert into onboarding_fixture values
 ('host', '{"kind":"host","id":"00000000-0000-4000-8000-000000000001","email":"invited@example.com"}'),
 ('other','{"kind":"host","id":"00000000-0000-4000-8000-000000000002","email":"other@example.com"}'),
 ('sameEmail','{"kind":"host","id":"00000000-0000-4000-8000-000000000003","email":"invited@example.com"}'),
 ('operator','{"kind":"operator","id":"test-operator"}'),
 ('worker','{"kind":"worker","id":"test-worker"}'),
 ('rules','{"timezone":"Asia/Seoul","durationMinutes":30,"availability":[{"days":[1,2,3,4,5],"start":"09:00","end":"18:00"}],"focusBlocks":[],"bufferMinutes":15,"travelMode":"TRANSIT","homeLocation":"private home","preferences":"private host preferences"}');
create function pg_temp.actor(p_name text) returns jsonb language sql as $$select value from onboarding_fixture where name=p_name$$;
create function pg_temp.command(p_op text,p_actor_name text,p_input jsonb default '{}') returns jsonb language sql as $$
  select public.fmat_command(p_op,pg_temp.actor(p_actor_name),p_input||jsonb_build_object('idempotencyKey',gen_random_uuid()::text))
$$;
select ok(not has_table_privilege('anon','fmat.invitations','SELECT'),'invitation hashes unavailable to public clients');
select ok(not has_table_privilege('authenticated','fmat.calendar_connections','SELECT'),'encrypted credentials unavailable even to authenticated clients');
select is(public.fmat_command('waitlist_join','{"kind":"public"}','{"email":"Waitlist@Example.com","idempotencyKey":"waitlist"}')->>'status','pending','public waitlist works without account');
select is((select count(*)::integer from fmat.waitlist where email='waitlist@example.com'),1,'waitlist canonicalizes email');
select is((pg_temp.command('setup_read','other')->>'admitted')::boolean,false,'uninvited account can resume admission screen');
select throws_ok($$select pg_temp.command('setup_save','other',jsonb_build_object('handle','uninvited','displayName','Other','rules',pg_temp.actor('rules')))$$,'P0001','HOST_NOT_ADMITTED','uninvited account cannot publish via direct API');
select throws_ok($$select pg_temp.command('invite_issue','host',jsonb_build_object('email','invited@example.com','tokenHash',repeat('a',64),'expiresAt',now()+interval '1 day'))$$,'P0001','FORBIDDEN','host cannot mint admission invitations');
insert into onboarding_fixture values ('invitation',pg_temp.command('invite_issue','operator',jsonb_build_object('email','invited@example.com','tokenHash',repeat('a',64),'expiresAt',now()+interval '1 day')));
select throws_ok($$select pg_temp.command('invite_redeem','other',jsonb_build_object('tokenHash',repeat('a',64)))$$,'P0001','INVITATION_INVALID','redemption requires verified matching recipient');
select lives_ok($$select pg_temp.command('invite_redeem','host',jsonb_build_object('tokenHash',repeat('a',64)))$$,'matching invited host redeems atomically');
select throws_ok($$select pg_temp.command('invite_redeem','sameEmail',jsonb_build_object('tokenHash',repeat('a',64)))$$,'P0001','INVITATION_INVALID','same recipient on a different account cannot reuse redeemed invitation');
select lives_ok($$select pg_temp.command('invite_redeem','host',jsonb_build_object('tokenHash',repeat('a',64)))$$,'same account resumes redeemed invitation');
insert into onboarding_fixture values ('expired',pg_temp.command('invite_issue','operator',jsonb_build_object('email','other@example.com','tokenHash',repeat('b',64),'expiresAt',now()+interval '1 day')));
update fmat.invitations set expires_at=now()-interval '1 second' where token_hash=repeat('b',64);
select throws_ok($$select pg_temp.command('invite_redeem','other',jsonb_build_object('tokenHash',repeat('b',64)))$$,'P0001','INVITATION_INVALID','expired invitation rejected');
insert into onboarding_fixture values ('revoked',pg_temp.command('invite_issue','operator',jsonb_build_object('email','other@example.com','tokenHash',repeat('c',64),'expiresAt',now()+interval '1 day')));
select pg_temp.command('invite_revoke','operator',jsonb_build_object('invitationId',pg_temp.actor('revoked')->>'invitationId'));
select throws_ok($$select pg_temp.command('invite_redeem','other',jsonb_build_object('tokenHash',repeat('c',64)))$$,'P0001','INVITATION_INVALID','revoked invitation rejected');
select throws_ok($$select pg_temp.command('setup_save','host',jsonb_build_object('handle','tester','displayName','Test Host','rules',pg_temp.actor('rules')||'{"timezone":"Made/Up"}'::jsonb))$$,'P0001','INVALID_INPUT','unknown timezone cannot become confirmed rules');
select lives_ok($$select pg_temp.command('setup_save','host',jsonb_build_object('handle','tester','displayName','Test Host','rules',pg_temp.actor('rules')))$$,'admitted host saves valid confirmed rules');
select throws_ok($$select public.fmat_command('host_public','{"kind":"public"}','{"handle":"tester"}')$$,'P0001','NOT_FOUND','host discovery stays closed until calendar destination chosen');
select throws_ok($$select pg_temp.command('oauth_start','host',jsonb_build_object('stateHash',repeat('1',64),'bindingHash',repeat('2',64),'encryptedVerifier',repeat('x',40),'context',jsonb_build_object('redirectUri','https://findmeatime.com/api/google/callback','requestId','another-request')))$$,'P0001','FORBIDDEN','host OAuth cannot masquerade as requester grant');
insert into onboarding_fixture values ('oauth',public.fmat_command('oauth_start',pg_temp.actor('host'),jsonb_build_object('stateHash',repeat('1',64),'bindingHash',repeat('2',64),'encryptedVerifier',repeat('x',40),'context',jsonb_build_object('redirectUri','https://findmeatime.com/api/google/callback'),'idempotencyKey','oauth-one')));
select is(public.fmat_command('oauth_start',pg_temp.actor('host'),jsonb_build_object('stateHash',repeat('3',64),'bindingHash',repeat('4',64),'encryptedVerifier',repeat('y',40),'context',jsonb_build_object('redirectUri','https://findmeatime.com/api/google/callback'),'idempotencyKey','oauth-one')),pg_temp.actor('oauth'),'OAuth retry returns original encrypted browser artifacts');
select throws_ok($$select public.fmat_command('oauth_consume','{"kind":"public"}',jsonb_build_object('stateHash',repeat('1',64),'bindingHash',repeat('9',64)))$$,'P0001','OAUTH_STATE_INVALID','callback swapping fails browser binding');
select is((select count(*)::integer from fmat.oauth_exchanges where consumed_at is not null),0,'failed callback does not consume legitimate state');
insert into onboarding_fixture values ('consumed',public.fmat_command('oauth_consume','{"kind":"public"}',jsonb_build_object('stateHash',repeat('1',64),'bindingHash',repeat('2',64))));
select is(pg_temp.actor('consumed')->'actor',pg_temp.actor('host'),'callback derives principal from saved state');
select throws_ok($$select public.fmat_command('oauth_consume','{"kind":"public"}',jsonb_build_object('stateHash',repeat('1',64),'bindingHash',repeat('2',64)))$$,'P0001','OAUTH_STATE_INVALID','callback state cannot be replayed');
select throws_ok($$select public.fmat_command('credential_save',pg_temp.actor('worker'),jsonb_build_object('exchangeId',pg_temp.actor('consumed')->>'exchangeId','encryptedCredential',repeat('e',40),'scopes',jsonb_build_array('https://www.googleapis.com/auth/calendar.freebusy'),'providerSubject','google-user'))$$,'P0001','INSUFFICIENT_SCOPES','requester freebusy grant cannot provide host Calendar write authority');
insert into onboarding_fixture values ('credential',public.fmat_command('credential_save',pg_temp.actor('worker'),jsonb_build_object('exchangeId',pg_temp.actor('consumed')->>'exchangeId','encryptedCredential',repeat('e',40),'scopes',jsonb_build_array('https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'),'providerSubject','google-user')));
select throws_ok($$select public.fmat_command('credential_save',pg_temp.actor('worker'),jsonb_build_object('exchangeId',pg_temp.actor('consumed')->>'exchangeId','encryptedCredential',repeat('e',40),'scopes',jsonb_build_array('https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'),'providerSubject','google-user'))$$,'P0001','OAUTH_STATE_INVALID','consumed exchange cannot replace credentials twice');
select ok((select encrypted_verifier is null from fmat.oauth_exchanges where state_hash=repeat('1',64)),'PKCE material erased after successful exchange');
select throws_ok($$select public.fmat_command('connection_read',pg_temp.actor('other'),jsonb_build_object('hostId',pg_temp.actor('host')->>'id'))$$,'P0001','FORBIDDEN','host cannot read cross-host credentials through worker operation');
select throws_ok($$select pg_temp.command('calendar_save','host','{"conflictCalendarIds":["primary"],"bookingCalendarId":"primary","verifiedCalendars":[{"id":"primary","accessRole":"reader"}]}')$$,'P0001','CALENDAR_ACCESS_INVALID','read-only calendar cannot be booking destination');
select throws_ok($$select pg_temp.command('calendar_save','host','{"conflictCalendarIds":["hidden"],"bookingCalendarId":"primary","verifiedCalendars":[{"id":"primary","accessRole":"owner"}]}')$$,'P0001','CALENDAR_ACCESS_INVALID','conflict calendars require provider-verified read access');
select lives_ok($$select pg_temp.command('calendar_save','host','{"conflictCalendarIds":["primary"],"bookingCalendarId":"primary","verifiedCalendars":[{"id":"primary","accessRole":"owner"}]}')$$,'provider-verified writable destination completes setup');
insert into onboarding_fixture values('public',public.fmat_command('host_public','{"kind":"public"}','{"handle":"tester"}'));
select is((pg_temp.actor('public')->>'ready')::boolean,true,'complete invited host becomes discoverable');
select ok(not (pg_temp.actor('public') ?| array['rules','preferences','homeLocation','email','encryptedCredential']),'public host profile excludes private rules and tokens');
select lives_ok($$select pg_temp.command('calendar_disconnect','host')$$,'host can disconnect');
select ok((select encrypted_credential is null and revoked_at is not null from fmat.calendar_connections where id=(pg_temp.actor('credential')->>'connectionId')::uuid),'disconnect erases stored credential ciphertext');
select throws_ok($$select public.fmat_command('token_update',pg_temp.actor('worker'),jsonb_build_object('connectionId',pg_temp.actor('credential')->>'connectionId','encryptedCredential',repeat('new',20)))$$,'P0001','RECONNECT_REQUIRED','late refresh cannot resurrect disconnected credential');
select throws_ok($$select public.fmat_command('host_public','{"kind":"public"}','{"handle":"tester"}')$$,'P0001','NOT_FOUND','disconnect withdraws host publication readiness');
select throws_ok($$select public.fmat_command('oauth_start','{"kind":"guest","requestId":"00000000-0000-4000-8000-000000000099","tokenHash":"fake"}',jsonb_build_object('stateHash',repeat('7',64),'bindingHash',repeat('8',64),'encryptedVerifier',repeat('x',40),'context',jsonb_build_object('redirectUri','https://findmeatime.com/api/google/callback','requestId','00000000-0000-4000-8000-000000000099'),'idempotencyKey','unknown-guest'))$$,'P0001','NOT_FOUND','nonexistent guest request cannot obtain scoped consent');
-- Cached onboarding results are still protected by current admission authority.
select public.fmat_command('setup_save',pg_temp.actor('host'),jsonb_build_object('handle','tester','displayName','Test Host','rules',pg_temp.actor('rules'),'idempotencyKey','replay-after-revoke'));
update fmat.hosts set revoked_at=now() where id=(pg_temp.actor('host')->>'id')::uuid;
select throws_ok($$select public.fmat_command('setup_save',pg_temp.actor('host'),jsonb_build_object('handle','tester','displayName','Test Host','rules',pg_temp.actor('rules'),'idempotencyKey','replay-after-revoke'))$$,'P0001','HOST_NOT_ADMITTED','revoked host cannot replay cached authorized setup');
select * from finish();
rollback;
