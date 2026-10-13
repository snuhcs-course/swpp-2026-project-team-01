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

insert into fixture values('scope',public.fmat_conversation_access('open',pg_temp.f('host1'),'{"audience":"host_setup"}'));
insert into fixture values('other',public.fmat_conversation_access('open',pg_temp.f('host2'),'{"audience":"host_setup"}'));
insert into fixture values('shared',public.fmat_conversation_access('open',pg_temp.f('host1'),'{"audience":"request_shared","requestId":"83000000-0000-4000-8000-000000000001"}'));
update fmat.conversation_scopes set runtime_session_id='calendar-test'||id::text where id in(select (value->>'conversationId')::uuid from fixture where name in('scope','other','shared'));
insert into fmat.runtime_messages(id,conversation_id,grant_id,client_id,text)
select ('84000000-0000-4000-8000-00000000000'||n)::uuid,(pg_temp.f(label)->>'conversationId')::uuid,(pg_temp.f(label)->>'grantId')::uuid,gen_random_uuid(),'Choose my calendars'
from (values(1,'scope'),(2,'other'),(3,'shared')) t(n,label);
create function pg_temp.chat(text,jsonb default '{}',text default 'scope',uuid default '84000000-0000-4000-8000-000000000001',text default 'calendar-test') returns jsonb language sql as $$
select public.fmat_conversation_calendar((pg_temp.f($3)->>'grantId')::uuid,(pg_temp.f($3)->>'conversationId')::uuid,$5||(pg_temp.f($3)->>'conversationId'),$4,$1,$2)$$;
select ok(not has_function_privilege('anon','public.fmat_conversation_calendar(uuid,uuid,text,uuid,text,jsonb)','EXECUTE'),'anonymous denied');
select ok(not has_function_privilege('authenticated','public.fmat_conversation_calendar(uuid,uuid,text,uuid,text,jsonb)','EXECUTE'),'browser cannot forge current runtime');
select throws_ok($$select pg_temp.chat('read','{}','shared','84000000-0000-4000-8000-000000000003')$$,'P0001','FORBIDDEN','shared host audience denied');
select throws_ok($$select pg_temp.chat('read','{}','other','84000000-0000-4000-8000-000000000002')$$,'P0001','RECONNECT_REQUIRED','other host cannot read this connection');
select throws_ok($$select pg_temp.chat('read','{}','scope','84000000-0000-4000-8000-000000000002')$$,'P0001','UNAUTHORIZED','foreign message denied');
select throws_ok($$select pg_temp.chat('read','{}','scope','84000000-0000-4000-8000-000000000001','retired-session')$$,'P0001','FORBIDDEN','stale runtime denied');
insert into fixture values('grant',pg_temp.chat('read'));
insert into fixture values('choice','{"generation":"85000000-0000-4000-8000-000000000001","rulesVersion":0,"conflictCalendars":["cal_reference"],"bookingCalendar":"cal_reference"}');
insert into fixture values('selection',pg_temp.f('grant')||'{"conflictCalendarIds":["read-only","busy"],"bookingCalendarId":"write","verifiedCalendars":[{"id":"read-only","accessRole":"reader"},{"id":"busy","accessRole":"freeBusyReader"},{"id":"write","accessRole":"writer"}]}');
select is(pg_temp.chat('replay',jsonb_build_object('choice',pg_temp.f('choice'))),'null'::jsonb,'no inferred selection');
select throws_ok($$select pg_temp.chat('select',jsonb_build_object('choice',pg_temp.f('choice'),'selection',pg_temp.f('selection')||'{"bookingCalendarId":"read-only"}'))$$,'P0001','CALENDAR_ACCESS_INVALID','read-only destination rejected');
select is(pg_temp.chat('select',jsonb_build_object('choice',pg_temp.f('choice'),'selection',pg_temp.f('selection')))->>'saved','true','chat selects verified choices');
select is((select booking_calendar_id from fmat.hosts where id='80000000-0000-4000-8000-000000000001'),'write','exact destination persisted');
select is(pg_temp.chat('replay',jsonb_build_object('choice',pg_temp.f('choice')))->>'saved','true','lost result replays');
select throws_ok($$select pg_temp.chat('replay',jsonb_build_object('choice',pg_temp.f('choice')||'{"rulesVersion":2}'))$$,'P0001','IDEMPOTENCY_CONFLICT','changed same-message retry denied');
select is((select count(*)::int from fmat.audit_events where operation='calendar_save' and subject_id='80000000-0000-4000-8000-000000000001'),1,'one selection effect');
select ok((select rules is null from fmat.hosts where id='80000000-0000-4000-8000-000000000001'),'calendar selection never confirms preferences');
update fmat.calendar_connections set generation=gen_random_uuid() where principal_id='80000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.chat('check',pg_temp.f('grant'))$$,'P0001','REVISION_CONFLICT','reconnection fences provider response');
update fmat.runtime_messages set status='completed' where id='84000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.chat('read')$$,'P0001','UNAUTHORIZED','settled historical input cannot configure calendars');
update fmat.runtime_messages set status='pending' where id='84000000-0000-4000-8000-000000000001';
update fmat.conversation_grants set revoked_at=now() where id=(pg_temp.f('scope')->>'grantId')::uuid;
select throws_ok($$select pg_temp.chat('replay',jsonb_build_object('choice',pg_temp.f('choice')))$$,'P0001','UNAUTHORIZED','revoked grant denies replay');
select * from finish();rollback;
