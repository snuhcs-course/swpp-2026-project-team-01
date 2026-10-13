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

create function pg_temp.web(op text,input jsonb default '{}',n integer default 1) returns jsonb language sql as $$
 select public.fmat_host_revision_review(op,pg_temp.credential(n),jsonb_build_object('requestId','b7000000-0000-4000-8000-000000000001')||case when op='read' then '{}'::jsonb else jsonb_build_object('input',input) end)
$$;
insert into fixture values('decision',jsonb_build_object('reviewId',pg_temp.f('draft')->'revisionDraft'->>'id','expectedRevision',1,'confirmed',true,'idempotencyKey','b9000000-0000-4000-8000-000000000001'));
select is(pg_temp.web('read')->'review',pg_temp.f('draft')->'revisionDraft','browser resumes the private channel draft');
select throws_ok($$select pg_temp.web('read','{}',2)$$,'P0001','NOT_FOUND','foreign host cannot read private review');
select throws_ok($$select public.fmat_host_revision_review('read','{"kind":"guest"}','{"requestId":"b7000000-0000-4000-8000-000000000001"}')$$,'P0001','FORBIDDEN','guest cannot review host draft');
select throws_ok($$select pg_temp.web('apply',pg_temp.f('decision')-'confirmed')$$,'P0001','INVALID_INPUT','explicit confirmation is required');
select throws_ok($$select pg_temp.web('apply',pg_temp.f('decision')||'{"patch":{"purpose":"Not reviewed"}}')$$,'P0001','INVALID_INPUT','decision cannot replace stored patch');
select throws_ok($$select pg_temp.web('apply',pg_temp.f('decision')||'{"expectedRevision":2}')$$,'P0001','REVISION_CONFLICT','decision binds displayed base revision');
insert into fixture values('applied',pg_temp.web('apply',pg_temp.f('decision')));
select is(pg_temp.f('applied')->'details'->>'purpose','Public replacement','explicit current review applies shared details');
select is((pg_temp.f('applied')->>'revision')::integer,2,'apply increments revision once');
select is(pg_temp.f('applied')->'review'->>'status','applied','review records explicit decision');
select is(pg_temp.web('apply',pg_temp.f('decision')),pg_temp.f('applied'),'lost response retries return applied review without another effect');
select is((select count(*)::integer from fmat.request_history where operation='details_update' and request_id='b7000000-0000-4000-8000-000000000001'),1,'one shared mutation on retry');
select ok((select current_proposal_version is null and requester_agreed_version is null and host_approved_version is null from fmat.requests where id='b7000000-0000-4000-8000-000000000001'),'old proposal agreement and approval cannot survive changed details');
select is((select private_notes from fmat.requests where id='b7000000-0000-4000-8000-000000000001'),'PRIVATE RATIONALE SENTINEL','sharing never changes private rationale');
select is(pg_temp.f('applied')->'details'->>'requesterEmail','private@example.test','requester identity remains unchanged');
select ok(position('PRIVATE RATIONALE SENTINEL' in pg_temp.f('applied')::text)=0,'browser review response contains no private rationale');
select is((select count(*)::integer from fmat.booking_attempts),0,'sharing details does not book');
select throws_ok($$select pg_temp.web('dismiss',pg_temp.f('decision'))$$,'P0001','IDEMPOTENCY_CONFLICT','opposite decision cannot reinterpret an applied draft');
select throws_ok($$select pg_temp.web('apply',pg_temp.f('decision')||'{"idempotencyKey":"b9000000-0000-4000-8000-000000000002"}')$$,'P0001','IDEMPOTENCY_CONFLICT','changed retry identity cannot consume applied draft again');
insert into fixture values('second',pg_temp.tool('private-turn','host_revision_propose','{"expectedRevision":2,"patch":{"purpose":"Later suggestion"},"clarifications":[],"idempotencyKey":"second"}'));
insert into fixture values('second-decision',jsonb_build_object('reviewId',pg_temp.f('second')->'revisionDraft'->>'id','expectedRevision',2,'confirmed',true,'idempotencyKey','b9000000-0000-4000-8000-000000000003'));
update fmat.requests set revision=revision+1 where id='b7000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.web('apply',pg_temp.f('second-decision'))$$,'P0001','REVISION_CONFLICT','intervening change rejects stale draft');
select is(pg_temp.web('dismiss',pg_temp.f('second-decision'))->'review'->>'status','dismissed','stale draft may be explicitly dismissed');
select is((select revision from fmat.requests where id='b7000000-0000-4000-8000-000000000001'),3,'dismissal does not mutate shared revision');
insert into fixture values('question',pg_temp.tool('private-turn','host_revision_propose','{"expectedRevision":3,"patch":{},"clarifications":["Which location?"],"idempotencyKey":"question"}'));
insert into fixture values('question-decision',jsonb_build_object('reviewId',pg_temp.f('question')->'revisionDraft'->>'id','expectedRevision',3,'confirmed',true,'idempotencyKey','b9000000-0000-4000-8000-000000000004'));
select throws_ok($$select pg_temp.web('apply',pg_temp.f('question-decision'))$$,'P0001','INVALID_INPUT','unresolved question cannot change shared details');
update fmat.requests set status='booking' where id='b7000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.web('dismiss',pg_temp.f('question-decision'))$$,'P0001','REQUEST_CLOSED','in-flight booking denies new decisions');
update fmat.requests set status='negotiating' where id='b7000000-0000-4000-8000-000000000001';
select throws_ok($$select public.fmat_host_revision_review('read',pg_temp.credential(1)||jsonb_build_object('expiresAt',clock_timestamp()-interval '1 second'),'{"requestId":"b7000000-0000-4000-8000-000000000001"}')$$,'P0001','UNAUTHORIZED','expired browser credential cannot read');
select ok(not has_function_privilege('authenticated','public.fmat_host_revision_review(text,jsonb,jsonb)','EXECUTE'),'browser cannot submit credential JSON directly');
select ok(not has_function_privilege('service_role','fmat.decide_host_revision(jsonb,uuid,text,jsonb)','EXECUTE'),'shared decision primitive remains private');
select * from finish();rollback;
