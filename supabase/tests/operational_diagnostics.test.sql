begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(not has_function_privilege('anon','public.fmat_operational_snapshot(integer)','EXECUTE'),'anonymous inspection denied');
select ok(not has_function_privilege('authenticated','public.fmat_operational_snapshot(integer)','EXECUTE'),'ordinary authenticated inspection denied');
select ok(has_function_privilege('service_role','public.fmat_operational_snapshot(integer)','EXECUTE'),'server inspection allowed');
set local role anon;
select throws_ok($$select public.fmat_operational_snapshot(1)$$,'42501',null,'direct anonymous call denied');
reset role;
set local role authenticated;
select throws_ok($$select public.fmat_operational_snapshot(1)$$,'42501',null,'direct host call denied');
reset role;
select throws_ok($$select public.fmat_operational_snapshot(null)$$,'P0001','INVALID_INPUT','null limit denied');
select throws_ok($$select public.fmat_operational_snapshot(-1)$$,'P0001','INVALID_INPUT','negative limit denied');
select throws_ok($$select public.fmat_operational_snapshot(21)$$,'P0001','INVALID_INPUT','oversized limit denied');
select is((public.fmat_operational_snapshot()->>'sampleLimit')::integer,10,'default sample limit');
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('c9000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.signal(category text,lim integer default 10) returns jsonb language sql as $$select s from jsonb_array_elements(public.fmat_operational_snapshot(lim)->'signals')s where s->>'category'=$1$$;
select is(jsonb_array_length(public.fmat_operational_snapshot()->'signals'),13,'fixed complete category list');
select is(public.fmat_operational_snapshot()->'coverage','{"authorizationDenialEvents":"not_recorded","rejectedStaleActionEvents":"not_recorded","releaseReadiness":"not_assessed"}'::jsonb,'missing telemetry never reports healthy');
-- Projection-only rows isolate each ledger shape. Disable FK triggers only
-- while preparing rollback-only local fixtures; all reads run with them on.
set local session_replication_role=replica;
insert into fmat.jobs(id,kind,dedupe_key,payload,status,available_at,last_error,created_at,updated_at)
 select pg_temp.id(n),'SECRET_KIND',pg_temp.id(n)::text,'{"secret":"PRIVATE_PAYLOAD"}','pending',now()-interval '1 hour','PRIVATE_ERROR',now()-interval '2 hours',now()-interval '1 hour' from generate_series(1,25)n;
insert into fmat.jobs(id,kind,dedupe_key,status,available_at) values(pg_temp.id(26),'future','diagnostic-future','pending',now()+interval '1 hour');
insert into fmat.jobs(id,kind,dedupe_key,status,lease_token,lease_until,worker_id,updated_at)
 values(pg_temp.id(27),'private','diagnostic-expired','running',pg_temp.id(127),now()-interval '1 minute','PRIVATE_WORKER',now()),
 (pg_temp.id(28),'private','diagnostic-live','running',pg_temp.id(128),now()+interval '1 hour','PRIVATE_WORKER',now());
insert into fmat.jobs(id,kind,dedupe_key,status,last_error) values(pg_temp.id(29),'private','diagnostic-dead','dead','PRIVATE_ERROR');
insert into fmat.runtime_messages(id,conversation_id,grant_id,client_id,text,status,created_at)
 values(pg_temp.id(30),pg_temp.id(130),pg_temp.id(230),pg_temp.id(330),'PRIVATE_TRANSCRIPT','pending',now()-interval '1 hour'),
 (pg_temp.id(31),pg_temp.id(131),pg_temp.id(231),pg_temp.id(331),'PRIVATE_TRANSCRIPT','failed',now()-interval '1 hour');
insert into fmat.booking_attempts(id,request_id,host_id,proposal_version,approval_id,expected_revision,rules_version,connection_id,connection_provider_subject,calendar_id,event_id,payload,payload_fingerprint,starts_at,ends_at,phase,dispatched_at)
 values(pg_temp.id(40),pg_temp.id(140),pg_temp.id(240),1,pg_temp.id(340),1,1,pg_temp.id(440),'PRIVATE_SUBJECT','PRIVATE_CALENDAR','abcd0123','{"secret":"PRIVATE_EVENT"}','PRIVATE_FINGERPRINT',now()+interval '1 day',now()+interval '2 days','uncertain',now()-interval '1 hour');
insert into fmat.host_reservations(host_id,attempt_id) values(pg_temp.id(240),pg_temp.id(40));
insert into fmat.outbox(id,dedupe_key,audience,recipient,payload,status,provider_reference)
 values(pg_temp.id(50),'diagnostic-failed','requester','{"email":"PRIVATE_EMAIL"}','{"secret":"PRIVATE_MESSAGE"}','failed','PRIVATE_PROVIDER'),
 (pg_temp.id(51),'diagnostic-uncertain','host','{"email":"PRIVATE_EMAIL"}','{"secret":"PRIVATE_MESSAGE"}','uncertain','PRIVATE_PROVIDER');
insert into fmat.photon_replies(id,inbox_id,project_id,text,status,provider_reference,revoked_at)
 values(pg_temp.id(60),pg_temp.id(160),pg_temp.id(260),'PRIVATE_TEXT','failed','PRIVATE_PROVIDER',null),
 (pg_temp.id(61),pg_temp.id(161),pg_temp.id(260),'PRIVATE_TEXT','uncertain','PRIVATE_PROVIDER',null),
 (pg_temp.id(62),pg_temp.id(162),pg_temp.id(260),'PRIVATE_TEXT','uncertain','PRIVATE_PROVIDER',now());
insert into fmat.requester_email_replies(id,receipt_id,runtime_message_id,link_id,inbox_id,receiver_id,thread_id,parent_message_id,recipient,text,status,first_attempt_at,suppressed_at)
 values(pg_temp.id(70),pg_temp.id(170),pg_temp.id(270),pg_temp.id(370),'PRIVATE_INBOX',pg_temp.id(470),'PRIVATE_THREAD','PRIVATE_PARENT','PRIVATE_RECIPIENT','PRIVATE_TEXT','uncertain',now()-interval '1 hour',null),
 (pg_temp.id(71),pg_temp.id(171),pg_temp.id(271),pg_temp.id(371),'PRIVATE_INBOX',pg_temp.id(470),'PRIVATE_THREAD','PRIVATE_PARENT','PRIVATE_RECIPIENT','PRIVATE_TEXT','uncertain',now()-interval '1 hour',now());
insert into fmat.requests(id,host_id,status,details,token_hash,expires_at,current_proposal_version,requester_agreed_version,private_notes)
 values(pg_temp.id(80),pg_temp.id(180),'awaiting_approval','{"secret":"PRIVATE_DETAILS"}',repeat('c',64),now()+interval '1 day',2,1,'PRIVATE_NOTES');
set local session_replication_role=origin;
create temporary table prior as select jsonb_build_object(
 'jobs',(select jsonb_agg(to_jsonb(t) order by id) from fmat.jobs t),
 'messages',(select jsonb_agg(to_jsonb(t) order by id) from fmat.runtime_messages t),
 'attempts',(select jsonb_agg(to_jsonb(t) order by id) from fmat.booking_attempts t),
 'reservations',(select jsonb_agg(to_jsonb(t) order by host_id) from fmat.host_reservations t),
 'outbox',(select jsonb_agg(to_jsonb(t) order by id) from fmat.outbox t),
 'photon',(select jsonb_agg(to_jsonb(t) order by id) from fmat.photon_replies t),
 'email',(select jsonb_agg(to_jsonb(t) order by id) from fmat.requester_email_replies t),
 'requests',(select jsonb_agg(to_jsonb(t) order by id) from fmat.requests t),
 'auditCount',(select count(*) from fmat.audit_events)) as value;
select is((pg_temp.signal('overdue_jobs')->>'count')::integer,25,'all overdue jobs counted, future job excluded');
select is(jsonb_array_length(pg_temp.signal('overdue_jobs')->'samples'),10,'default sample bounded');
select is(jsonb_array_length(pg_temp.signal('overdue_jobs',20)->'samples'),20,'maximum sample bounded');
select is(jsonb_array_length(pg_temp.signal('overdue_jobs',0)->'samples'),0,'aggregate-only snapshot');
select is(pg_temp.signal('overdue_jobs',2)->'samples'->0->>'id',pg_temp.id(1)::text,'UUID breaks oldest timestamp tie');
select is(pg_temp.signal('overdue_jobs',2)->'samples'->1->>'id',pg_temp.id(2)::text,'deterministic second sample');
select is((pg_temp.signal('overdue_jobs')->>'oldestAt')::timestamptz,now()-interval '1 hour','oldest due time reported');
select is((pg_temp.signal(category)->>'count')::integer,1,category||' contributes one eligible record') from unnest(array['expired_job_leases','dead_jobs','pending_runtime','failed_runtime','held_reservations','uncertain_bookings','failed_delivery','uncertain_delivery','failed_photon_replies','uncertain_photon_replies','uncertain_email_replies','mismatched_decisions'])category;
select ok(public.fmat_operational_snapshot()::text !~ 'PRIVATE_|SECRET_KIND|abcd0123','all private text, kinds, identities and provider references omitted');
select is((public.fmat_operational_snapshot()->>'ageThresholdSeconds')::integer,300,'age threshold explicit');
select ok((public.fmat_operational_snapshot()->>'observedAt')::timestamptz>=now(),'database observation timestamp');
set local role service_role;
select lives_ok($$select public.fmat_operational_snapshot(1)$$,'service credential reads through RPC without private table access');
reset role;
select is(jsonb_build_object(
 'jobs',(select jsonb_agg(to_jsonb(t) order by id) from fmat.jobs t),
 'messages',(select jsonb_agg(to_jsonb(t) order by id) from fmat.runtime_messages t),
 'attempts',(select jsonb_agg(to_jsonb(t) order by id) from fmat.booking_attempts t),
 'reservations',(select jsonb_agg(to_jsonb(t) order by host_id) from fmat.host_reservations t),
 'outbox',(select jsonb_agg(to_jsonb(t) order by id) from fmat.outbox t),
 'photon',(select jsonb_agg(to_jsonb(t) order by id) from fmat.photon_replies t),
 'email',(select jsonb_agg(to_jsonb(t) order by id) from fmat.requester_email_replies t),
 'requests',(select jsonb_agg(to_jsonb(t) order by id) from fmat.requests t),
 'auditCount',(select count(*) from fmat.audit_events)),(select value from prior),'inspection changes no persisted state or audit count');
select * from finish();
rollback;
