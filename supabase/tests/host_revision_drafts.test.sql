begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) select ('b0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'link'||n||'@example.test',now() from generate_series(1,8)n;
insert into auth.sessions(id,user_id) select ('b1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('b0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,8)n;
insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) select ('b2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'link'||n||'@example.test',md5(n::text)||md5(n::text),now()+interval '1 day','fixture' from generate_series(1,7)n;
insert into fmat.hosts(id,email,invitation_id) select ('b0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'link'||n||'@example.test',('b2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,7)n;
insert into fmat.photon_receivers values('b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',true,now());
create function pg_temp.credential(n integer) returns jsonb language sql as $$select jsonb_build_object('kind','host','subject','b0000000-0000-4000-8000-'||lpad(n::text,12,'0'),'sessionId','b1000000-0000-4000-8000-'||lpad(n::text,12,'0'),'expiresAt',now()+interval '1 hour')$$;
create function pg_temp.input(n integer) returns jsonb language sql as $$select jsonb_build_object('phone','+1555010000'||n,'spaceId','any;-;+1555010000'||n,'line','shared','browserHash',repeat('b',64),'codeHash',repeat('c',64),'encryptedCode',repeat('e',40),'challengeId','b5000000-0000-4000-8000-'||lpad(n::text,12,'0'),'idempotencyKey','b6000000-0000-4000-8000-'||lpad(n::text,12,'0'))$$;
create function pg_temp.link(op text,n integer,input jsonb default '{}') returns jsonb language sql as $$select public.fmat_photon_link(op,pg_temp.credential(n),'b3000000-0000-4000-8000-000000000001',input)$$;
create function pg_temp.delivery(op text,input jsonb default '{}') returns jsonb language sql as $$select public.fmat_photon_link_delivery(op,'b3000000-0000-4000-8000-000000000001',input)$$;
create temporary table fixture(name text primary key,value jsonb);
create function pg_temp.f(text) returns jsonb language sql as $$select value from fixture where name=$1$$;

create function pg_temp.receive(n integer,key text,overrides jsonb default '{}') returns jsonb language sql as $$
 select public.fmat_photon_ingress('b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',
 jsonb_build_object('messageId',key,'senderId','+1555010000'||n,'line','shared','spaceId','any;-;+1555010000'||n,'text','Synthetic private preference',
 'occurredAt',coalesce((select occurred_at from fmat.photon_inbox where message_id=key),clock_timestamp()))||overrides)
$$;
create function pg_temp.dispatch() returns text language sql as $$select public.fmat_photon_dispatch('b3000000-0000-4000-8000-000000000001')->>'outcome'$$;
create function pg_temp.runtime(key text,op text,input jsonb default '{}') returns jsonb language sql as $$
 select public.fmat_runtime_message(op,m.grant_id,m.conversation_id,jsonb_build_object('messageId',m.id,'sessionId','reply-'||m.conversation_id)||input)
 from fmat.runtime_messages m join fmat.photon_inbox i on i.runtime_message_id=m.id where i.message_id=key
$$;
create function pg_temp.reply(op text,input jsonb default '{}') returns jsonb language sql as $$
 select public.fmat_photon_reply_delivery(op,'b3000000-0000-4000-8000-000000000001',input)
$$;
create function pg_temp.prepare(n integer,key text,reply text default 'Private final reply') returns void language plpgsql as $$begin
 perform pg_temp.receive(n,key);perform pg_temp.dispatch();perform pg_temp.runtime(key,'deliver');
 perform pg_temp.runtime(key,'settle',jsonb_build_object('status','completed','reply',reply));
end$$;
insert into fmat.requests(id,host_id,details,token_hash,expires_at) values
 ('b7000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','{"purpose":"First meeting"}',repeat('a',64),clock_timestamp()+interval '1 day'),
 ('b7000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001','{"purpose":"Second meeting"}',repeat('b',64),clock_timestamp()+interval '1 day'),
 ('b7000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000002','{"purpose":"foreign-sentinel"}',repeat('c',64),clock_timestamp()+interval '1 day');
select pg_temp.link('start',1,pg_temp.input(1));select pg_temp.link('start',2,pg_temp.input(2));
select pg_temp.delivery('claim');select pg_temp.link('verify',1,pg_temp.input(1));select pg_temp.link('verify',2,pg_temp.input(2));
create function pg_temp.selected() returns text language sql as $$select selected_request_id::text from fmat.photon_links where host_id=(pg_temp.credential(1)->>'subject')::uuid and revoked_at is null$$;
create function pg_temp.select_request(key text,command text) returns text language plpgsql as $$begin perform pg_temp.receive(1,key,jsonb_build_object('text',command));return pg_temp.dispatch();end$$;
create function pg_temp.context(key text) returns jsonb language sql as $$select public.fmat_conversation_tool(i.execution_grant_id,i.conversation_id,'context_read','{}') from fmat.photon_inbox i where message_id=key$$;
create function pg_temp.tool(key text,op text,input jsonb default '{}') returns jsonb language sql as $$select public.fmat_conversation_tool(i.execution_grant_id,i.conversation_id,op,input) from fmat.photon_inbox i where message_id=key$$;


update fmat.requests set details=jsonb_build_object('requesterName','Private contact','requesterEmail','private@example.test','purpose','Original purpose','durationMinutes',30,'timezone','UTC','windows',jsonb_build_array(jsonb_build_object('start',clock_timestamp()+interval '1 day','end',clock_timestamp()+interval '2 days')),'mode','online','location','https://meet.example.test/original'),private_notes='PRIVATE RATIONALE SENTINEL',current_proposal_version=1,requester_agreed_version=1,host_approved_version=1 where id='b7000000-0000-4000-8000-000000000001';
select pg_temp.select_request('choose','request b7000000-0000-4000-8000-000000000001');
select pg_temp.prepare(1,'private-turn');
insert into fixture values('before',(select to_jsonb(r) from fmat.requests r where id='b7000000-0000-4000-8000-000000000001'));
insert into fixture values('input','{"expectedRevision":1,"patch":{"purpose":"Public replacement"},"clarifications":[],"idempotencyKey":"draft-one"}');
insert into fixture values('draft',pg_temp.tool('private-turn','host_revision_propose',pg_temp.f('input')));
select is(pg_temp.f('draft')->'revisionDraft'->'details'->>'purpose','Public replacement','private host can propose revised shared details');
select is((select to_jsonb(r) from fmat.requests r where id='b7000000-0000-4000-8000-000000000001'),pg_temp.f('before'),'draft changes no request field, proposal, agreement or approval');
select is(pg_temp.tool('private-turn','host_revision_propose',pg_temp.f('input')),pg_temp.f('draft'),'exact retry returns the same draft');
select is((select count(*)::integer from fmat.host_revision_drafts),1,'retry creates one private draft');
select throws_ok($$select pg_temp.tool('private-turn','host_revision_propose',pg_temp.f('input')||'{"patch":{"purpose":"Changed retry"}}')$$,'P0001','IDEMPOTENCY_CONFLICT','changed retry cannot replace reviewed draft');
select throws_ok($$select pg_temp.tool('private-turn','host_revision_propose',pg_temp.f('input')||'{"expectedRevision":99,"idempotencyKey":"stale"}')$$,'P0001','REVISION_CONFLICT','stale request revision rejected');
select throws_ok($$select pg_temp.tool('private-turn','host_revision_propose',pg_temp.f('input')||'{"patch":{"requesterEmail":"other@example.test"}}')$$,'P0001','INVALID_INPUT','host cannot replace requester identity');
select throws_ok($$select pg_temp.tool('private-turn','host_revision_propose',pg_temp.f('input')||'{"privateNotes":"PRIVATE"}')$$,'P0001','INVALID_INPUT','private rationale is not part of shared patch envelope');
select throws_ok($$select pg_temp.tool('private-turn','host_revision_propose',pg_temp.f('input')||'{"patch":{"durationMinutes":"30"}}')$$,'P0001','INVALID_INPUT','numeric duration cannot be a string');
select throws_ok($$select pg_temp.tool('private-turn','host_revision_propose',pg_temp.f('input')||'{"idempotencyKey":"past","patch":{"windows":[{"start":"2000-01-01T00:00:00Z","end":"2000-01-01T01:00:00Z"}]}}')$$,'P0001','INVALID_INPUT','past availability cannot enter a draft');
select throws_ok($$select pg_temp.tool('private-turn','host_revision_apply','{}')$$,'P0001','FORBIDDEN','model cannot apply a draft');
select is(pg_temp.tool('private-turn','request_read')->'revisionDraft',pg_temp.f('draft')->'revisionDraft','canonical private request read restores the draft');
insert into fixture values('shared-host',public.fmat_conversation_access('open',pg_temp.credential(1),'{"audience":"request_shared","requestId":"b7000000-0000-4000-8000-000000000001"}'));
create function pg_temp.shared(op text,input jsonb default '{}') returns jsonb language sql as $$select public.fmat_conversation_tool((pg_temp.f('shared-host')->>'grantId')::uuid,(pg_temp.f('shared-host')->>'conversationId')::uuid,op,input)$$;
select ok(not (pg_temp.shared('request_read')?'revisionDraft'),'shared host audience cannot read private draft');
select ok(position('Public replacement' in pg_temp.shared('request_read')::text)=0,'proposed text remains absent from shared request');
select ok(position('PRIVATE RATIONALE SENTINEL' in pg_temp.shared('request_read')::text)=0,'shared request omits private rationale');
select throws_ok($$select pg_temp.shared('host_revision_propose',pg_temp.f('input'))$$,'P0001','FORBIDDEN','host identity does not authorize revision drafting in shared audience');
select throws_ok($$select fmat.propose_host_revision('{"kind":"guest","requestId":"b7000000-0000-4000-8000-000000000001"}','b7000000-0000-4000-8000-000000000001',pg_temp.f('input'))$$,'P0001','FORBIDDEN','guest cannot enter private draft primitive');
select throws_ok($$select fmat.propose_host_revision(fmat.credential_actor(pg_temp.credential(2)),'b7000000-0000-4000-8000-000000000001',pg_temp.f('input'))$$,'P0001','NOT_FOUND','another host cannot create a draft for this request');
select pg_temp.select_request('setup','setup');select pg_temp.prepare(1,'setup-turn');
select throws_ok($$select pg_temp.tool('setup-turn','host_revision_propose',pg_temp.f('input'))$$,'P0001','FORBIDDEN','setup scope cannot choose a revision target');
select pg_temp.tool('private-turn','host_revision_propose',pg_temp.f('input')||'{"patch":{},"clarifications":["Which location?"],"idempotencyKey":"clarify"}');
select is((select status from fmat.host_revision_drafts where idempotency_key='draft-one'),'superseded','a new draft supersedes the previous pending draft');
select is((select count(*)::integer from fmat.host_revision_drafts where status='pending'),1,'one pending revision per request');
select is(pg_temp.tool('private-turn','host_revision_propose',pg_temp.f('input'))->'revisionDraft'->>'status','superseded','old retry cannot revive superseded draft');
select is((select private_notes from fmat.requests where id='b7000000-0000-4000-8000-000000000001'),'PRIVATE RATIONALE SENTINEL','private rationale remains untouched');
select is((select count(*)::integer from fmat.booking_attempts),0,'draft does not create a booking');
select ok(not has_table_privilege('service_role','fmat.host_revision_drafts','INSERT'),'service cannot bypass private draft operation');
select ok(not has_table_privilege('authenticated','fmat.host_revision_drafts','SELECT'),'browser cannot directly read private drafts');
select ok(not has_function_privilege('service_role','fmat.propose_host_revision(jsonb,uuid,jsonb)','EXECUTE'),'private draft primitive cannot be invoked directly');
update fmat.requests set status='booking' where id='b7000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.tool('private-turn','host_revision_propose',pg_temp.f('input')||'{"idempotencyKey":"booking"}')$$,'P0001','REQUEST_CLOSED','in-flight booking rejects revision drafts');
update fmat.requests set status='negotiating' where id='b7000000-0000-4000-8000-000000000001';
update fmat.photon_links set revoked_at=clock_timestamp() where host_id='b0000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.tool('private-turn','host_revision_propose',pg_temp.f('input')||'{"idempotencyKey":"revoked"}')$$,'P0001','UNAUTHORIZED','revoked original link cannot propose');
select * from finish();
rollback;
