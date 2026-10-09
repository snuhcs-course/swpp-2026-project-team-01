begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values('91000000-0000-4000-8000-000000000001','recover@fixture.test',now());
insert into auth.sessions(id,user_id) values('91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001');
insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('91000000-0000-4000-8000-000000000003','recover@fixture.test',repeat('f',64),now()+interval '1 day','fixture');
insert into fmat.hosts(id,email,invitation_id) values('91000000-0000-4000-8000-000000000001','recover@fixture.test','91000000-0000-4000-8000-000000000003');
create temporary table fixture(name text primary key,value jsonb);
insert into fixture select 'grant',public.fmat_conversation_access('open',jsonb_build_object('kind','host','subject','91000000-0000-4000-8000-000000000001','sessionId','91000000-0000-4000-8000-000000000002','expiresAt',now()+interval '1 hour'),'{"audience":"host_setup"}');
create function pg_temp.f(text) returns jsonb language sql as $$select value from fixture where name=$1$$;
create function pg_temp.scope() returns uuid language sql as $$select (pg_temp.f('grant')->>'conversationId')::uuid$$;
create function pg_temp.grant_id() returns uuid language sql as $$select (pg_temp.f('grant')->>'grantId')::uuid$$;
insert into fixture values('input','{"expectedGeneration":0,"idempotencyKey":"91000000-0000-4000-8000-000000000004","evidence":{"generation":0,"sessionId":"wrun_recovery_fixture","eventId":"event_terminal","tailIndex":24,"usage":{"inputTokens":400,"outputTokens":30,"cacheReadTokens":20,"cacheWriteTokens":10}}}');
create function pg_temp.recover(jsonb default '{}') returns jsonb language sql as $$select fmat.conversation_recovery_begin(pg_temp.grant_id(),pg_temp.scope(),pg_temp.f('input')||$1)$$;

select ok(not has_table_privilege(r,t,p),r||' cannot '||p||' '||t)
 from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['fmat.conversation_generations','fmat.conversation_recoveries']) t cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;
select ok(not has_function_privilege(r,'fmat.conversation_recovery_begin(uuid,uuid,jsonb)','EXECUTE'),r||' cannot activate private recovery') from unnest(array['anon','authenticated','service_role']) r;
select ok((select relrowsecurity from pg_class where oid=t::regclass),t||' uses RLS') from unnest(array['fmat.conversation_generations','fmat.conversation_recoveries']) t;
select ok(not has_function_privilege(r,'fmat.conversation_history_timeline(fmat.conversation_scopes)','EXECUTE'),r||' cannot read a ledger without authorization') from unnest(array['anon','authenticated','service_role']) r;
create function pg_temp.history() returns jsonb language sql as $$select public.fmat_runtime_message('history',pg_temp.grant_id(),pg_temp.scope(),'{}')$$;
select is(pg_temp.history()->'generations','[{"generation":0,"sessionId":null,"terminalTail":null}]'::jsonb,'unbound initial history is explicit');
select throws_ok($$select public.fmat_runtime_message('history',pg_temp.grant_id(),pg_temp.scope(),'{"sessionId":"foreign"}')$$,'P0001','INVALID_INPUT','history refuses caller runtime selection');
select throws_ok($$select public.fmat_runtime_message('history',gen_random_uuid(),pg_temp.scope(),'{}')$$,'P0001','UNAUTHORIZED','foreign grant cannot read history');
select throws_ok($$select pg_temp.recover()$$,'P0001','FORBIDDEN','missing canonical session cannot be recovered');
select is((select count(*) from fmat.conversation_generations where conversation_id=pg_temp.scope()),0::bigint,'denied transition leaves no ledger');
-- Exercise the existing canonical-delivery contract, then retain a pending input.
insert into fixture select 'message',public.fmat_runtime_message('accept',pg_temp.grant_id(),pg_temp.scope(),'{"clientId":"91000000-0000-4000-8000-000000000005","text":"Preserve my pending input"}');
select lives_ok($$select public.fmat_runtime_message('deliver',pg_temp.grant_id(),pg_temp.scope(),jsonb_build_object('messageId',pg_temp.f('message')->>'id','sessionId','wrun_recovery_fixture'))$$,'ordinary generation-zero delivery stays compatible');
insert into fmat.model_work_attempts values('conversation:'||(pg_temp.f('message')->>'id'),3);
insert into fixture select 'messages_before',jsonb_agg(to_jsonb(m)) from fmat.runtime_messages m where conversation_id=pg_temp.scope();
insert into fixture select 'grants_before',jsonb_agg(to_jsonb(g)) from fmat.conversation_grants g where conversation_id=pg_temp.scope();
select throws_ok(format('select pg_temp.recover(%L::jsonb)',p),'P0001','INVALID_INPUT','strict recovery input '||p::text) from (values
 ('{"expectedGeneration":-1}'::jsonb),('{"expectedGeneration":0.1}'),('{"expectedGeneration":9007199254740991}'),('{"expectedGeneration":"0"}'),('{"expectedGeneration":null}'),('{"idempotencyKey":"invalid"}'),('{"force":true}'),('{"evidence":null}')) x(p);
