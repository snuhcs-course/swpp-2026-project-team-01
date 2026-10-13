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
select is(pg_temp.selected(),null,'new link starts in setup');
select pg_temp.receive(1,'ambiguous','{"text":"yes"}');select is(pg_temp.dispatch(),'accepted','ordinary assent remains conversational');
select is(pg_temp.context('ambiguous')->>'audience','host_setup','no automatic request choice');
select is(pg_temp.selected(),null,'even multiple requests do not infer selection');
select pg_temp.runtime('ambiguous','deliver');select pg_temp.runtime('ambiguous','settle','{"status":"completed","reply":"Which request?"}');
select is(pg_temp.select_request('select-first','  REQUEST b7000000-0000-4000-8000-000000000001  '),'accepted','explicit exact reference selects');
select is(pg_temp.selected(),'b7000000-0000-4000-8000-000000000001','selection saved on verified link');
select is((select selected_request_id from fmat.photon_links where host_id=(pg_temp.credential(2)->>'subject')::uuid),null,'another host link remains unchanged');
select is((select runtime_message_id from fmat.photon_inbox where message_id='select-first'),null,'navigation invokes no model');
select alike((select text from fmat.photon_replies where inbox_id=(select id from fmat.photon_inbox where message_id='select-first')),'Selected request b7000000-0000-4000-8000-000000000001: "First meeting".%','selection confirmation is authored');
select pg_temp.receive(1,'private-question','{"text":"What is this meeting about?"}');select is(pg_temp.dispatch(),'accepted','next input enters selected request');
select is(pg_temp.context('private-question'),'{"audience":"host_private","requestId":"b7000000-0000-4000-8000-000000000001","readOnly":false}'::jsonb,'captured private context is exact and minimal');
select is(pg_temp.tool('private-question','request_read')#>>'{details,purpose}','First meeting','request tool reads selected request');
select throws_ok($$select pg_temp.tool('private-question','setup_draft','{}')$$,'P0001','FORBIDDEN','request conversation cannot draft setup');
select throws_ok($$select pg_temp.tool('private-question','host_approve','{}')$$,'P0001','FORBIDDEN','selection cannot approve');
select pg_temp.receive(1,'select-second','{"text":"request b7000000-0000-4000-8000-000000000002"}');
select is(pg_temp.dispatch(),'idle','pending request turn holds later selection');
select pg_temp.runtime('private-question','deliver');select pg_temp.runtime('private-question','settle','{"status":"completed","reply":"First private answer"}');
select is((select text from fmat.photon_replies where inbox_id=(select id from fmat.photon_inbox where message_id='private-question')),E'Request b7000000-0000-4000-8000-000000000001\n\nFirst private answer','normal reply identifies original request');
select is(pg_temp.dispatch(),'accepted','selection advances after previous input settled');
select is(pg_temp.selected(),'b7000000-0000-4000-8000-000000000002','second selection persisted');
select is(pg_temp.context('private-question')->>'requestId','b7000000-0000-4000-8000-000000000001','later selection never reroutes earlier grant');
select pg_temp.receive(1,'select-first','{"text":"  REQUEST b7000000-0000-4000-8000-000000000001  "}');
select is(pg_temp.dispatch(),'idle','old selection receipt retry has no work');
select is(pg_temp.selected(),'b7000000-0000-4000-8000-000000000002','old retry cannot reverse later selection');
select is((select count(*)::integer from fmat.photon_replies where inbox_id=(select id from fmat.photon_inbox where message_id='select-first')),1,'one control reply after retry');
select is(pg_temp.select_request('foreign','request b7000000-0000-4000-8000-000000000003'),'accepted','invalid selection gives authored clarification');
select is(pg_temp.selected(),'b7000000-0000-4000-8000-000000000002','foreign reference leaves selection unchanged');
select alike((select text from fmat.photon_replies where inbox_id=(select id from fmat.photon_inbox where message_id='foreign')),'That request could not be selected.%','foreign and unknown targets have generic response');
select ok(not exists(select 1 from fmat.photon_replies where text like '%foreign-sentinel%'),'no foreign title leaked');
select is(pg_temp.select_request('malformed','request not-a-reference'),'accepted','malformed selection handled without model');
select is(pg_temp.selected(),'b7000000-0000-4000-8000-000000000002','malformed reference cannot select');
select is(pg_temp.select_request('unknown','request b7000000-0000-4000-8000-999999999999'),'accepted','unknown reference handled');
select is(pg_temp.selected(),'b7000000-0000-4000-8000-000000000002','unknown reference cannot select');
insert into fixture values('web-second',public.fmat_conversation_access('open',pg_temp.credential(1),'{"audience":"host_private","requestId":"b7000000-0000-4000-8000-000000000002"}'));
select pg_temp.receive(1,'second-question','{"text":"Discuss the second meeting"}');select pg_temp.dispatch();
select is((select conversation_id::text from fmat.photon_inbox where message_id='second-question'),pg_temp.f('web-second')->>'conversationId','request iMessage resumes canonical web scope');
select is(pg_temp.tool('second-question','request_read')#>>'{details,purpose}','Second meeting','second scope has its own request');
-- Even a privileged synthetic copied grant cannot transplant a receipt.
insert into fmat.conversation_grants(conversation_id,actor_kind,authority_key,credential,expires_at)
 select (pg_temp.f('web-second')->>'conversationId')::uuid,'host','forged-copy',g.credential,g.expires_at from fmat.conversation_grants g join fmat.photon_inbox i on i.execution_grant_id=g.id where i.message_id='private-question';
select throws_ok($$select public.fmat_conversation_check((select id from fmat.conversation_grants where authority_key='forged-copy'),(pg_temp.f('web-second')->>'conversationId')::uuid)$$,'P0001','UNAUTHORIZED','grant must match frozen receipt context and exact grant');
select pg_temp.runtime('second-question','deliver');select pg_temp.runtime('second-question','settle',jsonb_build_object('status','completed','reply',repeat('한',4000)));
select ok((select length(text)<=4000 and text like 'Request b7000000-0000-4000-8000-000000000002%' and text like '%full reply.' from fmat.photon_replies where inbox_id=(select id from fmat.photon_inbox where message_id='second-question')),'long Unicode response keeps context and full-reply handoff within bound');
update fmat.requests set status='declined' where id='b7000000-0000-4000-8000-000000000001';
select is(pg_temp.select_request('closed-choice','request b7000000-0000-4000-8000-000000000001'),'accepted','closed choice gets recoverable notice');
select is(pg_temp.selected(),'b7000000-0000-4000-8000-000000000002','closed choice leaves selection unchanged');
update fmat.requests set status='declined' where id='b7000000-0000-4000-8000-000000000002';
select pg_temp.receive(1,'closed-chat');select is(pg_temp.dispatch(),'accepted','already selected closed request gives authored handoff');
select is((select runtime_message_id from fmat.photon_inbox where message_id='closed-chat'),null,'closed request invokes no model or mutation');
select alike((select text from fmat.photon_replies where inbox_id=(select id from fmat.photon_inbox where message_id='closed-chat')),E'Request b7000000-0000-4000-8000-000000000002\n\nThis request is closed.%','closed notice retains correct context');
-- Navigation participates in the same principal budgets, with no partial selection.
update fmat.conversation_budgets set minute_used=20,minute_started_at=clock_timestamp() where name='host:b0000000-0000-4000-8000-000000000001';
select is(pg_temp.select_request('return-setup','setup'),'busy','navigation waits on rate limit');
select is(pg_temp.selected(),'b7000000-0000-4000-8000-000000000002','limited navigation leaves prior selection unchanged');
select is((select execution_grant_id from fmat.photon_inbox where message_id='return-setup'),null,'limited navigation leaves no partial grant binding');
update fmat.conversation_budgets set minute_started_at=clock_timestamp()-interval '61 seconds' where name='host:b0000000-0000-4000-8000-000000000001';
update fmat.jobs set available_at=clock_timestamp() where dedupe_key='photon-ingress:'||(select id::text from fmat.photon_inbox where message_id='return-setup');
select is(pg_temp.dispatch(),'accepted','limited navigation resumes');
select is(pg_temp.selected(),null,'explicit setup clears selected request');
select pg_temp.receive(1,'setup-question');select pg_temp.dispatch();select is(pg_temp.context('setup-question')->>'audience','host_setup','next message resumes setup');
select pg_temp.runtime('setup-question','deliver');select pg_temp.runtime('setup-question','settle','{"status":"completed","reply":"Setup answer"}');
update fmat.photon_replies set status='delivered',text=null;
select pg_temp.select_request('last-control','setup');
insert into fixture values('control-lease',pg_temp.reply('claim'));
select is(pg_temp.f('control-lease')->>'action','send','authored control reply uses same delivery worker');
select lives_ok($$select pg_temp.reply('authorize',pg_temp.f('control-lease'))$$,'control delivery authorizes without runtime message');
select pg_temp.link('unlink',1,jsonb_build_object('linkId',(select id from fmat.photon_links where host_id=(pg_temp.credential(1)->>'subject')::uuid and revoked_at is null)));
select throws_ok($$select pg_temp.reply('authorize',pg_temp.f('control-lease'))$$,'P0001','FORBIDDEN','unlink suppresses control reply after preflight');
select throws_ok($$select pg_temp.context('private-question')$$,'P0001','UNAUTHORIZED','unlink revokes frozen private request authority');
select is((select count(*)::integer from fmat.host_approvals),0,'navigation and chat cannot create approval');
select is((select count(*)::integer from fmat.booking_attempts),0,'navigation and chat cannot book');
select ok(not has_function_privilege(role,'fmat.photon_scoped_reply(uuid,text)','EXECUTE'),role||' cannot invoke private formatter') from unnest(array['anon','authenticated','service_role'])role;
select * from finish();rollback;
