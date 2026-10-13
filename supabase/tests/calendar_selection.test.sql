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

create function pg_temp.access(text,text,jsonb default '{}') returns jsonb language sql as $$select public.fmat_calendar_access($1,pg_temp.f($2),$3)$$;
insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential)
values('host','80000000-0000-4000-8000-000000000001','google-fixture',array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],repeat('e',40));
insert into fixture values('grant',pg_temp.access('read','host1'));
insert into fixture values('selection',pg_temp.f('grant')||'{"conflictCalendarIds":["read-only","busy"],"bookingCalendarId":"write","verifiedCalendars":[{"id":"read-only","accessRole":"reader"},{"id":"busy","accessRole":"freeBusyReader"},{"id":"write","accessRole":"writerWithoutPrivateAccess"}]}');
select ok(not has_function_privilege('anon','public.fmat_calendar_access(text,jsonb,jsonb)','EXECUTE'),'anonymous cannot invoke Calendar access');
select ok(not has_function_privilege('authenticated','public.fmat_calendar_access(text,jsonb,jsonb)','EXECUTE'),'browser cannot forge provider metadata');
select ok(has_function_privilege('service_role','public.fmat_calendar_access(text,jsonb,jsonb)','EXECUTE'),'service may invoke narrow access');
select throws_ok($$select pg_temp.access('read','guest1')$$,'P0001','FORBIDDEN','guest cannot obtain host Calendar grant');
select throws_ok($$select pg_temp.access('read','host2')$$,'P0001','RECONNECT_REQUIRED','another host cannot discover grant');
select throws_ok($$select pg_temp.access('read','host3')$$,'P0001','HOST_NOT_ADMITTED','unadmitted identity cannot list');
select is(pg_temp.f('grant')->>'bookingCalendarId',null,'no implicit primary destination');
select throws_ok($$select pg_temp.access('select','host1',pg_temp.f('selection')||'{"bookingCalendarId":"read-only"}')$$,'P0001','CALENDAR_ACCESS_INVALID','read-only booking denied');
select throws_ok($$select pg_temp.access('select','host1',pg_temp.f('selection')||'{"bookingCalendarId":"unknown"}')$$,'P0001','CALENDAR_ACCESS_INVALID','no fallback for unknown booking');
select throws_ok($$select pg_temp.access('select','host1',pg_temp.f('selection')||'{"conflictCalendarIds":["unknown"]}')$$,'P0001','CALENDAR_ACCESS_INVALID','unverified conflict denied');
select throws_ok($$select pg_temp.access('select','host1',pg_temp.f('selection')||'{"conflictCalendarIds":[]}')$$,'P0001','INVALID_INPUT','empty conflicts denied');
select lives_ok($$select pg_temp.access('select','host1',pg_temp.f('selection'))$$,'explicit authorized choices saved');
select is((select booking_calendar_id from fmat.hosts where id='80000000-0000-4000-8000-000000000001'),'write','exact destination persisted');
select throws_ok($$select pg_temp.access('select','host1',pg_temp.f('selection'))$$,'P0001','REVISION_CONFLICT','old setup revision cannot overwrite');
select lives_ok($$select pg_temp.access('refresh','host1',pg_temp.f('grant')||jsonb_build_object('previousCredential',repeat('e',40),'encryptedCredential',repeat('n',40)))$$,'current refresh saved');
select throws_ok($$select pg_temp.access('refresh','host1',pg_temp.f('grant')||jsonb_build_object('previousCredential',repeat('e',40),'encryptedCredential',repeat('x',40)))$$,'P0001','REVISION_CONFLICT','stale refresh cannot overwrite newer credentials');
update fmat.calendar_connections set generation=gen_random_uuid() where principal_id='80000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.access('check','host1',pg_temp.f('grant'))$$,'P0001','REVISION_CONFLICT','reconnect fences in-flight metadata');
select throws_ok($$select pg_temp.access('select','host1',pg_temp.f('selection'))$$,'P0001','REVISION_CONFLICT','reconnect fences choices');
select public.fmat_calendar_consent('disconnect',pg_temp.f('host1'),'{}');
select throws_ok($$select pg_temp.access('read','host1')$$,'P0001','RECONNECT_REQUIRED','disconnected grant unusable');
select is((select encrypted_credential from fmat.calendar_connections where principal_id='80000000-0000-4000-8000-000000000001'),null,'refresh material removed');
select * from finish();rollback;
