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

create function pg_temp.setup(text,text,jsonb default '{}') returns jsonb language sql as $$select public.fmat_host_setup($1,pg_temp.f($2),$3)$$;
select ok(not has_function_privilege('anon','public.fmat_host_setup(text,jsonb,jsonb)','EXECUTE'),'anonymous cannot invoke setup RPC');
select ok(not has_function_privilege('authenticated','public.fmat_host_setup(text,jsonb,jsonb)','EXECUTE'),'browser cannot forge setup credentials');
select throws_ok($$select pg_temp.setup('read','guest1')$$,'P0001','FORBIDDEN','requester cannot read host drafts');
select throws_ok($$select pg_temp.setup('read','host3')$$,'P0001','HOST_NOT_ADMITTED','unadmitted host denied');
insert into fixture values('draft1','{"expectedRevision":0,"patch":{"displayName":"Private host","handle":"private-host","rules":{"timezone":"Asia/Seoul","durationMinutes":30,"availability":[{"days":[1,2,3,4,5],"start":"13:00","end":"17:00"}],"focusBlocks":[],"bufferMinutes":10,"preferences":"","meetingMode":"either","locationPolicy":"per_meeting","locations":[],"travelMode":"PER_TRIP","travelBufferMinutes":15}},"unresolved":[],"idempotencyKey":"draft-one"}');
select lives_ok($$select pg_temp.setup('draft','host1',pg_temp.f('draft1'))$$,'host saves explicit private draft');
select is(pg_temp.setup('read','host1')->>'revision','1','draft increments revision');
select is(pg_temp.setup('read','host1')->'confirmed'->>'handle',null,'draft does not save policy');
select is(pg_temp.setup('read','host2')->'draft','null'::jsonb,'other host cannot see draft');
select throws_ok($$select pg_temp.setup('read','host2','{"hostId":"80000000-0000-4000-8000-000000000001"}')$$,'P0001','INVALID_INPUT','cannot select another host');
select lives_ok($$select pg_temp.setup('draft','host1',pg_temp.f('draft1'))$$,'retry accepted without duplicate effect');
select is(pg_temp.setup('read','host1')->>'revision','1','replay has one revision');
select throws_ok($$select pg_temp.setup('draft','host1',pg_temp.f('draft1')||'{"patch":{"displayName":"Changed"}}')$$,'P0001','IDEMPOTENCY_CONFLICT','same identity different draft denied');
select throws_ok($$select pg_temp.setup('draft','host1',pg_temp.f('draft1')||'{"idempotencyKey":"stale"}')$$,'P0001','REVISION_CONFLICT','stale draft denied');
select throws_ok($$select pg_temp.setup('draft','host1','{"expectedRevision":1,"patch":{"handle":"app"},"unresolved":[],"idempotencyKey":"reserved"}')$$,'P0001','INVALID_INPUT','application routes reserved');
select throws_ok($$select pg_temp.setup('draft','host1','{"expectedRevision":1,"patch":{"rules":{"availability":[{"days":[9],"start":"13:00","end":"17:00"}]}},"unresolved":[],"idempotencyKey":"invalid"}')$$,'P0001','INVALID_INPUT','invalid weekly days denied');
insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential) values('host','80000000-0000-4000-8000-000000000001','fixture',array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],repeat('e',40));
update fmat.hosts set conflict_calendar_ids=array['mine'],booking_calendar_id='mine' where id='80000000-0000-4000-8000-000000000001';
insert into fixture values('confirm',jsonb_build_object('expectedRevision',1,'draftRevision',1,'reviewRevision',1,'rulesVersion',0,'calendarGeneration',pg_temp.setup('read','host1')->'calendarGeneration','confirmed',true,'idempotencyKey','confirm-one'));
select throws_ok($$select fmat.host_setup_operation('confirm',jsonb_build_object('kind','host','id','80000000-0000-4000-8000-000000000001','email','one@access.test'),pg_temp.f('confirm'),'assistant')$$,'P0001','FORBIDDEN','model cannot confirm settings');
select lives_ok($$select pg_temp.setup('confirm','host1',pg_temp.f('confirm'))$$,'current explicit review confirms');
select is(pg_temp.setup('read','host1')->'confirmed'->>'handle','private-host','confirmed settings persisted');
select is(pg_temp.setup('read','host1')->>'nextAction','settings_confirmed','confirmation state survives rules increment');
select lives_ok($$select pg_temp.setup('confirm_replay','host1',pg_temp.f('confirm'))$$,'lost acknowledgement replay is available before provider preflight');
select is((select rules_version::text from fmat.hosts where id='80000000-0000-4000-8000-000000000001'),'1','confirmation changes rules once');
select is((select count(*)::text from fmat.booking_attempts),'0','setup creates no booking effect');
-- Assistant suggestions never satisfy explicit applicable mode/location/travel choices.
select lives_ok($$select fmat.host_setup_operation('draft',jsonb_build_object('kind','host','id','80000000-0000-4000-8000-000000000002','email','two@access.test'),pg_temp.f('draft1'),'assistant')$$,'assistant can draft privately');
select is(pg_temp.setup('read','host2')->'review','null'::jsonb,'suggestions cannot create confirmable review without explicit choices');
select throws_ok($$select fmat.host_setup_operation('draft',jsonb_build_object('kind','host','id','80000000-0000-4000-8000-000000000001','email','one@access.test'),'{"expectedRevision":2,"patch":{"rules":{"meetingMode":"online"}},"unresolved":[],"idempotencyKey":"override"}','assistant')$$,'P0001','EXPLICIT_CHOICE_CONFLICT','assistant cannot overwrite explicit choice');
select lives_ok($$select pg_temp.setup('draft','host1','{"expectedRevision":2,"patch":{"rules":{"meetingMode":"online"}},"unresolved":[],"idempotencyKey":"online"}')$$,'host can explicitly correct choice');
select is(pg_temp.setup('read','host1')->'draft'->'settings'->'rules'->>'travelMode','NONE','online-only skips physical travel');
select is(jsonb_array_length(pg_temp.setup('read','host1')->'draft'->'unresolved'),0,'online-only review needs no venue/travel answer');
select throws_ok($$select pg_temp.setup('confirm','host1',pg_temp.f('confirm')||'{"idempotencyKey":"old-review"}')$$,'P0001','REVISION_CONFLICT','older confirmation cannot overwrite correction');
select ok(not(pg_temp.setup('read','host1')->'draft'->'provenance' ? 'rules.travelBufferMinutes'),'online normalization never fabricates explicit travel buffer');
insert into fixture values('setupgrant',public.fmat_conversation_access('open',pg_temp.f('host1'),'{"audience":"host_setup"}'));
create function pg_temp.tool(text,jsonb default '{}') returns jsonb language sql as $$select public.fmat_conversation_tool((pg_temp.f('setupgrant')->>'grantId')::uuid,(pg_temp.f('setupgrant')->>'conversationId')::uuid,$1,$2)$$;
select lives_ok($$select pg_temp.tool('setup_read')$$,'eve reads private setup through current execution authority');
select throws_ok($$select pg_temp.tool('setup_confirm',pg_temp.f('confirm'))$$,'P0001','FORBIDDEN','eve cannot invoke human confirmation');
select throws_ok($$select fmat.host_setup_operation('rebase',jsonb_build_object('kind','host','id','80000000-0000-4000-8000-000000000001','email','one@access.test'),'{"expectedRevision":3,"rulesVersion":1,"idempotencyKey":"model-refresh"}','assistant')$$,'P0001','FORBIDDEN','assistant cannot refresh stale human choices');
select lives_ok($$select fmat.host_setup_operation('draft',jsonb_build_object('kind','host','id','80000000-0000-4000-8000-000000000001','email','one@access.test'),'{"expectedRevision":3,"patch":{"displayName":"Private host"},"unresolved":[],"idempotencyKey":"echo-name"}','assistant')$$,'assistant may repeat a confirmed name without downgrading provenance');
select throws_ok($$select fmat.host_setup_operation('draft',jsonb_build_object('kind','host','id','80000000-0000-4000-8000-000000000001','email','one@access.test'),'{"expectedRevision":4,"patch":{"displayName":"Overwritten"},"unresolved":[],"idempotencyKey":"replace-name"}','assistant')$$,'P0001','EXPLICIT_CHOICE_CONFLICT','repeating a host name never permits later model replacement');
-- Host-only guidance choices persist without changing draft or saved rules.
select is(pg_temp.setup('read','host2')->'progress','{"analysisDecided":false,"dismissedSuggestions":[]}'::jsonb,'new host has no inferred guidance choices');
insert into fixture values('skip','{"expectedRevision":1,"choice":"skip_analysis","idempotencyKey":"skip"}');
select lives_ok($$select pg_temp.setup('progress','host2',pg_temp.f('skip'))$$,'host may skip optional analysis');
select is(pg_temp.setup('read','host2')->'progress'->>'analysisDecided','true','skip survives read');
select lives_ok($$select pg_temp.setup('progress','host2',pg_temp.f('skip'))$$,'skip retry reuses its result');
select is(pg_temp.setup('read','host2')->>'revision','2','skip replay has one effect');
select throws_ok($$select pg_temp.setup('progress','host2',pg_temp.f('skip')||'{"choice":"dismiss_mode"}')$$,'P0001','IDEMPOTENCY_CONFLICT','same key cannot change guidance intent');
select throws_ok($$select pg_temp.setup('progress','host2','{"expectedRevision":1,"choice":"dismiss_mode","idempotencyKey":"old-choice"}')$$,'P0001','REVISION_CONFLICT','stale guidance cannot advance conversation');
select throws_ok($$select fmat.host_setup_operation('progress',jsonb_build_object('kind','host','id','80000000-0000-4000-8000-000000000002','email','two@access.test'),'{"expectedRevision":2,"choice":"dismiss_mode","idempotencyKey":"model-choice"}','assistant')$$,'P0001','FORBIDDEN','model cannot manufacture skip or dismissal');
select lives_ok($$select pg_temp.setup('progress','host2','{"expectedRevision":2,"choice":"dismiss_schedule","idempotencyKey":"dismiss"}')$$,'dismiss schedule');
select is(pg_temp.setup('read','host2')->'progress'->'dismissedSuggestions','["schedule"]'::jsonb,'dismissal persists');
select throws_ok($$select fmat.host_setup_operation('draft',jsonb_build_object('kind','host','id','80000000-0000-4000-8000-000000000002','email','two@access.test'),'{"expectedRevision":3,"patch":{"rules":{"durationMinutes":45}},"unresolved":[],"idempotencyKey":"dismissed-model"}','assistant')$$,'P0001','EXPLICIT_CHOICE_CONFLICT','model cannot reintroduce dismissed schedule guesses');
select is(pg_temp.setup('read','host2')->'draft'->>'revision','1','guidance never changes draft');
select is(pg_temp.setup('read','host2')->'confirmed'->>'handle',null,'guidance never saves policy');
select lives_ok($$select pg_temp.setup('progress','host2','{"expectedRevision":3,"choice":"offer_schedule","idempotencyKey":"offer"}')$$,'host can explicitly ask for suggestions again');
select is(pg_temp.setup('read','host2')->'progress'->'dismissedSuggestions','[]'::jsonb,'explicit request restores suggestions');
select throws_ok($$select pg_temp.setup('progress','guest1','{"expectedRevision":4,"choice":"skip_analysis","idempotencyKey":"guest"}')$$,'P0001','FORBIDDEN','guest cannot change host progress');
select is((select count(*)::text from fmat.booking_attempts),'0','guidance creates no booking effects');
select throws_ok($$select pg_temp.setup('draft','host2','{"expectedRevision":4,"patch":{"rules":{"durationMinutes":45}},"unresolved":[],"starterFields":["durationMinutes"],"idempotencyKey":"false-default"}')$$,'P0001','INVALID_INPUT','nondefault value cannot claim starter origin');
insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('82000000-0000-4000-8000-000000000003','unadmitted@access.test',repeat('3',64),now()+interval '1 day','fixture');
insert into fmat.hosts(id,email,invitation_id) values('80000000-0000-4000-8000-000000000003','unadmitted@access.test','82000000-0000-4000-8000-000000000003');
select lives_ok($$select pg_temp.setup('draft','host3','{"expectedRevision":0,"patch":{"rules":{"durationMinutes":30}},"unresolved":[],"starterFields":["durationMinutes"],"idempotencyKey":"accept-default"}')$$,'host accepts actual starter');
select is(pg_temp.setup('read','host3')->'draft'->'origins'->'rules.durationMinutes'->>'source','starter','accepted starter retains its source separately from human authority');
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='81000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.setup('read','host1')$$,'P0001','UNAUTHORIZED','expired Auth session denies draft read');
select lives_ok($$select fmat.validate_setup_patch('{"rules":{"availability":[{"days":[1],"start":"22:00","end":"02:00"}]}}')$$,'overnight hours pass durable validation');
select lives_ok($$select fmat.validate_setup_patch('{"rules":{"availability":[{"days":[6],"start":"22:00","end":"00:00"}]}}')$$,'midnight end passes durable validation');
select throws_ok($$select fmat.validate_setup_patch('{"rules":{"availability":[{"days":[1],"start":"22:00","end":"22:00"}]}}')$$,'P0001','INVALID_INPUT','equal clocks cannot become all-day hours');
select throws_ok($$select fmat.validate_setup_patch('{"rules":{"availability":[{"days":[1],"start":"24:00","end":"02:00"}]}}')$$,'P0001','INVALID_INPUT','overnight support does not accept invalid clocks');
select lives_ok($$select fmat.validate_setup_patch('{"rules":{"availability":[{"days":[1],"start":"09:00","end":"17:00"}]}}')$$,'existing same-day rules remain valid');
select lives_ok($$select fmat.validate_rules((pg_temp.f('draft1')->'patch'->'rules')||'{"availability":[{"days":[1],"start":"22:00","end":"02:00"}]}')$$,'complete rules accept overnight hours');
select throws_ok($$select fmat.validate_rules((pg_temp.f('draft1')->'patch'->'rules')||'{"availability":[{"days":[1],"start":"22:00","end":"22:00"}]}')$$,'P0001','INVALID_INPUT','complete rules reject equal clocks');
select * from finish();rollback;
