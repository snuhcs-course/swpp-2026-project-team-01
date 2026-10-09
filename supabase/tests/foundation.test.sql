begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(37);

select ok(not has_schema_privilege('anon','fmat','USAGE'),'anon cannot access private schema');
select ok(not has_schema_privilege('authenticated','fmat','USAGE'),'host JWT cannot access private schema');
select ok(not has_table_privilege('authenticated','fmat.jobs','SELECT'),'host JWT cannot read durable jobs');
select ok(not has_function_privilege('anon','public.fmat_command(text,jsonb,jsonb)','EXECUTE'),'anon cannot invoke privileged command');
select ok(not has_function_privilege('authenticated','public.fmat_command(text,jsonb,jsonb)','EXECUTE'),'authenticated cannot invoke privileged command');
select ok(has_function_privilege('service_role','public.fmat_command(text,jsonb,jsonb)','EXECUTE'),'service backend can invoke privileged command');
set local role anon;
select throws_ok($$select public.fmat_command('jobs_claim','{"kind":"worker","id":"fake"}','{"workerId":"fake"}')$$,'42501',null,'forged worker claims denied at RPC privilege boundary');
reset role;

select throws_ok($$select public.fmat_command('jobs_claim','{"kind":"host","id":"fake"}','{"workerId":"fake"}')$$,'P0001','FORBIDDEN','verified host actor cannot consume jobs');
select throws_ok($$select public.fmat_command('jobs_claim','{"kind":"worker","id":"one"}','{"workerId":"two"}')$$,'P0001','FORBIDDEN','worker cannot impersonate another lease owner');
select throws_ok($$select public.fmat_command('foundation_ping','{"kind":"worker","id":"test"}','{}')$$,'P0001','IDEMPOTENCY_REQUIRED','public mutations require idempotency keys');

create temporary table test_results (name text primary key, value jsonb);
insert into test_results values('ping',public.fmat_command('foundation_ping','{"kind":"worker","id":"test"}','{"idempotencyKey":"ping-one","label":"test"}'));
select is(public.fmat_command('foundation_ping','{"kind":"worker","id":"test"}','{"idempotencyKey":"ping-one","label":"test"}'),(select value from test_results where name='ping'),'identical retry returns exact saved result');
select is((select count(*)::integer from fmat.audit_events where operation='foundation_ping'),1,'idempotent retry does not repeat domain effects');
select throws_ok($$select public.fmat_command('foundation_ping','{"kind":"worker","id":"test"}','{"idempotencyKey":"ping-one","label":"different"}')$$,'P0001','IDEMPOTENCY_CONFLICT','key reuse with different JSON is rejected');
select is((select count(*)::integer from fmat.queue_publications where job_id=((select value->>'jobId' from test_results where name='ping')::uuid)),1,'state and queue publication committed together');

insert into test_results values('claim-one',public.fmat_command('jobs_claim','{"kind":"worker","id":"test"}','{"workerId":"test","limit":1}'));
select is(jsonb_array_length((select value->'jobs' from test_results where name='claim-one')),1,'bounded worker claims pending job');
select is(jsonb_array_length(public.fmat_command('jobs_claim','{"kind":"worker","id":"test"}','{"workerId":"test","limit":1}')->'jobs'),0,'overlapping invocation cannot take unexpired lease');
select lives_ok($$select pgmq.send('fmat_jobs',jsonb_build_object('jobId',(select value->>'jobId' from test_results where name='ping')))$$,'queue may redeliver duplicate wake-up');
select is(jsonb_array_length(public.fmat_command('jobs_claim','{"kind":"worker","id":"other"}','{"workerId":"other","limit":1}')->'jobs'),0,'duplicate queue delivery cannot steal application lease');

update fmat.jobs set lease_until=now()-interval '1 second' where id=((select value->>'jobId' from test_results where name='ping')::uuid);
insert into test_results values('claim-two',public.fmat_command('jobs_claim','{"kind":"worker","id":"other"}','{"workerId":"other","limit":1}'));
select is((select (value->'jobs'->0->>'attempts')::integer from test_results where name='claim-two'),2,'expired ownership is recovered with bounded attempt count');
select is((select (value->'jobs'->0->>'recovery')::boolean from test_results where name='claim-two'),true,'recovery tells worker to reconcile external uncertainty');
select throws_ok(format('select public.fmat_command(%L,%L,%L)','jobs_complete','{"kind":"worker","id":"test"}',(select jsonb_build_object('jobId',value->'jobs'->0->>'id','leaseToken',value->'jobs'->0->>'leaseToken')::text from test_results where name='claim-one')),'P0001','LEASE_LOST','old worker fenced after ownership transfer');
select lives_ok(format('select public.fmat_command(%L,%L,%L)','jobs_complete','{"kind":"worker","id":"other"}',(select jsonb_build_object('jobId',value->'jobs'->0->>'id','leaseToken',value->'jobs'->0->>'leaseToken')::text from test_results where name='claim-two')),'current worker can complete recovered job');
select is(jsonb_array_length(public.fmat_command('jobs_claim','{"kind":"worker","id":"other"}','{"workerId":"other","limit":1}')->'jobs'),0,'completed jobs do not repeat side effects on redelivery');

