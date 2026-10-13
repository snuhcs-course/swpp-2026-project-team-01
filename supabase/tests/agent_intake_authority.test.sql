begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values('ad000000-0000-4000-8000-000000000001','intake-authority@example.test',now());
insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('ad100000-0000-4000-8000-000000000001','intake-authority@example.test',repeat('a',64),now()+interval '1 day','intake-authority-test');
insert into fmat.hosts(id,email,invitation_id,handle,display_name,rules,conflict_calendar_ids,booking_calendar_id)
values('ad000000-0000-4000-8000-000000000001','intake-authority@example.test','ad100000-0000-4000-8000-000000000001','intake-authority','Public Host','{"timezone":"Asia/Seoul","durationMinutes":30}',array['private-calendar'],'private-calendar');
insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential)
values('host','ad000000-0000-4000-8000-000000000001','private-subject',array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],'encrypted-private-fixture');
create temporary table client(id uuid);
insert into client select (public.fmat_oauth_register('intake client',array['https://client.example/cb'],'https://release.findmeatime.com/mcp')->>'clientId')::uuid;
create temporary table fixture(n int primary key,authorization_id uuid,intake_id uuid,grant_id uuid,request_id uuid);
create function pg_temp.hash(n int,purpose text) returns text language sql immutable as $$select md5(n||purpose)||md5(purpose||n)$$;
create function pg_temp.start(patch jsonb default '{}') returns jsonb language sql as $$
 select public.fmat_oauth_authorization_start(jsonb_build_object('clientId',id,'resource','https://release.findmeatime.com/mcp','redirectUri','https://client.example/cb',
 'scope','request:intake request:read request:write','handle','intake-authority','codeChallenge',translate(rtrim(encode(extensions.digest(repeat('A',43),'sha256'),'base64'),'='),'+/','-_'),'codeChallengeMethod','S256','state','state','browserHash',repeat('b',64))||patch) from client
$$;
create function pg_temp.prepare(n int) returns void language plpgsql as $$
declare a uuid;
begin
 update fmat.oauth_clients set authorization_window_at=clock_timestamp()-interval '2 minutes' where id=(select id from client);
 a:=(pg_temp.start()->>'authorizationId')::uuid;
 if a is null then raise exception 'FIXTURE_START_FAILED';end if;
 insert into fixture select n,a,id,null,reserved_request_id from fmat.oauth_intakes where authorization_id=a;
end$$;
create function pg_temp.consent(n int,decision text default 'grant',browser text default repeat('b',64)) returns jsonb language plpgsql as $$
declare r jsonb;
begin
 select public.fmat_oauth_intake_consent(authorization_id,browser,decision,pg_temp.hash($1,'code')) into r from fixture where fixture.n=$1;
 update fixture set grant_id=(select grant_id from fmat.oauth_intakes where id=fixture.intake_id) where fixture.n=$1;
 return r;
end$$;
create function pg_temp.check_grant(n int,scope text default 'request:intake request:read request:write') returns jsonb language sql as $$
 select public.fmat_oauth_grant_check(grant_id,(select id from client),'https://release.findmeatime.com/mcp','intake',intake_id,scope) from fixture where fixture.n=$1
$$;
create function pg_temp.bind(n int) returns void language plpgsql as $$
begin
 insert into fmat.requests(id,host_id,details,token_hash,expires_at)
 select request_id,'ad000000-0000-4000-8000-000000000001','{}',pg_temp.hash($1,'request'),clock_timestamp()+interval '1 day' from fixture where fixture.n=$1;
 update fmat.oauth_intakes i set request_id=f.request_id,token_hash=pg_temp.hash($1,'request'),bound_at=clock_timestamp()
 from fixture f where f.n=$1 and i.id=f.intake_id;