select throws_ok(format('select pg_temp.recover(jsonb_build_object(''evidence'',pg_temp.f(''input'')->''evidence''||%L::jsonb))',p),'P0001','INVALID_INPUT','strict terminal evidence '||p::text) from (values
 ('{"generation":1}'::jsonb),('{"sessionId":""}'),('{"eventId":null}'),('{"tailIndex":-1}'),('{"tailIndex":1.2}'),('{"tailIndex":9007199254740991}'),('{"usage":{}}'),('{"message":"private"}')) x(p);
select throws_ok(format('select pg_temp.recover(jsonb_build_object(''evidence'',jsonb_set(pg_temp.f(''input'')->''evidence'',''{usage,inputTokens}'',%L::jsonb)))',p),'P0001','INVALID_INPUT','unsafe terminal usage '||p::text) from (values ('-1'::jsonb),('0.5'),('9007199254740992'),('null'),('"1"')) x(p);
select throws_ok($$select pg_temp.recover(jsonb_build_object('evidence',jsonb_set(pg_temp.f('input')->'evidence','{sessionId}','"foreign-runtime"')))$$,'P0001','FORBIDDEN','foreign runtime cannot retire canonical session');
select throws_ok($$select fmat.conversation_recovery_begin(gen_random_uuid(),pg_temp.scope(),pg_temp.f('input'))$$,'P0001','UNAUTHORIZED','foreign grant cannot recover');
select throws_ok($$select pg_temp.recover(jsonb_build_object('evidence',jsonb_set(pg_temp.f('input')->'evidence','{usage,inputTokens}','100000')))$$,'P0001','MODEL_LIMIT','input limit cannot reset through recovery');
select throws_ok($$select pg_temp.recover(jsonb_build_object('evidence',jsonb_set(pg_temp.f('input')->'evidence','{usage,outputTokens}','8000')))$$,'P0001','MODEL_LIMIT','output limit cannot reset through recovery');
select is((select runtime_generation from fmat.conversation_scopes where id=pg_temp.scope()),0::bigint,'failed validation keeps generation zero');
-- A failure after the scope/ledger writes rolls all effects back.
create function pg_temp.reject_recovery_audit() returns trigger language plpgsql as $$begin if new.operation='conversation_recovery_started' then raise exception 'TEST_AUDIT_FAILURE';end if;return new;end$$;
create trigger test_recovery_audit before insert on fmat.audit_events for each row execute function pg_temp.reject_recovery_audit();
select throws_ok($$select pg_temp.recover()$$,'P0001','TEST_AUDIT_FAILURE','late write failure rolls back entire recovery');
select is((select count(*) from fmat.conversation_generations where conversation_id=pg_temp.scope()),1::bigint,'rollback preserves original delivery enrollment without a successor');
select is((select count(*) from fmat.conversation_recoveries where conversation_id=pg_temp.scope()),0::bigint,'rollback removes retry receipt');
drop trigger test_recovery_audit on fmat.audit_events;
-- A backfilled unbound generation can still enroll its later canonical binding.
update fmat.conversation_generations set runtime_session_id=null where conversation_id=pg_temp.scope() and generation=0;
insert into fixture select 'receipt',pg_temp.recover();
select is((pg_temp.f('receipt')->>'generation')::integer,1,'first transition advances exactly once');
select is(pg_temp.history()->'generations','[{"generation":0,"sessionId":"wrun_recovery_fixture","terminalTail":24},{"generation":1,"sessionId":null,"terminalTail":null}]'::jsonb,'recovery retains old tail while successor awaits binding');
select ok(not(pg_temp.history()::text ~ 'inputTokens|event_terminal|grantId|tokenHash|usage'),'history projection excludes terminal usage and authority');

