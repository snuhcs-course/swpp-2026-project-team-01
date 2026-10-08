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
create function pg_temp.access(text,text,jsonb) returns jsonb language sql as $$select public.fmat_conversation_access($1,pg_temp.f($2),$3)$$;
create function pg_temp.check_grant(text) returns jsonb language sql as $$select public.fmat_conversation_check((pg_temp.f($1)->>'grantId')::uuid,(pg_temp.f($1)->>'conversationId')::uuid)$$;


insert into fixture values
('setup',pg_temp.access('open','host1','{"audience":"host_setup"}')),
('shared',pg_temp.access('open','host1','{"audience":"request_shared","requestId":"83000000-0000-4000-8000-000000000001"}')),
('guest',pg_temp.access('open','guest1','{"audience":"request_shared","requestId":"83000000-0000-4000-8000-000000000001"}')),
('other',pg_temp.access('open','host2','{"audience":"host_setup"}'));
create function pg_temp.accept(text,uuid default gen_random_uuid(),text default 'hello') returns jsonb language sql as $$
 select public.fmat_runtime_message('accept',(pg_temp.f($1)->>'grantId')::uuid,(pg_temp.f($1)->>'conversationId')::uuid,jsonb_build_object('clientId',$2,'text',$3))
$$;
select ok(not has_table_privilege('anon','fmat.conversation_budgets','SELECT'),'quota state is private');
select ok(not has_table_privilege('authenticated','fmat.conversation_budgets','UPDATE'),'browser cannot reset quota');
select ok(not has_table_privilege('service_role','fmat.conversation_budgets','DELETE'),'server cannot delete counters through Data API');
select ok(not has_function_privilege('service_role','fmat.conversation_budget_charge(text,uuid)','EXECUTE'),'charge helper is internal');
insert into fixture values ('first',pg_temp.accept('setup','84000000-0000-4000-8000-000000000001'));
select is((select minute_used from fmat.conversation_budgets where name='service'),1,'new input charged once');
select is(pg_temp.accept('setup','84000000-0000-4000-8000-000000000001'),pg_temp.f('first'),'pending replay returns same receipt');
select throws_ok($$select pg_temp.accept('setup','84000000-0000-4000-8000-000000000001','changed')$$,'P0001','IDEMPOTENCY_CONFLICT','changed retry cannot charge');
select throws_ok($$select pg_temp.accept('setup')$$,'P0001','CONVERSATION_BUSY','busy input cannot charge');
select throws_ok($$select pg_temp.accept('shared',gen_random_uuid(),'')$$,'P0001','INVALID_INPUT','invalid input cannot charge');
select is((select minute_used from fmat.conversation_budgets where name='service'),1,'rejected/retried inputs unchanged');
update fmat.runtime_messages set status='completed';
-- Real acceptance loop reaches the principal ceiling across two scopes.
do $$begin for n in 2..20 loop perform pg_temp.accept(case when n%2=0 then 'shared' else 'setup' end);update fmat.runtime_messages set status='completed';end loop;end$$;
select is((select minute_used from fmat.conversation_budgets where name like 'host:80000000%001'),20,'all host scopes share one minute allowance');
select throws_ok($$select pg_temp.accept('setup')$$,'P0001','CONVERSATION_RATE_LIMIT','twenty-first host input denied');
select is((select minute_used from fmat.conversation_budgets where name='service'),20,'principal denial rolls back service charge');
select is(pg_temp.accept('setup','84000000-0000-4000-8000-000000000001')->>'status','completed','settled replay succeeds at limit');
select lives_ok($$select pg_temp.accept('guest')$$,'requester has a separate budget');
select lives_ok($$select pg_temp.accept('other')$$,'another host has a separate budget');
update fmat.runtime_messages set status='completed';
-- A new verified Auth session does not reset host allowance.
insert into auth.sessions(id,user_id) values('81000000-0000-4000-8000-000000000099','80000000-0000-4000-8000-000000000001');
insert into fixture values('newhost',pg_temp.f('host1')||'{"sessionId":"81000000-0000-4000-8000-000000000099"}');
insert into fixture values('newgrant',pg_temp.access('open','newhost','{"audience":"host_setup"}'));
select throws_ok($$select pg_temp.accept('newgrant')$$,'P0001','CONVERSATION_RATE_LIMIT','credential replacement shares budget');
update fmat.conversation_budgets set minute_started_at=clock_timestamp()-interval '61 seconds' where name like 'host:80000000%001';
select lives_ok($$select pg_temp.accept('setup')$$,'expired minute resets');
select is((select hour_used from fmat.conversation_budgets where name like 'host:80000000%001'),21,'minute rollover retains hourly usage');
update fmat.runtime_messages set status='completed';
update fmat.conversation_budgets set hour_used=100 where name like 'host:80000000%001';
select throws_ok($$select pg_temp.accept('setup')$$,'P0001','CONVERSATION_RATE_LIMIT','hourly limit survives minute rollover');
update fmat.conversation_budgets set hour_started_at=clock_timestamp()-interval '61 minutes' where name like 'host:80000000%001';
select lives_ok($$select pg_temp.accept('setup')$$,'expired hour resets');
select is((select minute_used from fmat.conversation_budgets where name like 'host:80000000%001'),2,'hour rollover retains active minute usage');
update fmat.runtime_messages set status='completed';
update fmat.conversation_budgets set minute_used=20 where name='guest:83000000-0000-4000-8000-000000000001';
update fmat.requests set token_hash=repeat('c',64) where id='83000000-0000-4000-8000-000000000001';
insert into fixture values('newguest',pg_temp.f('guest1')||jsonb_build_object('tokenHash',repeat('c',64)));
insert into fixture values('newguestgrant',pg_temp.access('open','newguest','{"audience":"request_shared","requestId":"83000000-0000-4000-8000-000000000001"}'));
select throws_ok($$select pg_temp.accept('newguestgrant')$$,'P0001','CONVERSATION_RATE_LIMIT','request recovery does not reset requester budget');
select throws_ok($$select pg_temp.accept('guest')$$,'P0001','NOT_FOUND','old requester authority cannot use quota');
update fmat.conversation_budgets set minute_used=200 where name='service';
select throws_ok($$select pg_temp.accept('other')$$,'P0001','CONVERSATION_RATE_LIMIT','service minute ceiling applies across principals');
update fmat.conversation_budgets set minute_used=0,hour_used=2000 where name='service';
select throws_ok($$select pg_temp.accept('newguestgrant')$$,'P0001','CONVERSATION_RATE_LIMIT','service hourly ceiling applies across principals');
update fmat.conversation_grants set revoked_at=clock_timestamp() where id=(pg_temp.f('setup')->>'grantId')::uuid;
select throws_ok($$select pg_temp.accept('setup','84000000-0000-4000-8000-000000000001')$$,'P0001','UNAUTHORIZED','revoked receipt cannot replay even when throttled');
select * from finish();
rollback;
