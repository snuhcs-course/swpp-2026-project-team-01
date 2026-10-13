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

create function pg_temp.scan(text,text,jsonb default '{}') returns jsonb language sql as $$select public.fmat_calendar_scan($1,pg_temp.f($2),$3)$$;
select ok(not has_function_privilege('anon','public.fmat_calendar_scan(text,jsonb,jsonb)','EXECUTE'),'anonymous cannot scan');
select ok(not has_function_privilege('authenticated','public.fmat_calendar_scan(text,jsonb,jsonb)','EXECUTE'),'browser cannot forge scan identity');
select throws_ok($$select pg_temp.scan('read','guest1')$$,'P0001','FORBIDDEN','requester cannot read host scans');
select throws_ok($$select pg_temp.scan('read','host3')$$,'P0001','HOST_NOT_ADMITTED','unadmitted host cannot scan');
select is(pg_temp.scan('read','host1')->'scan','null'::jsonb,'empty scan state');
insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential) values('host','80000000-0000-4000-8000-000000000001','fixture',array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],repeat('e',40));
insert into fixture values('scan',jsonb_build_object('expectedRevision',0,'rulesVersion',0,'generation',(select generation from fmat.calendar_connections where principal_id='80000000-0000-4000-8000-000000000001'),'consented',true,'idempotencyKey','first','scope',jsonb_build_object('calendarIds',array['mine'],'startDate',current_date,'endDate',current_date+28,'timezone','UTC'),'verifiedCalendars','[{"id":"mine","accessRole":"reader"}]'::jsonb));
select throws_ok($$select pg_temp.scan('start','host1',pg_temp.f('scan')||'{"consented":false}')$$,'P0001','INVALID_INPUT','scan requires explicit disclosure consent');
select throws_ok($$select pg_temp.scan('start','host1',pg_temp.f('scan')||'{"verifiedCalendars":[{"id":"other","accessRole":"owner"}]}')$$,'P0001','CALENDAR_ACCESS_INVALID','unselected unauthorized calendar rejected');
select throws_ok($$select pg_temp.scan('start','host1',pg_temp.f('scan')||'{"verifiedCalendars":[{"id":"mine","accessRole":"freeBusyReader"}]}')$$,'P0001','CALENDAR_ACCESS_INVALID','freebusy-only access cannot read events');
insert into fmat.setup_drafts(conversation_id,revision,base_rules_version,settings,unresolved) select id,1,0,'{"displayName":"Private"}','{}' from fmat.setup_conversations where host_id='80000000-0000-4000-8000-000000000001';
insert into fmat.setup_reviews(conversation_id,revision,draft_revision,settings) select id,1,1,'{"displayName":"Private"}' from fmat.setup_conversations where host_id='80000000-0000-4000-8000-000000000001';
insert into fixture values('started',pg_temp.scan('start','host1',pg_temp.f('scan')));
select is((select status from fmat.setup_reviews where conversation_id=(select id from fmat.setup_conversations where host_id='80000000-0000-4000-8000-000000000001')),'superseded','fresh analysis invalidates a prior pending review');
select is(pg_temp.f('started')->>'execute','true','one caller owns provider dispatch');
select is(pg_temp.scan('start','host1',pg_temp.f('scan'))->>'execute','false','retry never redispatches provider read');
select throws_ok($$select pg_temp.scan('start','host1',jsonb_set(pg_temp.f('scan'),'{scope,timezone}','"Asia/Seoul"'))$$,'P0001','IDEMPOTENCY_CONFLICT','same key different scope rejected');
select is(pg_temp.scan('read','host2')->'scan','null'::jsonb,'cross-host scan is hidden');
insert into fixture values('complete',jsonb_build_object('scanId',pg_temp.f('started')->'id','summary','{"eventCount":0,"busyCount":0,"days":28,"windowSource":"starter","windows":[{"days":[1,2,3,4,5],"start":"13:00","end":"17:00"}],"onlineCount":0,"physicalCount":0,"locations":[],"limitations":["sparse"]}'::jsonb));
select lives_ok($$select pg_temp.scan('complete','host1',pg_temp.f('complete'))$$,'complete private summary');
select ok(not (fmat.calendar_scan_model_view('80000000-0000-4000-8000-000000000001')->'scan'->'summary' ? 'locations'),'model summary excludes observed locations');
select ok(not (fmat.calendar_scan_model_view('80000000-0000-4000-8000-000000000001')->'scan'->'scope' ? 'calendarIds'),'model summary excludes calendar identities');
select is(pg_temp.scan('read','host1')->'scan'->>'status','ready','fresh result is ready');
insert into fixture values('apply',jsonb_build_object('scanId',pg_temp.f('started')->'id','expectedRevision',1,'idempotencyKey','apply-first'));
select lives_ok($$select pg_temp.scan('apply','host1',pg_temp.f('apply'))$$,'suggestions apply only to draft');
select is((select rules from fmat.hosts where id='80000000-0000-4000-8000-000000000001'),null,'confirmed policy unchanged');
select is(pg_temp.scan('read','host1')->'scan'->>'status','applied','application advances scan revision');
select lives_ok($$select pg_temp.scan('apply','host1',pg_temp.f('apply'))$$,'applied result is replayable');
select throws_ok($$select pg_temp.scan('apply','host1',pg_temp.f('apply')||'{"expectedRevision":2}')$$,'P0001','IDEMPOTENCY_CONFLICT','applied key cannot change input');
select is((select count(*)::text from fmat.booking_attempts),'0','analysis never books');
-- Rich evidence supports explicit edited windows and private place choices atomically.
insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential) values('host','80000000-0000-4000-8000-000000000002','fixture-two',array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],repeat('f',40));
insert into fixture values('rich-start',pg_temp.scan('start','host2',pg_temp.f('scan')||jsonb_build_object('generation',(select generation from fmat.calendar_connections where principal_id='80000000-0000-4000-8000-000000000002'))));
select lives_ok($$select pg_temp.scan('complete','host2',jsonb_build_object('scanId',pg_temp.f('rich-start')->'id','summary','{"eventCount":8,"busyCount":8,"days":28,"windowSource":"calendar","windows":[{"days":[1],"start":"13:00","end":"15:00"}],"onlineCount":2,"physicalCount":6,"locations":[{"label":"Library room","count":6}],"limitations":[]}'::jsonb))$$,'rich summary is ready');
insert into fixture values('rich-apply',jsonb_build_object('scanId',pg_temp.f('rich-start')->'id','expectedRevision',1,'idempotencyKey','rich-choice','windows','[{"days":[2],"start":"14:00","end":"16:00"}]'::jsonb,'meetingMode','either','location','{"policy":"preferred","places":[{"index":0,"label":"Library lounge"}]}'::jsonb));
select throws_ok($$select pg_temp.scan('apply','host2',pg_temp.f('rich-apply')-'meetingMode')$$,'P0001','INVALID_INPUT','observed places cannot imply meeting mode');
select throws_ok($$select pg_temp.scan('apply','host2',jsonb_set(pg_temp.f('rich-apply'),'{location,places,0,index}','4'))$$,'P0001','INVALID_INPUT','candidate must exist in authorized scan');
select throws_ok($$select pg_temp.scan('apply','host2',pg_temp.f('rich-apply')||'{"meetingMode":"online"}')$$,'P0001','INVALID_INPUT','online choice cannot accept a physical place');
select throws_ok($$select pg_temp.scan('apply','host2',pg_temp.f('rich-apply')||'{"origins":{"rules.locations":{"source":"host"}}}')$$,'P0001','INVALID_INPUT','caller cannot forge suggestion provenance');
select lives_ok($$select pg_temp.scan('apply','host2',pg_temp.f('rich-apply'))$$,'explicit review applies edited windows and places in one draft');
select is(public.fmat_host_setup('read',pg_temp.f('host2'),'{}')->'draft'->'settings'->'rules'->'locations','["Library lounge"]'::jsonb,'only explicitly chosen edited place enters draft');
select is(public.fmat_host_setup('read',pg_temp.f('host2'),'{}')->'draft'->'origins'->'rules.locations'->>'source','calendar_edited','edited place keeps evidence provenance');
select is(public.fmat_host_setup('read',pg_temp.f('host2'),'{}')->'draft'->'origins'->'rules.availability'->>'source','calendar_edited','edited windows keep evidence provenance');
select is(public.fmat_host_setup('read',pg_temp.f('host2'),'{}')->'draft'->'origins'->'rules.durationMinutes'->>'source','starter','missing duration is honestly a starter');
select is(public.fmat_host_setup('read',pg_temp.f('host2'),'{}')->'draft'->'provenance'->>'rules.meetingMode','host','protected mode choice is explicit');
select is(public.fmat_host_setup('read',pg_temp.f('host2'),'{}')->'confirmed'->'rules','null'::jsonb,'reviewed suggestions still do not save policy');
select lives_ok($$select pg_temp.scan('apply','host2',pg_temp.f('rich-apply'))$$,'reviewed choice replays once');
select throws_ok($$select pg_temp.scan('apply','host2',jsonb_set(pg_temp.f('rich-apply'),'{location,places,0,label}','"Changed retry"'))$$,'P0001','IDEMPOTENCY_CONFLICT','changed edited place cannot reuse decision identity');
select lives_ok($$select public.fmat_host_setup('draft',pg_temp.f('host2'),'{"expectedRevision":2,"patch":{"rules":{"travelMode":"PER_TRIP","travelBufferMinutes":15}},"unresolved":[],"idempotencyKey":"travel-after-review"}')$$,'transportation remains a separate explicit decision');
select is(public.fmat_host_setup('read',pg_temp.f('host2'),'{}')->'draft'->'origins'->'rules.locations'->>'source','calendar_edited','unrelated edit preserves place origin');
select lives_ok($$select public.fmat_host_setup('draft',pg_temp.f('host2'),'{"expectedRevision":3,"patch":{"rules":{"locations":["A different place"]}},"unresolved":[],"idempotencyKey":"manual-place"}')$$,'host can correct the place later');
select is(public.fmat_host_setup('read',pg_temp.f('host2'),'{}')->'draft'->'origins'->'rules.locations','{"source":"host"}'::jsonb,'manual replacement no longer claims calendar evidence');
select is((select count(*)::text from fmat.booking_attempts),'0','review choices create no booking work');
update fmat.hosts set rules_version=rules_version+1 where id='80000000-0000-4000-8000-000000000001';
select is(pg_temp.scan('read','host1')->'scan'->>'status','stale','changed calendar/settings rules invalidate scan');
select is(pg_temp.scan('read','host1')->'scan'->'summary','null'::jsonb,'stale data is not suggested');
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='81000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.scan('read','host1')$$,'P0001','UNAUTHORIZED','expired host session denies scan');
select * from finish();rollback;
