begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
('a1000000-0000-4000-8000-000000000001','oauth-host1@example.test',now()),
('a1000000-0000-4000-8000-000000000002','oauth-host2@example.test',now()),
('a1000000-0000-4000-8000-000000000003','oauth-unadmitted@example.test',now());
insert into auth.sessions(id,user_id) select ('a2000000-0000-4000-8000-00000000000'||n)::uuid,('a1000000-0000-4000-8000-00000000000'||n)::uuid from generate_series(1,3) n;
insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) select ('a3000000-0000-4000-8000-00000000000'||n)::uuid,'oauth-host'||n||'@example.test',repeat(n::text,64),now()+interval '1 day','oauth-fixture' from generate_series(1,2) n;
insert into fmat.hosts(id,email,invitation_id) select ('a1000000-0000-4000-8000-00000000000'||n)::uuid,'oauth-host'||n||'@example.test',('a3000000-0000-4000-8000-00000000000'||n)::uuid from generate_series(1,2) n;
create temporary table fixture(n int primary key,credential jsonb,authorization_id uuid,grant_id uuid,client_id uuid,request_id uuid);
create temporary table client(id uuid);
insert into client select (public.fmat_oauth_register('SQL fixture',array['https://client.example/cb'],'https://release.findmeatime.com/mcp')->>'clientId')::uuid;
create function pg_temp.hash(n int,purpose text) returns text language sql immutable as $$select md5(n||purpose)||md5(purpose||n)$$;
create function pg_temp.host(n int) returns jsonb language sql as $$select jsonb_build_object('kind','host','subject','a1000000-0000-4000-8000-00000000000'||n,'sessionId','a2000000-0000-4000-8000-00000000000'||n,'expiresAt',clock_timestamp()+interval '1 hour')$$;
create function pg_temp.prepare(n int,kind text default 'guest',scope text default 'request:read request:write') returns void language plpgsql as $$
declare req uuid:=gen_random_uuid(); cred jsonb; a uuid; c uuid;
begin
 select id into c from client;
 update fmat.oauth_clients set authorization_window_at=clock_timestamp()-interval '2 minutes' where id=c;
 if kind='guest' then
   insert into fmat.requests(id,host_id,details,token_hash,expires_at) values(req,'a1000000-0000-4000-8000-000000000001','{}',pg_temp.hash(n,'guest'),clock_timestamp()+interval '2 days');
   cred:=jsonb_build_object('kind','guest','requestId',req,'tokenHash',pg_temp.hash(n,'guest'));
 else cred:=pg_temp.host(substring(kind from 5)::int);req:=null;end if;
 a:=(public.fmat_oauth_authorization_start(jsonb_build_object('clientId',c,'resource','https://release.findmeatime.com/mcp','redirectUri','https://client.example/cb','scope',scope,
 'codeChallenge',translate(rtrim(encode(extensions.digest(repeat('A',43),'sha256'),'base64'),'='),'+/','-_'),'codeChallengeMethod','S256','state','state','browserHash',repeat('a',64)))->>'authorizationId')::uuid;
 insert into fixture values(n,cred,a,null,c,req);
end$$;
create function pg_temp.consent(n int,decision text default 'grant',browser text default repeat('a',64)) returns jsonb language plpgsql as $$
declare f fixture; r jsonb;
begin select * into f from fixture where fixture.n=$1;
 r:=public.fmat_oauth_consent(f.authorization_id,browser,f.credential,decision,pg_temp.hash(n,'code'));
 update fixture set grant_id=(select id from fmat.oauth_grants where authorization_id=f.authorization_id) where fixture.n=$1;
 return r;end$$;
create function pg_temp.exchange(n int,patch jsonb default '{}') returns jsonb language sql as $$
 select public.fmat_oauth_code_exchange(coalesce((patch->>'clientId')::uuid,f.client_id),coalesce(patch->>'resource','https://release.findmeatime.com/mcp'),pg_temp.hash(n,'code'),coalesce(patch->>'redirect','https://client.example/cb'),coalesce(patch->>'verifier',repeat('A',43)),pg_temp.hash(n,'refresh')) from fixture f where f.n=$1
