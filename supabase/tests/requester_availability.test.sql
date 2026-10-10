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

create function pg_temp.availability(text,text,jsonb default '{}') returns jsonb language sql as $$select public.fmat_requester_availability($1,pg_temp.f($2),$3)$$;
update fmat.requests set availability_mode='calendar' where id='83000000-0000-4000-8000-000000000001';
insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential,guest_authority_key)
values('guest','83000000-0000-4000-8000-000000000001','guest-fixture',array['https://www.googleapis.com/auth/calendar.events.freebusy','https://www.googleapis.com/auth/calendar.calendarlist.readonly'],repeat('e',40),repeat('a',64));
insert into fixture values('grant',pg_temp.availability('read','guest1'));
insert into fixture values('selection',pg_temp.f('grant')||'{"calendarIds":["mine"],"verifiedCalendarIds":["mine"]}');
select lives_ok($$select fmat.normalize_details(fmat.normalize_details('{}'))$$,'partial request normalization remains editable');
select ok(not has_function_privilege('anon','public.fmat_requester_availability(text,jsonb,jsonb)','EXECUTE'),'anonymous cannot invoke availability RPC');
select ok(not has_function_privilege('authenticated','public.fmat_requester_availability(text,jsonb,jsonb)','EXECUTE'),'host/browser cannot forge guest authority');
select ok(has_function_privilege('service_role','public.fmat_requester_availability(text,jsonb,jsonb)','EXECUTE'),'service can invoke narrow RPC');
select throws_ok($$select pg_temp.availability('read','host1')$$,'P0001','FORBIDDEN','host cannot inspect requester Calendar');
select throws_ok($$select pg_temp.availability('read','guest2')$$,'P0001','RECONNECT_REQUIRED','another request cannot inspect grant');
select throws_ok($$select public.fmat_requester_availability('read',pg_temp.f('guest1')||jsonb_build_object('requestId','83000000-0000-4000-8000-000000000002'),'{}')$$,'P0001','NOT_FOUND','swapped request with old secret denied');
select ok(not(pg_temp.availability('status','guest1') ?| array['encryptedCredential','scopes','providerSubject']),'status excludes secrets');
select throws_ok($$select pg_temp.availability('select','guest1',pg_temp.f('selection')||'{"calendarIds":["other"]}')$$,'P0001','CALENDAR_ACCESS_INVALID','unverified calendar denied');
select lives_ok($$select pg_temp.availability('select','guest1',pg_temp.f('selection'))$$,'explicit calendars selected');
select is(pg_temp.availability('status','guest1')->>'revision','2','selection invalidates scheduling revision');
select throws_ok($$select pg_temp.availability('select','guest1',pg_temp.f('selection'))$$,'P0001','REVISION_CONFLICT','stale selection denied');
update fixture set value=pg_temp.availability('read','guest1') where name='grant';
select lives_ok($$select pg_temp.availability('read_failure','guest1',pg_temp.f('grant'))$$,'failed required read persists pause');
select is(pg_temp.availability('status','guest1')->>'failed','true','failed read remains explicit');
select is(pg_temp.availability('status','guest1')->>'revision','3','failed read invalidates scheduling results');
select throws_ok($$select pg_temp.availability('read_success','guest1',pg_temp.f('grant'))$$,'P0001','REVISION_CONFLICT','earlier successful response cannot erase later failure');
select public.fmat_calendar_consent('disconnect',pg_temp.f('guest1'),'{}');
select is(pg_temp.availability('status','guest1')->>'mode','calendar','disconnect alone does not assume manual availability');
select throws_ok($$select pg_temp.availability('read','guest1')$$,'P0001','RECONNECT_REQUIRED','disconnected reads pause');
insert into fixture values('manual',jsonb_build_object('revision',pg_temp.availability('status','guest1')->'revision','confirmed',true,'timezone','Asia/Seoul','windows',jsonb_build_array(jsonb_build_object('start',now()+interval '1 day','end',now()+interval '1 day 1 hour'))));
select throws_ok($$select pg_temp.availability('manual','guest1',pg_temp.f('manual')||'{"confirmed":false}')$$,'P0001','INVALID_INPUT','manual replacement needs explicit confirmation');
select lives_ok($$select pg_temp.availability('manual','guest1',pg_temp.f('manual'))$$,'explicit valid windows replace Google');
select is(pg_temp.availability('status','guest1')->>'mode','manual','manual mode saved');
select is(pg_temp.availability('status','guest1')->>'failed','false','manual confirmation resolves Calendar dependency');
select is(pg_temp.availability('status','guest1')->>'connected','false','manual replacement removes grant');
update fmat.calendar_connections set encrypted_credential=repeat('x',40),revoked_at=null where principal_id='83000000-0000-4000-8000-000000000001';
update fmat.requests set token_hash=repeat('c',64) where id='83000000-0000-4000-8000-000000000001';
select is((select encrypted_credential from fmat.calendar_connections where principal_id='83000000-0000-4000-8000-000000000001'),null,'credential rotation deletes refresh material');
update fmat.calendar_connections set encrypted_credential=repeat('x',40),revoked_at=null where principal_id='83000000-0000-4000-8000-000000000001';
update fmat.requests set status='declined' where id='83000000-0000-4000-8000-000000000001';
select is((select encrypted_credential from fmat.calendar_connections where principal_id='83000000-0000-4000-8000-000000000001'),null,'closure deletes refresh material');
select * from finish();rollback;
