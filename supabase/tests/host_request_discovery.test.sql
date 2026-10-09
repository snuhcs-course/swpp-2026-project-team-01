begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) select ('f5100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'discovery'||n||'@example.test',now() from generate_series(1,3)n;
insert into auth.sessions(id,user_id) select ('f5200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('f5100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,3)n;
insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) select ('f5300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'discovery'||n||'@example.test',md5(n::text)||md5(n::text),now()+interval '1 day','fixture' from generate_series(1,2)n;
insert into fmat.hosts(id,email,invitation_id) select ('f5100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'discovery'||n||'@example.test',('f5300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,2)n;
insert into fmat.requests(id,host_id,details,token_hash,expires_at,created_at) select
 ('f5400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'f5100000-0000-4000-8000-000000000001',
 jsonb_build_object('purpose',case when n=1 then 'Korean 연구 proposal' else 'Meeting '||n end,'requesterName','private-name','requesterEmail','private-address@example.test'),
 md5(n::text)||md5(n::text),now()+interval '1 day',now()-n*interval '1 second' from generate_series(1,32)n;
insert into fmat.requests(id,host_id,details,token_hash,expires_at) values
 ('f5400000-0000-4000-8000-000000000099','f5100000-0000-4000-8000-000000000002','{"purpose":"other-host-sentinel"}',repeat('a',64),now()+interval '1 day');
create function pg_temp.credential(n integer) returns jsonb language sql as $$select jsonb_build_object('kind','host','subject','f5100000-0000-4000-8000-'||lpad(n::text,12,'0'),'sessionId','f5200000-0000-4000-8000-'||lpad(n::text,12,'0'),'expiresAt',now()+interval '1 hour')$$;
create temporary table fixture(name text primary key,value jsonb);
create function pg_temp.f(text) returns jsonb language sql as $$select value from fixture where name=$1$$;
insert into fixture select 'host'||n,public.fmat_conversation_access('open',pg_temp.credential(n),'{"audience":"host_setup"}') from generate_series(1,2)n;
insert into fixture values
 ('private',public.fmat_conversation_access('open',pg_temp.credential(1),'{"audience":"host_private","requestId":"f5400000-0000-4000-8000-000000000001"}')),
 ('shared',public.fmat_conversation_access('open',pg_temp.credential(1),'{"audience":"request_shared","requestId":"f5400000-0000-4000-8000-000000000001"}')),
 ('guest',public.fmat_conversation_access('open',jsonb_build_object('kind','guest','requestId','f5400000-0000-4000-8000-000000000001','tokenHash',md5('1')||md5('1')),'{"audience":"request_shared","requestId":"f5400000-0000-4000-8000-000000000001"}'));
create function pg_temp.page(name text,input jsonb default '{}') returns jsonb language sql as $$select public.fmat_conversation_tool((pg_temp.f(name)->>'grantId')::uuid,(pg_temp.f(name)->>'conversationId')::uuid,'host_requests_read',input)$$;
insert into fixture values('first',pg_temp.page('host1'));
select is(pg_temp.f('first')#>>'{requests,0,selectionCommand}','request f5400000-0000-4000-8000-000000000001','selection command binds exact immutable request reference');
select is(jsonb_array_length(pg_temp.f('first')->'requests'),30,'navigation page bounded to thirty summaries');
select is(pg_temp.f('first')#>>'{requests,0,title}','Korean 연구 proposal','stable newest-first ordering');
select is(pg_temp.f('first')#>>'{nextCursor,beforeId}','f5400000-0000-4000-8000-000000000030','cursor is last displayed row');
insert into fixture values('second',pg_temp.page('host1',pg_temp.f('first')->'nextCursor'));
select is(jsonb_array_length(pg_temp.f('second')->'requests'),2,'cursor continues remaining rows');
select is(pg_temp.f('second')->'nextCursor','null'::jsonb,'terminal page has no cursor');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.f('first')->'requests') a join jsonb_array_elements(pg_temp.f('second')->'requests') b on a->>'requestId'=b->>'requestId'),'pages do not overlap');
select is(pg_temp.page('private'),pg_temp.f('first'),'private request scope can discover same host requests without switching');
select is(pg_temp.page('host1','{"search":"연구"}')#>>'{requests,0,title}','Korean 연구 proposal','Unicode search returns matching request');
select is(jsonb_array_length(pg_temp.page('host1','{"search":"%"}')->'requests'),0,'search metacharacter is literal');
select is(jsonb_array_length(pg_temp.page('host1','{"search":"other-host"}')->'requests'),0,'search cannot cross host boundary');
select is(jsonb_array_length(pg_temp.page('host2')->'requests'),1,'second host sees only its own request');
select ok(pg_temp.f('first')::text !~ 'private-name|private-address|requesterName|requesterEmail|messages|credential|other-host-sentinel','navigation omits structured contact and private/foreign fields');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.f('first')->'requests') item where item-array['requestId','selectionCommand','revision','title','status','closed','createdAt','updatedAt','proposalVersion']<>'{}'::jsonb),'explicit summary output allowlist');
select throws_ok($$select pg_temp.page('shared')$$,'P0001','FORBIDDEN','host in shared audience cannot list private requests');
select throws_ok($$select pg_temp.page('guest')$$,'P0001','FORBIDDEN','requester cannot discover host requests');
select throws_ok($$select public.fmat_conversation_access('open',pg_temp.credential(3),'{"audience":"host_setup"}')$$,'P0001','HOST_NOT_ADMITTED','unadmitted account receives no private grant');
select throws_ok(format('select pg_temp.page(''host1'',%L::jsonb)',input::text),'P0001','INVALID_INPUT','malformed navigation input rejected') from unnest(array[
 '{"hostId":"f5100000-0000-4000-8000-000000000002"}'::jsonb,'{"selected":true}','{"search":null}','{"search":3}','{"status":null}','{"status":"approved"}','{"beforeId":null}','{"beforeCreatedAt":false}','{"beforeId":"f5400000-0000-4000-8000-000000000001"}','[]',jsonb_build_object('search',repeat('x',201))
])input;
update fmat.requests set status='declined' where id='f5400000-0000-4000-8000-000000000032';
select is(jsonb_array_length(pg_temp.page('host1','{"status":"closed"}')->'requests'),1,'closed filter works');
select is(jsonb_array_length(pg_temp.page('host1',pg_temp.f('first')->'nextCursor')->'requests'),1,'active filter excludes closed request');
select is(jsonb_array_length(pg_temp.page('host1',(pg_temp.f('first')->'nextCursor')||'{"status":"all"}')->'requests'),2,'all filter retains closed request');
select ok(not has_function_privilege(role,'fmat.host_request_model_page(uuid,jsonb)','EXECUTE'),role||' cannot bypass conversation authority') from unnest(array['anon','authenticated','service_role']) role;
update fmat.conversation_grants set revoked_at=clock_timestamp() where id=(pg_temp.f('host1')->>'grantId')::uuid;
select throws_ok($$select pg_temp.page('host1')$$,'P0001','UNAUTHORIZED','grant revocation blocks later read');
update fmat.hosts set revoked_at=clock_timestamp() where id='f5100000-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.page('host2')$$,'P0001','HOST_NOT_ADMITTED','admission revocation blocks later read');
select is((select count(*)::integer from fmat.runtime_messages where conversation_id=(pg_temp.f('private')->>'conversationId')::uuid),0,'read does not append runtime input');
select is((select request_id::text from fmat.conversation_scopes where id=(pg_temp.f('private')->>'conversationId')::uuid),'f5400000-0000-4000-8000-000000000001','read never switches canonical conversation target');
select is((select count(*)::integer from fmat.host_approvals where host_id='f5100000-0000-4000-8000-000000000001'),0,'read cannot approve');
select is((select count(*)::integer from fmat.booking_attempts where host_id='f5100000-0000-4000-8000-000000000001'),0,'read cannot book');
select * from finish();
rollback;