select is(pg_temp.recover(),pg_temp.f('receipt'),'lost acknowledgement retries return original transition');
select is((select runtime_generation from fmat.conversation_scopes where id=pg_temp.scope()),1::bigint,'replay does not advance again');
select ok((select runtime_session_id is null from fmat.conversation_scopes where id=pg_temp.scope()),'successor awaits binding');
select is((select count(*) from fmat.conversation_recoveries where conversation_id=pg_temp.scope()),1::bigint,'one durable recovery operation');
select is((select count(*) from fmat.audit_events where operation='conversation_recovery_started' and subject_id=pg_temp.scope()::text),1::bigint,'one redacted audit');
select ok(not exists(select 1 from fmat.audit_events where operation='conversation_recovery_started' and subject_id=pg_temp.scope()::text and (actor ?| array['tokenHash','credential','sessionId'] or metadata ?| array['sessionId','eventId','usage'])),'audit omits provider identity and credentials');
select is((select jsonb_agg(to_jsonb(m)) from fmat.runtime_messages m where conversation_id=pg_temp.scope()),pg_temp.f('messages_before'),'pending identity, fingerprint, dispatch and content remain exact');
select is((select jsonb_agg(to_jsonb(g)) from fmat.conversation_grants g where conversation_id=pg_temp.scope()),pg_temp.f('grants_before'),'participant grants are not rotated or extended');
select is((select attempts from fmat.model_work_attempts where name='conversation:'||(pg_temp.f('message')->>'id')),3,'failed-attempt charges retained');
select is((select jsonb_build_array(runtime_session_id,terminal_event_id,terminal_tail,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens) from fmat.conversation_generations where conversation_id=pg_temp.scope() and generation=0),'["wrun_recovery_fixture","event_terminal",24,400,30,20,10]'::jsonb,'immutable retired history and usage retained');
select throws_ok($$select pg_temp.recover('{"idempotencyKey":"91000000-0000-4000-8000-000000000006"}')$$,'P0001','STALE_REVISION','another retry identity cannot replace the successor');
select throws_ok($$select pg_temp.recover(jsonb_build_object('evidence',jsonb_set(pg_temp.f('input')->'evidence','{tailIndex}','25')))$$,'P0001','IDEMPOTENCY_CONFLICT','changed evidence cannot reuse retry identity');
-- Simulate the future fenced successor binder; this test does not claim it exists.
update fmat.conversation_scopes set runtime_session_id='wrun_recovery_successor' where id=pg_temp.scope();
update fmat.conversation_generations set runtime_session_id='wrun_recovery_successor' where conversation_id=pg_temp.scope() and generation=1;
update fixture set value='{"expectedGeneration":1,"idempotencyKey":"91000000-0000-4000-8000-000000000007","evidence":{"generation":1,"sessionId":"wrun_recovery_successor","eventId":"event_second","tailIndex":14,"usage":{"inputTokens":99600,"outputTokens":0,"cacheReadTokens":0,"cacheWriteTokens":0}}}' where name='input';
select throws_ok($$select pg_temp.recover()$$,'P0001','MODEL_LIMIT','multiple generations share the same input allowance');
update fixture set value=jsonb_set(value,'{evidence,usage,inputTokens}','100') where name='input';
select lives_ok($$select pg_temp.recover()$$,'second failed generation can advance within retained limits');
select is(jsonb_array_length(pg_temp.history()->'generations'),3,'all recovered generations remain readable');
select is(pg_temp.history()#>>'{generations,1,sessionId}','wrun_recovery_successor','second retained binding has original identity');
create function pg_temp.inconsistent_history(mode text) returns void language plpgsql as $$begin
 if mode='conflict' then
  update fmat.conversation_generations set runtime_session_id='conflicting-current' where conversation_id=pg_temp.scope() and generation=2;
 else
  delete from fmat.conversation_recoveries where conversation_id=pg_temp.scope();
  delete from fmat.conversation_generations where conversation_id=pg_temp.scope() and generation=1;
 end if;
 perform pg_temp.history();
end$$;
select throws_ok($$select pg_temp.inconsistent_history('conflict')$$,'P0001','PROVIDER_UNAVAILABLE','pointer and ledger conflict fails closed');
select throws_ok($$select pg_temp.inconsistent_history('missing')$$,'P0001','PROVIDER_UNAVAILABLE','missing middle generation cannot silently truncate history');

select is((select sum(input_tokens)::bigint from fmat.conversation_generations where conversation_id=pg_temp.scope()),500::bigint,'usage accumulates without rewriting old generation');
update fmat.conversation_grants set revoked_at=clock_timestamp() where id=pg_temp.grant_id();
select throws_ok($$select pg_temp.recover()$$,'P0001','UNAUTHORIZED','exact replay still requires current participant authority');
select throws_ok($$select pg_temp.history()$$,'P0001','UNAUTHORIZED','revocation denies all retained history');
-- A host can retain structured read-only access after expiry, but not history.
insert into fmat.requests(id,host_id,details,token_hash,expires_at) values('91000000-0000-4000-8000-000000000008','91000000-0000-4000-8000-000000000001','{}',repeat('e',64),clock_timestamp()+interval '1 day');
insert into fixture select 'request_grant',public.fmat_conversation_access('open',jsonb_build_object('kind','host','subject','91000000-0000-4000-8000-000000000001','sessionId','91000000-0000-4000-8000-000000000002','expiresAt',now()+interval '1 hour'),'{"audience":"host_private","requestId":"91000000-0000-4000-8000-000000000008"}');
select lives_ok($$select public.fmat_runtime_message('history',(pg_temp.f('request_grant')->>'grantId')::uuid,(pg_temp.f('request_grant')->>'conversationId')::uuid,'{}')$$,'active host request history is readable');
update fmat.requests set expires_at=clock_timestamp()-interval '1 second' where id='91000000-0000-4000-8000-000000000008';
select throws_ok($$select public.fmat_runtime_message('history',(pg_temp.f('request_grant')->>'grantId')::uuid,(pg_temp.f('request_grant')->>'conversationId')::uuid,'{}')$$,'P0001','REQUEST_CLOSED','read-only expired host scope cannot expose history');
select * from finish();
rollback;