-- Force a missing-wake-up scenario and prove the recovery sweep republishes it.
insert into test_results values('recover',public.fmat_command('jobs_enqueue','{"kind":"worker","id":"test"}','{"kind":"ping","dedupeKey":"recover-one","payload":{}}'));
update fmat.queue_publications set acknowledged_at=now() where job_id=((select value->>'jobId' from test_results where name='recover')::uuid);
select is(fmat.recover_jobs(),1,'Cron sweep repairs missed wake-ups from durable application rows');

savepoint atomic_failure;
select fmat.enqueue_job('ping','rolled-back-job','{}');
rollback to atomic_failure;
select is((select count(*)::integer from fmat.jobs where dedupe_key='rolled-back-job'),0,'rolled-back command leaves no durable job');
select is((select count(*)::integer from pgmq.q_fmat_jobs where message->>'jobId' not in (select id::text from fmat.jobs)),0,'rolled-back command leaves no orphan queue publication');
-- Retry budget is enforced even when the worker repeatedly fails rather than expires.
update fmat.jobs set status='complete' where dedupe_key='recover-one';
insert into test_results values('retry',public.fmat_command('jobs_enqueue','{"kind":"worker","id":"test"}','{"kind":"ping","dedupeKey":"retry-one","payload":{},"maxAttempts":1}'));
insert into test_results values('retry-claim',public.fmat_command('jobs_claim','{"kind":"worker","id":"test"}','{"workerId":"test","limit":1}'));
select lives_ok(format('select public.fmat_command(%L,%L,%L)','jobs_fail','{"kind":"worker","id":"test"}',(select jsonb_build_object('jobId',value->'jobs'->0->>'id','leaseToken',value->'jobs'->0->>'leaseToken','errorCode','PROVIDER_UNAVAILABLE')::text from test_results where name='retry-claim')),'worker can record definitive failed attempt');
select is((select status from fmat.jobs where dedupe_key='retry-one'),'dead','retry exhaustion quarantines work');
select is(jsonb_array_length(public.fmat_command('jobs_claim','{"kind":"worker","id":"test"}','{"workerId":"test","limit":1}')->'jobs'),0,'quarantined job is not retried indefinitely');
-- Exercise the whole public command transaction, including its retry receipt.
create temporary table atomic_counts as select
 (select count(*) from fmat.jobs) jobs,
 (select count(*) from fmat.queue_publications) publications,
 (select count(*) from pgmq.q_fmat_jobs) wakeups;
savepoint whole_command_failure;
select public.fmat_command('foundation_ping','{"kind":"worker","id":"atomic-fixture"}','{"idempotencyKey":"rollback-retry","label":"atomic"}');
rollback to whole_command_failure;
select is((select count(*) from fmat.jobs),(select jobs from atomic_counts),'failed command rolls back its durable job');
select is((select count(*) from fmat.queue_publications),(select publications from atomic_counts),'failed command rolls back publication ledger');
select is((select count(*) from pgmq.q_fmat_jobs),(select wakeups from atomic_counts),'failed command rolls back queue wake-up');
select is((select count(*)::integer from fmat.audit_events where actor->>'id'='atomic-fixture'),0,'failed command rolls back audit entry');
select is((select count(*)::integer from fmat.idempotency where actor_scope='worker:atomic-fixture'),0,'failed command rolls back retry receipt');
select lives_ok($$select public.fmat_command('foundation_ping','{"kind":"worker","id":"atomic-fixture"}','{"idempotencyKey":"rollback-retry","label":"atomic"}')$$,'same key succeeds after rollback');
select is(public.fmat_command('foundation_ping','{"kind":"worker","id":"atomic-fixture"}','{"idempotencyKey":"rollback-retry","label":"atomic"}'),(select result from fmat.idempotency where actor_scope='worker:atomic-fixture' and key='rollback-retry'),'committed retry returns the saved command result');
select is((select count(*)::integer from fmat.audit_events where actor->>'id'='atomic-fixture'),1,'successful retry commits one audit effect');
select * from finish();
rollback;
