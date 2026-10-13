begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Isolate this rollback-only test from local browser fixture service usage.
delete from fmat.conversation_budgets where name='service';
delete from fmat.model_budgets where name='service';

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
create function pg_temp.reserve(text,text default null) returns jsonb language sql as $$
 select public.fmat_conversation_model_reserve((pg_temp.f($1)->>'grantId')::uuid,(pg_temp.f($1)->>'conversationId')::uuid,
  (pg_temp.f($1||'message')->>'id')::uuid,coalesce($2,'model-'||(pg_temp.f($1)->>'conversationId')))
$$;
select ok(not has_table_privilege('anon','fmat.model_budgets','SELECT'),'model allowance is private');
select ok(not has_table_privilege('authenticated','fmat.model_work_attempts','UPDATE'),'browser cannot reset attempts');
select ok(not has_table_privilege('service_role','fmat.model_budgets','DELETE'),'service Data API cannot clear allowance');
select ok(not has_function_privilege('service_role','fmat.model_budget_reserve(text,uuid,text,uuid)','EXECUTE'),'helper is internal');
select ok(not has_function_privilege('authenticated','public.fmat_conversation_model_reserve(uuid,uuid,uuid,text)','EXECUTE'),'public caller cannot reserve');
select ok(has_function_privilege('service_role','public.fmat_conversation_model_reserve(uuid,uuid,uuid,text)','EXECUTE'),'trusted runtime can reserve');
insert into fixture values ('setupmessage',pg_temp.accept('setup')),('othermessage',pg_temp.accept('other')),('guestmessage',pg_temp.accept('guest'));
select throws_ok($$select pg_temp.reserve('setup')$$,'P0001','FORBIDDEN','unbound session cannot spend');
do $$declare label text;begin foreach label in array array['setup','other','guest'] loop
 perform public.fmat_runtime_message('deliver',(pg_temp.f(label)->>'grantId')::uuid,(pg_temp.f(label)->>'conversationId')::uuid,
  jsonb_build_object('messageId',pg_temp.f(label||'message')->>'id','sessionId','model-'||(pg_temp.f(label)->>'conversationId')));
end loop;end$$;
select throws_ok($$select pg_temp.reserve('setup','wrong-runtime')$$,'P0001','FORBIDDEN','wrong session cannot spend');
select is(pg_temp.reserve('setup'),' {"reserved":true}'::jsonb,'first attempt authorized');
select is((select reserved_cents from fmat.model_budgets where name='service'),60,'charge is fixed allowance');
do $$begin for n in 2..8 loop perform pg_temp.reserve('setup');end loop;end$$;
select throws_ok($$select pg_temp.reserve('setup')$$,'P0001','MODEL_LIMIT','ninth attempt denied even on replay');
select is((select attempts from fmat.model_work_attempts where name='conversation:'||(pg_temp.f('setupmessage')->>'id')),8,'work count survives denial');
select is((select reserved_cents from fmat.model_budgets where name='service'),480,'denial creates no global charge');
select lives_ok($$select pg_temp.reserve('guest')$$,'requester allowance is separate');
select lives_ok($$select pg_temp.reserve('other')$$,'another host can reserve');
update fmat.runtime_messages set status='failed' where id=(pg_temp.f('othermessage')->>'id')::uuid;
select throws_ok($$select pg_temp.reserve('other')$$,'P0001','NOT_FOUND','settled work cannot resume spending');
select is((select reserved_cents from fmat.model_budgets where name='host:80000000-0000-4000-8000-000000000002'),60,'failed outcome retains reservation');
-- Fill the original host allowance with distinct work; no process/session key.
do $$begin for n in 1..42 loop perform fmat.model_budget_reserve('host','80000000-0000-4000-8000-000000000001','conversation',gen_random_uuid());end loop;end$$;
select is((select reserved_cents from fmat.model_budgets where name='host:80000000-0000-4000-8000-000000000001'),3000,'fifty calls consume the daily principal allowance');
select throws_ok($$select fmat.model_budget_reserve('host','80000000-0000-4000-8000-000000000001','ranking',gen_random_uuid())$$,'P0001','MODEL_LIMIT','ranking shares principal allowance');
update fmat.model_budgets set window_started_at=clock_timestamp()-interval '25 hours' where name='host:80000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.reserve('setup')$$,'P0001','MODEL_LIMIT','daily rollover never resets work attempt ceiling');
select lives_ok($$select fmat.model_budget_reserve('host','80000000-0000-4000-8000-000000000001','ranking','85000000-0000-4000-8000-000000000001')$$,'fresh work rolls over principal window');
select is((select reserved_cents from fmat.model_budgets where name='host:80000000-0000-4000-8000-000000000001'),60,'new principal window starts at one call');
select lives_ok($$select fmat.model_budget_reserve('guest','83000000-0000-4000-8000-000000000001','ranking','85000000-0000-4000-8000-000000000001')$$,'same check shares work count across actors');
select throws_ok($$select fmat.model_budget_reserve('host','80000000-0000-4000-8000-000000000001','ranking','85000000-0000-4000-8000-000000000001')$$,'P0001','MODEL_LIMIT','third ranking attempt denied across principals');
update fmat.model_budgets set reserved_cents=30000 where name='service';
select throws_ok($$select pg_temp.reserve('guest')$$,'P0001','MODEL_LIMIT','global allowance denies otherwise valid work');
update fmat.model_budgets set window_started_at=clock_timestamp()-interval '25 hours' where name='service';
select lives_ok($$select pg_temp.reserve('guest')$$,'global window recovers without resetting work');
select is((select reserved_cents from fmat.model_budgets where name='service'),60,'global window starts at one call');
select is((select attempts from fmat.model_work_attempts where name='conversation:'||(pg_temp.f('guestmessage')->>'id')),2,'attempts persist across daily windows');
update fmat.conversation_grants set revoked_at=clock_timestamp() where id=(pg_temp.f('guest')->>'grantId')::uuid;
select throws_ok($$select pg_temp.reserve('guest')$$,'P0001','UNAUTHORIZED','revoked authority cannot spend');
select is((select reserved_cents from fmat.model_budgets where name='service'),60,'authority denial never charges');
select throws_ok($$select public.fmat_conversation_model_reserve(null,null,null,null)$$,'P0001','UNAUTHORIZED','incomplete identity denied');
select * from finish();
rollback;