$$;
create function pg_temp.refresh(n int,oldkey text default 'refresh',newkey text default 'next',scope text default null) returns jsonb language sql as $$
 select public.fmat_oauth_refresh(f.client_id,'https://release.findmeatime.com/mcp',pg_temp.hash(n,oldkey),pg_temp.hash(n,newkey),scope) from fixture f where f.n=$1
$$;
create function pg_temp.check_grant(n int,scope text default null) returns jsonb language sql as $$
 select public.fmat_oauth_grant_check(g.id,g.client_id,g.resource,g.actor_kind,g.actor_id,coalesce($2,g.scope)) from fixture f join fmat.oauth_grants g on g.id=f.grant_id where f.n=$1
$$;
select ok((select relrowsecurity from pg_class where oid=('fmat.'||t)::regclass),t||' has RLS') from unnest(array['oauth_grants','oauth_codes','oauth_refresh_tokens']) t;
select ok(not has_table_privilege(r,'fmat.'||t,'select,insert,update,delete'),r||' cannot read/write '||t) from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['oauth_grants','oauth_codes','oauth_refresh_tokens']) t;
select ok(not has_function_privilege(r,f,'execute'),r||' cannot call '||f) from unnest(array['anon','authenticated']) r cross join unnest(array['public.fmat_oauth_consent(uuid,text,jsonb,text,text)','public.fmat_oauth_code_exchange(uuid,text,text,text,text,text)','public.fmat_oauth_refresh(uuid,text,text,text,text)','public.fmat_oauth_grant_check(uuid,uuid,text,text,uuid,text)','public.fmat_oauth_grant_revoke(uuid,jsonb)','public.fmat_oauth_token_revoke(uuid,text,text)']) f;
select ok(not has_function_privilege(r,'fmat.oauth_lock_grant(uuid)','execute'),r||' cannot invoke private authority helper') from unnest(array['anon','authenticated','service_role']) r;
select pg_temp.prepare(1);
select is(pg_temp.consent(1,'grant',repeat('b',64))->>'error','invalid_request','wrong browser cannot grant');
select is(pg_temp.consent(1,'deny')->>'decision','deny','explicit denial recorded');
select is(pg_temp.consent(1,'deny')->>'decision','deny','denial retry stable');
select is(pg_temp.consent(1)->>'error','invalid_request','denied consent cannot be promoted');
select is((select count(*)::int from fmat.oauth_grants),0,'denial creates no grant');
select pg_temp.prepare(2,'guest','host:read');
select is(pg_temp.consent(2)->>'error','invalid_scope','requester cannot grant host permissions');
select pg_temp.prepare(3,'host3','host:read');
select is(pg_temp.consent(3)->>'error','invalid_grant','unadmitted host cannot grant');
select pg_temp.prepare(4);
select is(pg_temp.consent(4)->>'decision','grant','current requester explicitly grants');
select is(pg_temp.consent(4)->>'decision','grant','same decision/code retry stable');
select is((select count(*)::int from fmat.oauth_codes),1,'retry issues exactly one code');
select is(public.fmat_oauth_consent(authorization_id,repeat('a',64),credential,'grant',repeat('f',64))->>'error','invalid_grant','retry cannot replace code') from fixture where n=4;
select is(pg_temp.consent(4,'deny')->>'error','invalid_request','grant cannot be replaced with denial');
select ok((select g.expires_at<=r.expires_at and g.expires_at<=r.token_expires_at from fmat.oauth_grants g join fmat.requests r on r.id=g.request_id where g.id=(select grant_id from fixture where n=4)),'request lifetime bounds grant');
select is(pg_temp.exchange(4,'{"resource":"https://evil.example/mcp"}')->>'error','invalid_grant','wrong resource rejected');
select is(pg_temp.exchange(4,'{"clientId":"ffffffff-ffff-4fff-8fff-ffffffffffff"}')->>'error','invalid_grant','wrong client rejected');
select is(pg_temp.exchange(4,'{"redirect":"https://client.example/cb/"}')->>'error','invalid_grant','changed callback rejected');
select is(pg_temp.exchange(4,jsonb_build_object('verifier',repeat('B',43)))->>'error','invalid_grant','wrong verifier rejected');
select is((select count(*)::int from fmat.oauth_refresh_tokens),0,'bad exchange cannot mint refresh');
select is(pg_temp.exchange(4)->>'actorKind','guest','valid exchange binds requester');
select is(pg_temp.exchange(4)->>'error','invalid_grant','code replay rejected');
select is((select count(*)::int from fmat.oauth_refresh_tokens),1,'single code creates one family');
select ok(not pg_temp.check_grant(4) ?| array['tokenHash','sessionId','email','credential','code'],'grant projection omits private authority');
select is(pg_temp.check_grant(4,'request:read')->>'scope','request:read','check projection cannot widen narrower verified token permissions');
select is(pg_temp.check_grant(4,'host:read')->>'error','invalid_grant','host scope cannot cross requester role');
select is(public.fmat_oauth_grant_check(grant_id,client_id,'https://release.findmeatime.com/mcp','guest',gen_random_uuid(),'request:read')->>'error','invalid_grant','claims cannot switch request') from fixture where n=4;
select is(public.fmat_oauth_refresh(client_id,'https://evil.example/mcp',pg_temp.hash(4,'refresh'),pg_temp.hash(4,'next'),null)->>'error','invalid_grant','refresh resource bound') from fixture where n=4;
select is(pg_temp.refresh(4,'refresh','next','request:decide request:read')->>'error','invalid_scope','refresh cannot expand scope');
select is(pg_temp.refresh(4,'refresh','next','request:read')->>'scope','request:read','refresh narrows scope');
select is(pg_temp.check_grant(4,'request:read request:write')->>'error','invalid_grant','older broad JWT loses narrowed authority');
select is(pg_temp.check_grant(4,'request:read')->>'scope','request:read','narrowed JWT remains permitted');
select is(pg_temp.refresh(4,'refresh','another')->>'error','invalid_grant','consumed refresh replay rejected');
select ok((select revoked_at is not null from fmat.oauth_grants where id=(select grant_id from fixture where n=4)),'replay revocation persists despite error result');
select is(pg_temp.refresh(4,'next','later')->>'error','invalid_grant','replay revokes newest descendant');
select is(pg_temp.check_grant(4)->>'error','invalid_grant','replay revokes unexpired access authority');
select pg_temp.prepare(5,'host1','host:read host:write');select pg_temp.consent(5);select pg_temp.exchange(5);
select ok((select expires_at>clock_timestamp()+interval '1 day' and expires_at<=created_at+interval '30 days' from fmat.oauth_grants where id=(select grant_id from fixture where n=5)),'explicit host delegation can outlast original access JWT');
select is(public.fmat_oauth_grant_revoke(grant_id,pg_temp.host(2))->>'error','invalid_grant','another host cannot revoke') from fixture where n=5;
select is(public.fmat_oauth_token_revoke(gen_random_uuid(),'https://release.findmeatime.com/mcp',pg_temp.hash(5,'refresh'))->>'revoked','true','unknown client revocation is neutral');
select is(pg_temp.check_grant(5)->>'actorKind','host','wrong-client revocation did not affect owner');
select is(public.fmat_oauth_grant_revoke(grant_id,pg_temp.host(1))->>'revoked','true','owner revokes grant') from fixture where n=5;
select is(pg_temp.check_grant(5)->>'error','invalid_grant','browser revocation immediate');
select pg_temp.prepare(6,'host1','host:read');select pg_temp.consent(6);select pg_temp.exchange(6);
delete from auth.sessions where id='a2000000-0000-4000-8000-000000000001';
select is(pg_temp.refresh(6)->>'error','invalid_grant','logout stops refresh');
insert into auth.sessions(id,user_id) values('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001');
select is(pg_temp.check_grant(6)->>'error','invalid_grant','observed authority loss cannot revive');
select pg_temp.prepare(7);select pg_temp.consent(7);select pg_temp.exchange(7);
update fmat.requests set token_hash=repeat('e',64) where id=(select request_id from fixture where n=7);
select is(pg_temp.check_grant(7)->>'error','invalid_grant','request token rotation stops access');
select pg_temp.prepare(8);select pg_temp.consent(8);select pg_temp.exchange(8);
update fmat.requests set status='withdrawn' where id=(select request_id from fixture where n=8);
select is(pg_temp.refresh(8)->>'error','invalid_grant','closed request cannot refresh');
select pg_temp.prepare(9);select pg_temp.consent(9);select pg_temp.exchange(9);
update fmat.requests set token_expires_at=clock_timestamp()-interval '1 second' where id=(select request_id from fixture where n=9);
select is(pg_temp.check_grant(9)->>'error','invalid_grant','request token expiry enforced');
select pg_temp.prepare(10);select pg_temp.consent(10);select pg_temp.exchange(10);
update fmat.requests set expires_at=clock_timestamp()-interval '1 second' where id=(select request_id from fixture where n=10);
select is(pg_temp.check_grant(10)->>'error','invalid_grant','request lifetime expiry enforced');
select pg_temp.prepare(11);select pg_temp.consent(11);select pg_temp.exchange(11);
select is(public.fmat_oauth_token_revoke(client_id,'https://release.findmeatime.com/mcp',pg_temp.hash(11,'refresh'))->>'revoked','true','refresh credential revokes family') from fixture where n=11;
select is(pg_temp.check_grant(11)->>'error','invalid_grant','revoked token family inaccessible');
select pg_temp.prepare(12);select pg_temp.consent(12);
update fmat.oauth_codes set created_at=statement_timestamp()-interval '2 minutes',expires_at=statement_timestamp()-interval '1 minute' where grant_id=(select grant_id from fixture where n=12);
select is(pg_temp.exchange(12)->>'error','invalid_grant','expired code rejected');
select pg_temp.prepare(13);select pg_temp.consent(13);select pg_temp.exchange(13);
update fmat.hosts set revoked_at=clock_timestamp() where id='a1000000-0000-4000-8000-000000000001';
select is(pg_temp.check_grant(13)->>'error','invalid_grant','host admission loss stops requester delegation');
update fmat.hosts set revoked_at=null where id='a1000000-0000-4000-8000-000000000001';
select pg_temp.prepare(15,'host1','host:read');
update fixture set credential=credential||jsonb_build_object('expiresAt',clock_timestamp()-interval '1 second') where n=15;
select is(pg_temp.consent(15)->>'error','invalid_grant','expired browser JWT cannot authorize delegation');
update auth.sessions set not_after=clock_timestamp()+interval '20 minutes' where id='a2000000-0000-4000-8000-000000000001';
select pg_temp.prepare(16,'host1','host:read');select pg_temp.consent(16);select pg_temp.exchange(16);
select ok((select g.expires_at<=s.not_after from fmat.oauth_grants g join auth.sessions s on s.id=g.session_id where g.id=(select grant_id from fixture where n=16)),'session maximum lifetime bounds host grant');
update auth.users set banned_until=clock_timestamp()+interval '1 day' where id='a1000000-0000-4000-8000-000000000001';
select is(pg_temp.check_grant(16)->>'error','invalid_grant','banned host loses delegated authority');
update auth.users set banned_until=null where id='a1000000-0000-4000-8000-000000000001';
select pg_temp.prepare(17);select pg_temp.consent(17);select pg_temp.exchange(17);
update fmat.requests set token_revoked_at=clock_timestamp() where id=(select request_id from fixture where n=17);
select is(pg_temp.check_grant(17)->>'error','invalid_grant','explicit requester token revocation stops grant');
select pg_temp.prepare(14);select pg_temp.consent(14);select pg_temp.exchange(14);
update fmat.oauth_clients set disabled_at=clock_timestamp() where id=(select id from client);
select is(pg_temp.refresh(14)->>'error','invalid_grant','disabled client cannot refresh');
select is((select count(*)::int from fmat.booking_attempts),0,'OAuth never creates meeting approval/booking');
select * from finish();
rollback;
