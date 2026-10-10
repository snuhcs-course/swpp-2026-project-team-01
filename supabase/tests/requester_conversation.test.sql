begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temporary table requester_chat_fixture(name text primary key,value jsonb not null);
insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values
 ('20000000-0000-4000-8000-000000000001','host@conversation.test',repeat('6',64),now()+interval '1 day','fixture'),
 ('20000000-0000-4000-8000-000000000004','other@conversation.test',repeat('5',64),now()+interval '1 day','fixture');
insert into fmat.hosts(id,email,invitation_id,handle,display_name,rules,rules_version,conflict_calendar_ids,booking_calendar_id) values
 ('20000000-0000-4000-8000-000000000002','host@conversation.test','20000000-0000-4000-8000-000000000001','conversation-test','Conversation host','{"timezone":"UTC","durationMinutes":30,"availability":[{"days":[0,1,2,3,4,5,6],"start":"00:00","end":"23:59"}],"focusBlocks":[],"bufferMinutes":0,"travelMode":"TRANSIT","preferences":"PRIVATE"}',1,array['primary'],'primary'),
 ('20000000-0000-4000-8000-000000000003','other@conversation.test','20000000-0000-4000-8000-000000000004',null,null,null,0,'{}',null);
insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential) values('host','20000000-0000-4000-8000-000000000002','conversation-fixture',array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],'encrypted-fixture');
insert into requester_chat_fixture values
 ('host','{"kind":"host","id":"20000000-0000-4000-8000-000000000002","email":"host@conversation.test"}'),
 ('otherhost','{"kind":"host","id":"20000000-0000-4000-8000-000000000003","email":"other@conversation.test"}'),
 ('public','{"kind":"public"}'),
 ('details',jsonb_build_object('requesterName','Guest','requesterEmail','guest@conversation.test','purpose','Initial purpose','durationMinutes',30,'timezone','UTC','windows',jsonb_build_array(jsonb_build_object('start',now()+interval '1 day','end',now()+interval '3 days')),'mode','online','location','https://meet.example.test/conversation'));
create function pg_temp.chat_fixture(n text) returns jsonb language sql as $$select value from requester_chat_fixture where name=n$$;
insert into requester_chat_fixture values('request',public.fmat_command('request_create',pg_temp.chat_fixture('public'),jsonb_build_object('handle','conversation-test','details',pg_temp.chat_fixture('details'),'tokenHash',repeat('a',64),'idempotencyKey','chat-create')));
insert into requester_chat_fixture values('guest',jsonb_build_object('kind','guest','requestId',pg_temp.chat_fixture('request')->>'id','tokenHash',repeat('a',64)));
insert into requester_chat_fixture values('patch',jsonb_build_object('purpose','Reviewed purpose','windows',jsonb_build_array(jsonb_build_object('start',now()+interval '1 day','end',now()+interval '1 day 1 hour'),jsonb_build_object('start',now()+interval '2 days','end',now()+interval '2 days 1 hour'))));
insert into requester_chat_fixture values('clientInput',jsonb_build_object('requestId',pg_temp.chat_fixture('request')->>'id','expectedRevision',1,'reviewedRevision',1,'confirmed',true,'patch',pg_temp.chat_fixture('patch')));
insert into requester_chat_fixture values('updateInput',jsonb_build_object('requestId',pg_temp.chat_fixture('request')->>'id','details',pg_temp.chat_fixture('details')||pg_temp.chat_fixture('patch'),'expectedRevision',1,'clientInput',pg_temp.chat_fixture('clientInput'),'idempotencyKey','chat-review-fixed'));
create function pg_temp.chat_replay(client_input jsonb,who text default 'guest',mutation_key text default 'chat-review-fixed') returns jsonb language sql as $$
 select public.fmat_command('mutation_replay',pg_temp.chat_fixture(who),jsonb_build_object('requestId',pg_temp.chat_fixture('request')->>'id','operation','details_update','idempotencyKey',mutation_key,'clientInput',client_input))
