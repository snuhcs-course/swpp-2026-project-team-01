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
create function pg_temp.op(n int,op text,req uuid default null,input jsonb default '{}',key uuid default null,scope text default null,exp bigint default floor(extract(epoch from clock_timestamp()))::bigint+300) returns jsonb language sql as $$
 select public.fmat_agent_operation(g.id,g.client_id,g.resource,g.actor_kind,g.actor_id,coalesce($6,g.scope),$7,$2,$3,$4,$5) from fixture f join fmat.oauth_grants g on g.id=f.grant_id where f.n=$1
$$;
select ok(not has_function_privilege(r,'public.fmat_agent_operation(uuid,uuid,text,text,uuid,text,bigint,text,uuid,jsonb,uuid)','execute'),r||' denied agent RPC') from unnest(array['anon','authenticated']) r;
select ok(has_function_privilege('service_role','public.fmat_agent_operation(uuid,uuid,text,text,uuid,text,bigint,text,uuid,jsonb,uuid)','execute'),'service adapter can call RPC');
select pg_temp.prepare(1,'guest','request:decide request:read request:write');select pg_temp.consent(1);
select pg_temp.prepare(2,'guest');select pg_temp.consent(2);
select pg_temp.prepare(3,'host1','host:decide host:read host:write');select pg_temp.consent(3);
select pg_temp.prepare(4,'host2','host:read');select pg_temp.consent(4);
select is(pg_temp.op(1,'request_read',(select request_id from fixture where n=1))->>'id',(select request_id::text from fixture where n=1),'guest reads exact request');
select ok(not pg_temp.op(1,'request_read',(select request_id from fixture where n=1)) ? 'privateNotes','guest projection has no private notes');
select throws_ok($$select pg_temp.op(1,'request_read',(select request_id from fixture where n=2))$$,'P0001','FORBIDDEN','guest cannot cross request');
select throws_ok($$select pg_temp.op(4,'request_read',(select request_id from fixture where n=1))$$,'P0001','FORBIDDEN','host cannot cross host');
select is(pg_temp.op(1,'request_read',(select request_id from fixture where n=1),'{}',null,'request:write')->>'error','invalid_scope','write does not imply read');
select throws_ok($$select pg_temp.op(1,'setup_read')$$,'P0001','FORBIDDEN','guest cannot read setup');
select throws_ok($$select pg_temp.op(3,'host_approve',(select request_id from fixture where n=1))$$,'P0001','FORBIDDEN','decision scope cannot approve');
select throws_ok($$select pg_temp.op(1,'requester_agree',(select request_id from fixture where n=1))$$,'P0001','FORBIDDEN','decision scope cannot agree');
select is(pg_temp.op(1,'decision_review',(select request_id from fixture where n=1))->>'requiresHumanConfirmation','true','decision returns human handoff');
select ok((select requester_agreed_version is null and host_approved_version is null from fmat.requests where id=(select request_id from fixture where n=1)),'handoff creates neither approval nor agreement');
select ok(pg_temp.op(3,'setup_read') ? 'revision','host reads setup');
select ok(pg_temp.op(3,'setup_analysis_read') is not null,'host reads safe analysis');
select ok(pg_temp.op(3,'setup_draft',null,jsonb_build_object('expectedRevision',(pg_temp.op(3,'setup_read')->>'revision')::int,'patch',jsonb_build_object('displayName','Draft from agent'),'unresolved','[]'::jsonb),'b1000000-0000-4000-8000-000000000001') ? 'draft','host write produces setup draft');
select isnt((select display_name from fmat.hosts where id='a1000000-0000-4000-8000-000000000001'),'Draft from agent','draft does not confirm settings');
select ok(pg_temp.op(3,'private_note_save',(select request_id from fixture where n=1),jsonb_build_object('expectedRevision',(select revision from fmat.requests where id=(select request_id from fixture where n=1)),'text','private agent note'),'b1000000-0000-4000-8000-000000000002') is not null,'host writes own private note');
select ok(pg_temp.op(3,'request_read',(select request_id from fixture where n=1))::text like '%private agent note%','host can read private note');
select ok(pg_temp.op(1,'request_read',(select request_id from fixture where n=1))::text not like '%private agent note%','requester cannot see private note');
select ok(pg_temp.op(1,'details_propose',(select request_id from fixture where n=1),jsonb_build_object('expectedRevision',(select revision from fmat.requests where id=(select request_id from fixture where n=1)),'patch','{"purpose":"Draft purpose"}'::jsonb,'clarifications','[]'::jsonb),'b1000000-0000-4000-8000-000000000003') ? 'review','requester write produces review');
select isnt((select details->>'purpose' from fmat.requests where id=(select request_id from fixture where n=1)),'Draft purpose','proposed details require human review');
select ok(pg_temp.op(1,'request_read',(select request_id from fixture where n=1))::text not like '%'||pg_temp.hash(1,'guest')||'%','request secret never forwarded');
select is(pg_temp.op(1,'request_read',(select request_id from fixture where n=1),'{}',null,null,1)->>'error','invalid_token','expired token denied');
update fmat.requests set token_hash=repeat('f',64) where id=(select request_id from fixture where n=1);
select is(pg_temp.op(1,'request_read',(select request_id from fixture where n=1))->>'error','invalid_grant','rotated authority denied');
select ok((select revoked_at is not null from fmat.oauth_grants where id=(select grant_id from fixture where n=1)),'authority loss revokes grant durably');
update fmat.requests set status='withdrawn' where id=(select request_id from fixture where n=2);
select is(pg_temp.op(2,'request_read',(select request_id from fixture where n=2))->>'error','invalid_grant','closed request denied');
select is(public.fmat_agent_operation((select grant_id from fixture where n=3),(select client_id from fixture where n=3),'https://wrong.example/mcp','host','a1000000-0000-4000-8000-000000000001','host:read',floor(extract(epoch from clock_timestamp()))::bigint+300,'setup_read',null,'{}')->>'error','invalid_grant','foreign resource denied');
update fmat.oauth_grants set scope='host:read' where id=(select grant_id from fixture where n=3);
select is(pg_temp.op(3,'setup_read',null,'{}',null,'host:read host:write')->>'error','invalid_grant','old broader token denied after scope narrowing');
update fmat.oauth_grants set revoked_at=clock_timestamp() where id=(select grant_id from fixture where n=3);
select is(pg_temp.op(3,'setup_read')->>'error','invalid_grant','revoked grant denied');
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='a2000000-0000-4000-8000-000000000002';
select is(pg_temp.op(4,'setup_read')->>'error','invalid_grant','original host session loss denied');
select * from finish();rollback;
