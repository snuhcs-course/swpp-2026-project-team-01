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


create function pg_temp.channel(key text,command text) returns text language plpgsql as $$begin
 update fmat.conversation_budgets set minute_started_at=clock_timestamp()-interval '61 seconds' where name='host:b0000000-0000-4000-8000-000000000001';
 perform pg_temp.select_request(key,command);return (select text from fmat.photon_replies where inbox_id=(select id from fmat.photon_inbox where message_id=key));end$$;
create function pg_temp.ref(key text) returns uuid language sql as $$select id from fmat.photon_revision_reviews where inbox_id=(select id from fmat.photon_inbox where message_id=key)$$;
create function pg_temp.sent(key text) returns void language sql as $$update fmat.photon_replies set status='delivered',text=null where inbox_id=(select id from fmat.photon_inbox where message_id=key)$$;
insert into fixture values('display',to_jsonb(pg_temp.channel('changes','changes')));
select ok(position('Current details:' in pg_temp.f('display')::text)>0 and position('Proposed details:' in pg_temp.f('display')::text)>0,'authored review shows both complete shared snapshots');
select ok(position('PRIVATE RATIONALE SENTINEL' in pg_temp.f('display')::text)=0,'authored review excludes private rationale');
select ok(position('apply changes '||pg_temp.ref('changes')::text in pg_temp.f('display')::text)>0,'authored apply command binds a separate review reference');
select isnt(pg_temp.ref('changes')::text,pg_temp.f('draft')->'revisionDraft'->>'id','model draft ID is not decision authority');
select ok((select expires_at<=created_at+interval '10 minutes' from fmat.photon_revision_reviews where id=pg_temp.ref('changes')),'review has bounded lifetime');
select is(fmat.photon_revision_command((select id from fmat.photon_inbox where message_id='changes')),pg_temp.f('display')#>>'{}','issuance retry preserves original text and reference');
select ok(pg_temp.channel('unsent','apply changes '||pg_temp.ref('changes')) like '%No new changes decision%','unsent review cannot be applied');
select ok(pg_temp.channel('malformed','apply changes') like '%No changes were shared%','malformed command is authored denial');
select pg_temp.sent('changes');
select ok(pg_temp.channel('apply','apply changes '||pg_temp.ref('changes')) like '%Revised details shared.%','explicit delivered review applies exact draft');
select is((select details->>'purpose' from fmat.requests where id='b7000000-0000-4000-8000-000000000001'),'Public replacement','reviewed shared value saved');
select ok((select current_proposal_version is null and requester_agreed_version is null and host_approved_version is null from fmat.requests where id='b7000000-0000-4000-8000-000000000001'),'apply invalidates old proposal and decisions');
select ok(pg_temp.channel('retry','apply changes '||pg_temp.ref('changes')) like '%already recorded.%','repeat command reports committed decision');
select is((select count(*)::integer from fmat.request_history where request_id='b7000000-0000-4000-8000-000000000001' and operation='details_update'),1,'repeat creates one domain mutation');
select ok(pg_temp.channel('opposite','dismiss changes '||pg_temp.ref('changes')) like '%No new changes decision%','opposite action cannot reuse consumed context');
select is((select count(*)::integer from fmat.photon_revision_decisions),1,'one immutable decision attribution');
select is((select count(*)::integer from fmat.runtime_messages where id in(select runtime_message_id from fmat.photon_inbox where message_id in ('changes','apply','retry','opposite','malformed','unsent'))),0,'authored controls never enter model history');
select is((select count(*)::integer from fmat.booking_attempts),0,'sharing creates no booking');
select pg_temp.tool('private-turn','host_revision_propose','{"expectedRevision":2,"patch":{"location":"https://meet.example.test/second"},"clarifications":[],"idempotencyKey":"second"}');
select pg_temp.channel('second-review','changes');select pg_temp.sent('second-review');
select pg_temp.channel('other','request b7000000-0000-4000-8000-000000000002');
select ok(pg_temp.channel('foreign','apply changes '||pg_temp.ref('second-review')) like '%No new changes decision%','review cannot cross selected request');
select pg_temp.channel('back','request b7000000-0000-4000-8000-000000000001');
update fmat.requests set revision=revision+1 where id='b7000000-0000-4000-8000-000000000001';
select ok(pg_temp.channel('stale','apply changes '||pg_temp.ref('second-review')) like '%No new changes decision%','changed request invalidates displayed review');
select pg_temp.tool('private-turn','host_revision_propose','{"expectedRevision":3,"patch":{"location":"https://meet.example.test/dismissed"},"clarifications":[],"idempotencyKey":"third"}');
select pg_temp.channel('third-review','changes');select pg_temp.sent('third-review');
select ok(pg_temp.channel('dismiss','dismiss changes '||pg_temp.ref('third-review')) like '%Private changes dismissed.%','exact dismiss affects private draft only');
select is((select revision from fmat.requests where id='b7000000-0000-4000-8000-000000000001'),3,'dismiss leaves shared revision unchanged');
select pg_temp.tool('private-turn','host_revision_propose',jsonb_build_object('expectedRevision',3,'patch',jsonb_build_object('purpose',repeat('x',4500)),'clarifications','[]'::jsonb,'idempotencyKey','large'));
select ok(pg_temp.channel('large-review','changes') like '%too long for a complete message%','oversized complete review uses browser fallback');
select is(pg_temp.ref('large-review'),null::uuid,'oversized review issues no decision authority');
select pg_temp.tool('private-turn','host_revision_propose','{"expectedRevision":3,"patch":{"location":"https://meet.example.test/revoked"},"clarifications":[],"idempotencyKey":"fourth"}');
select pg_temp.channel('fourth-review','changes');select pg_temp.sent('fourth-review');
update fmat.conversation_grants set expires_at=clock_timestamp()-interval '1 second' where id=(select execution_grant_id from fmat.photon_inbox where message_id='fourth-review');
select pg_temp.channel('expired','apply changes '||pg_temp.ref('fourth-review'));
select is((select processing_outcome from fmat.photon_inbox where message_id='expired'),'revoked','expired original review grant denies new decision');
select is((select revision from fmat.requests where id='b7000000-0000-4000-8000-000000000001'),3,'revoked review has no shared effect');
select ok(not has_table_privilege('service_role','fmat.photon_revision_reviews','INSERT') and not has_table_privilege('authenticated','fmat.photon_revision_decisions','SELECT'),'review and attribution tables are private');
select ok(not has_function_privilege('service_role','fmat.photon_revision_command(uuid)','EXECUTE'),'model/service cannot directly mint a review');
select * from finish();rollback;