end$$;
select ok(not has_function_privilege(r,'public.'||f,'execute'),r||' cannot call intake '||f)
from unnest(array['anon','authenticated']) r cross join unnest(array['fmat_oauth_intake_consent(uuid,text,text,text)','fmat_oauth_intake_revoke(uuid,text)','fmat_oauth_intake_read(uuid,text)']) f;
select ok(has_function_privilege('service_role','public.'||f,'execute'),'service adapter can call '||f)
from unnest(array['fmat_oauth_intake_consent(uuid,text,text,text)','fmat_oauth_intake_revoke(uuid,text)','fmat_oauth_intake_read(uuid,text)']) f;
select ok(not has_function_privilege('service_role','fmat.oauth_intake_host_current(uuid)','execute'),'readiness helper is private');
select is(pg_temp.start('{"handle":"missing-host"}')->>'error','invalid_request','missing public target denied');
select is(pg_temp.start('{"hostId":"ad000000-0000-4000-8000-000000000001"}')->>'error','invalid_request','caller cannot add host authority');
select is(pg_temp.start('{"scope":"host:read request:intake"}')->>'error','invalid_scope','mixed roles rejected');
select is(pg_temp.start('{"scope":"request:read"}')->>'error','invalid_request','ordinary request consent cannot acquire host target');
update fmat.calendar_connections set revoked_at=clock_timestamp(),encrypted_credential=null where principal_kind='host';
select is(pg_temp.start()->>'error','invalid_request','unready host cannot reserve intake');
update fmat.calendar_connections set revoked_at=null,encrypted_credential='encrypted-private-fixture' where principal_kind='host';
select pg_temp.prepare(1);
select is(public.fmat_oauth_intake_read(authorization_id,repeat('c',64))->>'error','invalid_request','another browser cannot inspect target') from fixture where n=1;
select is(public.fmat_oauth_intake_read(authorization_id,repeat('b',64))->'intake'->'profile','{"handle":"intake-authority","displayName":"Public Host","timezone":"Asia/Seoul","durationMinutes":30}'::jsonb,'consenting browser sees only public host details') from fixture where n=1;
select is((select count(*)::int from fmat.requests),0,'pending consent creates no meeting');
select is(pg_temp.consent(1,'grant',repeat('c',64))->>'error','invalid_request','copied authorization cannot grant');
select is(pg_temp.consent(1,'deny')->>'decision','deny','requester can deny without login');
select is(pg_temp.consent(1,'deny')->>'decision','deny','deny retry stable');
select is(pg_temp.consent(1)->>'error','invalid_request','denied consent cannot become grant');
select is((select count(*)::int from fmat.oauth_grants),0,'denial creates no grant');
select pg_temp.prepare(2);
select is(public.fmat_oauth_consent(authorization_id,repeat('b',64),'{}','grant',pg_temp.hash(2,'code'))->>'error','invalid_scope','legacy requester consent cannot substitute for intake consent') from fixture where n=2;
select is(pg_temp.consent(2)->>'decision','grant','explicit account-free consent grants intake');
select is(pg_temp.consent(2)->>'decision','grant','lost consent response recovers same code');
select is((select count(*)::int from fmat.oauth_grants),1,'consent retry retains one grant');
select is((select count(*)::int from fmat.oauth_codes),1,'consent retry retains one code');
select ok((select create_expires_at=granted_at+interval '15 minutes' from fmat.oauth_intakes where id=(select intake_id from fixture where n=2)),'pending creation deadline is exactly fifteen minutes');
select is(public.fmat_oauth_intake_consent(authorization_id,repeat('b',64),'grant',repeat('f',64))->>'error','invalid_grant','retry cannot replace code') from fixture where n=2;
select is(pg_temp.check_grant(2)->>'actorKind','intake','current check recognizes only distinct intake principal');
select is(pg_temp.check_grant(2,'host:read')->>'error','invalid_grant','intake cannot obtain host permissions');
select ok(not pg_temp.check_grant(2) ?| array['tokenHash','browserHash','reservedRequestId','requestId','sessionId'],'grant projection omits continuation authority');
select is(public.fmat_oauth_grant_check(grant_id,(select id from client),'https://release.findmeatime.com/mcp','guest',request_id,'request:read')->>'error','invalid_grant','intake cannot claim reserved request as guest') from fixture where n=2;
select is(public.fmat_agent_operation(f.grant_id,(select id from client),'https://release.findmeatime.com/mcp','intake',f.intake_id,'request:intake request:read request:write',floor(extract(epoch from clock_timestamp()))::bigint+60,op,f.request_id,'{}',case when op in ('setup_draft','private_note_save','details_propose','availability_propose') then gen_random_uuid() else null end)->>'error','invalid_grant','pending intake denied legacy operation '||op)
from fixture f cross join unnest(array['setup_read','setup_analysis_read','setup_draft','request_read','private_note_save','details_propose','decision_review','requests_list','conversation_resolve','conversation_history','availability_read','availability_propose','scheduling_read','booking_status','connection_review','setup_review']) op where f.n=2;
select is(public.fmat_oauth_code_exchange((select id from client),'https://evil.example/mcp',pg_temp.hash(2,'code'),'https://client.example/cb',repeat('A',43),pg_temp.hash(2,'refresh'))->>'error','invalid_grant','intake code resource is exact');
select is(public.fmat_oauth_code_exchange((select id from client),'https://release.findmeatime.com/mcp',pg_temp.hash(2,'code'),'https://client.example/cb',repeat('B',43),pg_temp.hash(2,'refresh'))->>'error','invalid_grant','intake code requires original PKCE');
select is(public.fmat_oauth_code_exchange((select id from client),'https://release.findmeatime.com/mcp',pg_temp.hash(2,'code'),'https://client.example/cb',repeat('A',43),pg_temp.hash(2,'refresh'))->>'actorKind','intake','code exchange retains intake subject');
select is(public.fmat_oauth_refresh((select id from client),'https://release.findmeatime.com/mcp',pg_temp.hash(2,'refresh'),pg_temp.hash(2,'next'),'request:decide request:intake request:read')->>'error','invalid_scope','intake refresh cannot widen');
select is(public.fmat_oauth_refresh((select id from client),'https://release.findmeatime.com/mcp',pg_temp.hash(2,'refresh'),pg_temp.hash(2,'next'),'request:intake request:read')->>'scope','request:intake request:read','intake refresh can narrow');
select is(pg_temp.check_grant(2)->>'error','invalid_grant','old broad claims lose authority after narrowing');
select is(pg_temp.check_grant(2,'request:intake request:read')->>'actorKind','intake','narrow token remains current');
select is(public.fmat_oauth_intake_revoke(authorization_id,repeat('c',64))->>'error','invalid_grant','wrong browser cannot revoke') from fixture where n=2;
select is(public.fmat_oauth_intake_revoke(authorization_id,repeat('b',64))->>'revoked','true','same browser revokes intake') from fixture where n=2;
select is(pg_temp.check_grant(2,'request:intake request:read')->>'error','invalid_grant','revocation denies existing signed claims');
select is(public.fmat_oauth_refresh((select id from client),'https://release.findmeatime.com/mcp',pg_temp.hash(2,'next'),pg_temp.hash(2,'later'),null)->>'error','invalid_grant','revocation denies refresh');
select pg_temp.prepare(3);select pg_temp.consent(3);select pg_temp.bind(3);
select is(pg_temp.check_grant(3)->>'actorKind','intake','binding preserves token subject');
select is(public.fmat_oauth_intake_read(authorization_id,repeat('b',64))->'intake'->>'state','bound','browser reads bound stage without receiving proof') from fixture where n=3;
select throws_ok($$update fmat.oauth_intakes set request_id=gen_random_uuid() where id=(select intake_id from fixture where n=3)$$,'P0001','INTAKE_BINDING_IMMUTABLE','bound request cannot be retargeted');
select throws_ok($$update fmat.oauth_intakes set create_expires_at=create_expires_at+interval '1 minute' where id=(select intake_id from fixture where n=3)$$,'P0001','INTAKE_BINDING_IMMUTABLE','grant deadline cannot be extended');
update fmat.calendar_connections set revoked_at=clock_timestamp(),encrypted_credential=null where principal_kind='host';
select is(pg_temp.check_grant(3)->>'actorKind','intake','bound request inherits requester access rather than requiring public host readiness');
update fmat.calendar_connections set revoked_at=null,encrypted_credential='encrypted-private-fixture' where principal_kind='host';
update fmat.requests set token_hash=repeat('f',64) where id=(select request_id from fixture where n=3);
select is(pg_temp.check_grant(3)->>'error','invalid_grant','request rotation denies bound intake');
update fmat.requests set token_hash=pg_temp.hash(3,'request') where id=(select request_id from fixture where n=3);
select is(pg_temp.check_grant(3)->>'error','invalid_grant','observed lost authority cannot revive');
select pg_temp.prepare(4);select pg_temp.consent(4);select pg_temp.bind(4);
update fmat.requests set status='withdrawn' where id=(select request_id from fixture where n=4);
select is(pg_temp.check_grant(4)->>'error','invalid_grant','closure denies bound intake');
select is(public.fmat_oauth_intake_revoke(authorization_id,repeat('b',64))->>'revoked','true','closure does not prevent explicit revocation') from fixture where n=4;
select pg_temp.prepare(5);select pg_temp.consent(5);select pg_temp.bind(5);
update fmat.requests set expires_at=clock_timestamp()-interval '1 second' where id=(select request_id from fixture where n=5);
select is(pg_temp.check_grant(5)->>'error','invalid_grant','expired request denies bound intake');
select pg_temp.prepare(6);select pg_temp.consent(6);
update fmat.calendar_connections set revoked_at=clock_timestamp(),encrypted_credential=null where principal_kind='host';
select is(pg_temp.check_grant(6)->>'error','invalid_grant','pending intake loses authority when host readiness is removed');
update fmat.calendar_connections set revoked_at=null,encrypted_credential='encrypted-private-fixture' where principal_kind='host';
select is(pg_temp.check_grant(6)->>'error','invalid_grant','readiness restoration does not resurrect observed revoked intake');
select pg_temp.prepare(7);select pg_temp.consent(7);
update fmat.oauth_clients set disabled_at=clock_timestamp() where id=(select id from client);
select is(pg_temp.check_grant(7)->>'error','invalid_grant','client disablement denies intake');
select * from finish();
rollback;
