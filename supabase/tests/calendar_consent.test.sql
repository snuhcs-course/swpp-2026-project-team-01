begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at) values
('80000000-0000-4000-8000-000000000001','one@access.test',now()),
('80000000-0000-4000-8000-000000000002','two@access.test',now()),
('80000000-0000-4000-8000-000000000003','unadmitted@access.test',now());
insert into auth.sessions(id,user_id) values
('81000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001'),
('81000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000002'),
('81000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000003');
insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values
('82000000-0000-4000-8000-000000000001','one@access.test',repeat('1',64),now()+interval '1 day','fixture'),
('82000000-0000-4000-8000-000000000002','two@access.test',repeat('2',64),now()+interval '1 day','fixture');
insert into fmat.hosts(id,email,invitation_id) values
('80000000-0000-4000-8000-000000000001','one@access.test','82000000-0000-4000-8000-000000000001'),
('80000000-0000-4000-8000-000000000002','two@access.test','82000000-0000-4000-8000-000000000002');
insert into fmat.requests(id,host_id,details,token_hash,expires_at) values
('83000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','{}',repeat('a',64),now()+interval '1 day'),
('83000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000002','{}',repeat('b',64),now()+interval '1 day');
create temporary table fixture(name text primary key,value jsonb);
insert into fixture select 'host'||n,jsonb_build_object('kind','host','subject','80000000-0000-4000-8000-00000000000'||n,
  'sessionId','81000000-0000-4000-8000-00000000000'||n,'expiresAt',now()+interval '1 hour','email','spoofed@attacker.test') from generate_series(1,3) n;
insert into fixture values
('guest1','{"kind":"guest","requestId":"83000000-0000-4000-8000-000000000001","tokenHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'),
('guest2','{"kind":"guest","requestId":"83000000-0000-4000-8000-000000000002","tokenHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}');
create function pg_temp.f(text) returns jsonb language sql as $$select value from fixture where name=$1$$;

create function pg_temp.consent(text,text,jsonb default '{}') returns jsonb language sql as $$select public.fmat_calendar_consent($1,pg_temp.f($2),$3)$$;
create function pg_temp.start(p_who text,p_key text) returns jsonb language sql as $$select pg_temp.consent('start',p_who,jsonb_build_object('stateHash',repeat(p_key,64),'bindingHash',repeat('f',64),'encryptedVerifier',repeat('v',40),'redirectUri','https://release.example.test/connections/google/callback'))$$;
create function pg_temp.consume(p_key text,p_binding text default 'f') returns jsonb language sql as $$select public.fmat_calendar_consent('consume',null,jsonb_build_object('stateHash',repeat(p_key,64),'bindingHash',repeat(p_binding,64)))$$;
create function pg_temp.save(p_name text,p_guest boolean default false) returns jsonb language sql as $$select public.fmat_calendar_consent('save',null,jsonb_build_object('exchangeId',pg_temp.f(p_name)->>'exchangeId','providerSubject','google-subject','encryptedCredential',repeat('e',40),'scopes',case when p_guest then jsonb_build_array('openid','email','https://www.googleapis.com/auth/calendar.events.freebusy','https://www.googleapis.com/auth/calendar.calendarlist.readonly') else jsonb_build_array('openid','email','https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events') end))$$;
select ok(not has_function_privilege('anon','public.fmat_calendar_consent(text,jsonb,jsonb)','EXECUTE'),'anonymous cannot invoke calendar service RPC');
select ok(not has_function_privilege('authenticated','public.fmat_calendar_consent(text,jsonb,jsonb)','EXECUTE'),'browser cannot forge verified credentials');
select ok(not has_table_privilege('service_role','fmat.oauth_exchanges','SELECT'),'consent secrets require narrow service RPC');
select throws_ok($$select pg_temp.start('host3','1')$$,'P0001','HOST_NOT_ADMITTED','admission required');
select is(pg_temp.consent('status','host1')->>'connected','false','new host disconnected');
select lives_ok($$select pg_temp.start('host1','1')$$,'host starts bound consent');
select throws_ok($$select pg_temp.consume('1','e')$$,'P0001','OAUTH_STATE_INVALID','wrong browser denied');
insert into fixture values('consumed1',pg_temp.consume('1'));
select is(pg_temp.f('consumed1')->>'returnPath','/app','host return fixed by service');
select throws_ok($$select pg_temp.consume('1')$$,'P0001','OAUTH_STATE_INVALID','callback single-use');
select lives_ok($$select pg_temp.save('consumed1')$$,'verified host grant saves');
select throws_ok($$select pg_temp.save('consumed1')$$,'P0001','OAUTH_STATE_INVALID','grant cannot be saved twice');
select is(pg_temp.consent('status','host1')->>'connected','true','host grant connected');
select ok(not(pg_temp.consent('status','host1') ?| array['encryptedCredential','bound_credential','providerSubject','scopes']),'status excludes credentials and provider identity');
select is(pg_temp.consent('status','host2')->>'connected','false','host grants isolated');
select pg_temp.start('host1','2');
insert into fixture values('consumed2',pg_temp.consume('2'));
select pg_temp.consent('disconnect','host1');
select throws_ok($$select pg_temp.save('consumed2')$$,'P0001','OAUTH_STATE_INVALID','disconnect fences callback after consume');
select is((select encrypted_credential from fmat.calendar_connections where principal_id='80000000-0000-4000-8000-000000000001'),null,'disconnect deletes refresh material');
select pg_temp.start('host1','3');select pg_temp.start('host1','4');
select throws_ok($$select pg_temp.consume('3')$$,'P0001','OAUTH_STATE_INVALID','newer start fences older browser attempt');
update fmat.oauth_exchanges set expires_at=now()-interval '1 second' where state_hash=repeat('4',64);
select throws_ok($$select pg_temp.consume('4')$$,'P0001','OAUTH_STATE_INVALID','expired consent denied');
select pg_temp.start('host2','5');delete from auth.sessions where id='81000000-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.consume('5')$$,'P0001','UNAUTHORIZED','logout during Google consent denies callback');
select pg_temp.start('guest1','6');insert into fixture values('guestConsumed',pg_temp.consume('6'));
select is(pg_temp.f('guestConsumed')->>'returnPath','/booking/83000000-0000-4000-8000-000000000001','guest returns to its exact private request');
select throws_ok($$select pg_temp.save('guestConsumed')$$,'P0001','INSUFFICIENT_SCOPES','guest token cannot save host write scopes');
select lives_ok($$select pg_temp.save('guestConsumed',true)$$,'guest availability-only grant saved');
select is(pg_temp.consent('status','guest1')->>'connected','true','guest sees its connection');
select is(pg_temp.consent('status','guest2')->>'connected','false','separate request cannot discover grant');
select is((select revision from fmat.requests where id='83000000-0000-4000-8000-000000000001'),2,'new availability grant invalidates prior scheduling revision');
select pg_temp.start('guest1','7');insert into fixture values('closing',pg_temp.consume('7'));
update fmat.requests set status='declined',token_revoked_at=now() where id='83000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.save('closing',true)$$,'P0001','NOT_FOUND','request closure during exchange denies grant save');
select throws_ok($$select pg_temp.consent('status','guest1')$$,'P0001','NOT_FOUND','closed guest cannot inspect connection');
select pg_temp.start('guest2','8');insert into fixture values('rotating',pg_temp.consume('8'));
update fmat.requests set token_hash=repeat('c',64) where id='83000000-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.save('rotating',true)$$,'P0001','NOT_FOUND','credential rotation during callback denies old guest authority');
select * from finish();rollback;