$$;
select is((pg_temp.chat_replay(pg_temp.chat_fixture('clientInput'))->>'found')::boolean,false,'new reviewed patch has no replay before mutation');
insert into requester_chat_fixture values('saved',public.fmat_command('details_update',pg_temp.chat_fixture('guest'),pg_temp.chat_fixture('updateInput')));
select is(pg_temp.chat_fixture('saved')->'details'->>'purpose','Reviewed purpose','explicit reviewed patch becomes saved request details');
select is((pg_temp.chat_fixture('saved')->>'revision')::integer,2,'reviewed patch advances request revision once');
select is(public.fmat_command('details_update',pg_temp.chat_fixture('guest'),pg_temp.chat_fixture('updateInput')),pg_temp.chat_fixture('saved'),'same-key direct retry returns original result despite obsolete expected revision');
select is(pg_temp.chat_replay(pg_temp.chat_fixture('clientInput'))->'result',pg_temp.chat_fixture('saved'),'lost-response replay retrieves exact saved request before stale revision guard');
select public.fmat_command('message_add',pg_temp.chat_fixture('guest'),jsonb_build_object('requestId',pg_temp.chat_fixture('request')->>'id','expectedRevision',2,'text','Subsequent conversation turn','idempotencyKey','chat-next-turn'));
select is(pg_temp.chat_replay(pg_temp.chat_fixture('clientInput'))->'result',pg_temp.chat_fixture('saved'),'later conversation turn cannot replace original retry result');
select is((select revision from fmat.requests where id=(pg_temp.chat_fixture('request')->>'id')::uuid),3,'replay does not mutate current request revision');
select is((select count(*)::integer from fmat.request_history where request_id=(pg_temp.chat_fixture('request')->>'id')::uuid and operation='details_update'),1,'review retry does not insert duplicate details mutation');
select throws_ok($$select pg_temp.chat_replay(jsonb_set(pg_temp.chat_fixture('clientInput'),'{patch,purpose}','"Different purpose"'::jsonb))$$,'P0001','IDEMPOTENCY_CONFLICT','same key cannot replay changed patch scalar');
select throws_ok($$select pg_temp.chat_replay(jsonb_set(pg_temp.chat_fixture('clientInput'),'{patch,windows}',jsonb_build_array(pg_temp.chat_fixture('patch')->'windows'->1,pg_temp.chat_fixture('patch')->'windows'->0)))$$,'P0001','IDEMPOTENCY_CONFLICT','same key cannot reorder reviewed window array');
select throws_ok($$select pg_temp.chat_replay(jsonb_set(pg_temp.chat_fixture('clientInput'),'{patch,windows}',jsonb_build_array(pg_temp.chat_fixture('patch')->'windows'->0)))$$,'P0001','IDEMPOTENCY_CONFLICT','same key cannot replay a subset of reviewed windows');
select throws_ok($$select pg_temp.chat_replay(jsonb_set(pg_temp.chat_fixture('clientInput'),'{patch,windows}',(pg_temp.chat_fixture('patch')->'windows')||jsonb_build_array(pg_temp.chat_fixture('patch')->'windows'->0)))$$,'P0001','IDEMPOTENCY_CONFLICT','same key cannot add duplicate reviewed window');
select throws_ok($$select pg_temp.chat_replay(pg_temp.chat_fixture('clientInput')||'{"reviewedRevision":3}'::jsonb)$$,'P0001','IDEMPOTENCY_CONFLICT','same key cannot change explicit reviewed revision');
select throws_ok($$select pg_temp.chat_replay(pg_temp.chat_fixture('clientInput')-'confirmed')$$,'P0001','IDEMPOTENCY_CONFLICT','same key cannot omit explicit review confirmation');
select throws_ok($$select pg_temp.chat_replay(pg_temp.chat_fixture('clientInput')||'{"privateNotes":"forged"}'::jsonb)$$,'P0001','INVALID_INPUT','replay envelope excludes private mutation fields');
select throws_ok($$select pg_temp.chat_replay(pg_temp.chat_fixture('clientInput')||'{"requestId":"20000000-0000-4000-8000-000000000099"}'::jsonb)$$,'P0001','INVALID_INPUT','client replay request identity must match bound request');
select throws_ok($$select public.fmat_command('mutation_replay',pg_temp.chat_fixture('guest')||jsonb_build_object('tokenHash',repeat('b',64)),jsonb_build_object('requestId',pg_temp.chat_fixture('request')->>'id','operation','details_update','idempotencyKey','chat-review-fixed','clientInput',pg_temp.chat_fixture('clientInput')))$$,'P0001','NOT_FOUND','wrong guest continuation cannot retrieve cached conversation result');
select throws_ok($$select public.fmat_command('mutation_replay',pg_temp.chat_fixture('guest')||'{"requestId":"20000000-0000-4000-8000-000000000099"}'::jsonb,jsonb_build_object('requestId',pg_temp.chat_fixture('request')->>'id','operation','details_update','idempotencyKey','chat-review-fixed','clientInput',pg_temp.chat_fixture('clientInput')))$$,'P0001','NOT_FOUND','guest continuation remains request bound during replay');
select throws_ok($$select pg_temp.chat_replay(pg_temp.chat_fixture('clientInput'),'otherhost')$$,'P0001','NOT_FOUND','admitted unrelated host cannot retrieve cached guest review');
select is((pg_temp.chat_replay(pg_temp.chat_fixture('clientInput'),'host')->>'found')::boolean,false,'owning host cannot retrieve guest actor cache under identical key');
select throws_ok($$select pg_temp.chat_replay(pg_temp.chat_fixture('clientInput'),'public')$$,'P0001','FORBIDDEN','public actor cannot inspect review cache');
select is((pg_temp.chat_replay(pg_temp.chat_fixture('clientInput'),'guest','fresh-key')->>'found')::boolean,false,'new key has no saved retry exemption');
select throws_ok($$select public.fmat_command('details_update',pg_temp.chat_fixture('guest'),pg_temp.chat_fixture('updateInput')||'{"idempotencyKey":"fresh-key"}'::jsonb)$$,'P0001','REVISION_CONFLICT','stale new-key reviewed patch cannot overwrite later conversation');
select is((select revision from fmat.requests where id=(pg_temp.chat_fixture('request')->>'id')::uuid),3,'conflicting replays and stale new keys leave current request unchanged');
update fmat.requests set token_revoked_at=now() where id=(pg_temp.chat_fixture('request')->>'id')::uuid;
select throws_ok($$select pg_temp.chat_replay(pg_temp.chat_fixture('clientInput'))$$,'P0001','NOT_FOUND','revoked continuation cannot replay previously authorized result');
select * from finish();
rollback;
