begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(not has_function_privilege('anon','fmat.prune_calendar_scans()','execute'),'anonymous cannot maintain scans');
select ok(not has_function_privilege('authenticated','fmat.prune_calendar_scans()','execute'),'browser cannot maintain scans');
select ok(not has_function_privilege('service_role','fmat.prune_calendar_scans()','execute'),'application service has no global deletion capability');
select ok(has_function_privilege('postgres','fmat.prune_calendar_scans()','execute'),'database owner can maintain scans');
select ok(not (select prosecdef from pg_proc where oid='fmat.prune_calendar_scans()'::regprocedure),'maintenance does not elevate caller');
select is((select count(*)::integer from cron.job where jobname='fmat-calendar-scan-retention'),1,'one named retention job');
select ok((select active and schedule='* * * * *' and command='set statement_timeout=''5s''; select fmat.prune_calendar_scans();' and username='postgres' from cron.job where jobname='fmat-calendar-scan-retention'),'bounded minute scheduler runs as database owner');
select has_index('fmat','calendar_scans','calendar_scans_expiry_idx','global expiry index exists');
insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values ('a6000000-0000-4000-8000-000000000001','retention@example.test',repeat('6',64),now()+interval '1 day','fixture');
insert into fmat.hosts(id,email,invitation_id) values ('a6000000-0000-4000-8000-000000000002','retention@example.test','a6000000-0000-4000-8000-000000000001');
select fmat.ensure_setup_conversation('a6000000-0000-4000-8000-000000000002');
update fmat.setup_conversations set analysis_decided=true where host_id='a6000000-0000-4000-8000-000000000002';
insert into fmat.setup_drafts(conversation_id,revision,base_rules_version,settings) select id,1,0,'{"displayName":"Adopted value"}' from fmat.setup_conversations where host_id='a6000000-0000-4000-8000-000000000002';
insert into fmat.calendar_scan_dismissals values ('a6000000-0000-4000-8000-000000000002',repeat('7',64));
create temp table preserved as select jsonb_build_object(
 'host',(select to_jsonb(h) from fmat.hosts h where id='a6000000-0000-4000-8000-000000000002'),
 'draft',(select to_jsonb(d) from fmat.setup_drafts d join fmat.setup_conversations c on c.id=d.conversation_id where c.host_id='a6000000-0000-4000-8000-000000000002'),
 'progress',(select to_jsonb(c) from fmat.setup_conversations c where host_id='a6000000-0000-4000-8000-000000000002'),
 'jobs',(select count(*) from fmat.jobs),'requests',(select count(*) from fmat.requests),'bookings',(select count(*) from fmat.booking_attempts)) as value;
-- 1,005 old rows exercise the cap and every status; newest rows must survive.
insert into fmat.calendar_scans(host_id,input,key,generation,rules_version,revision,status,summary,created_at)
select 'a6000000-0000-4000-8000-000000000002','{"private":"scope"}',n::text,gen_random_uuid(),0,0,
 (array['running','ready','failed','dismissed','applied'])[1+n%5],'{"private":"summary"}',now()-interval '25 hours' from generate_series(1,1005)n;
insert into fmat.calendar_scans(host_id,input,key,generation,rules_version,revision,status,created_at)
select 'a6000000-0000-4000-8000-000000000002','{}','recent-'||n,gen_random_uuid(),0,0,'ready',now()-n*interval '1 hour' from generate_series(0,23)n;
select is(fmat.prune_calendar_scans(),1000,'first pass is bounded to one thousand');
select is((select count(*)::integer from fmat.calendar_scans where key not like 'recent-%'),5,'only five old rows remain');
select is(fmat.prune_calendar_scans(),5,'next pass removes backlog without host interaction');
select is(fmat.prune_calendar_scans(),0,'empty retry is idempotent');
select is((select count(*)::integer from fmat.calendar_scans where host_id='a6000000-0000-4000-8000-000000000002'),24,'all recent rows survive');
select is((select count(*)::integer from fmat.calendar_scan_dismissals where host_id='a6000000-0000-4000-8000-000000000002'),1,'dismissal fingerprint survives');
select is(jsonb_build_object(
 'host',(select to_jsonb(h) from fmat.hosts h where id='a6000000-0000-4000-8000-000000000002'),
 'draft',(select to_jsonb(d) from fmat.setup_drafts d join fmat.setup_conversations c on c.id=d.conversation_id where c.host_id='a6000000-0000-4000-8000-000000000002'),
 'progress',(select to_jsonb(c) from fmat.setup_conversations c where host_id='a6000000-0000-4000-8000-000000000002'),
 'jobs',(select count(*) from fmat.jobs),'requests',(select count(*) from fmat.requests),'bookings',(select count(*) from fmat.booking_attempts)),(select value from preserved),'durable decisions, progress and domain work are unchanged');
select * from finish();
rollback;
