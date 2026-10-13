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

update fmat.hosts set handle='review-host-'||right(id::text,1),display_name='Host',rules='{"bufferMinutes":0}',rules_version=1,conflict_calendar_ids=array['calendar'],booking_calendar_id='calendar' where id::text like 'b0000000-0000-4000-8000-%';
insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential)
 select 'host',id,'google-'||id::text,array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],repeat('e',40) from fmat.hosts where id::text like 'b0000000-0000-4000-8000-%';
create function pg_temp.review(key text) returns text language plpgsql as $$begin
 perform pg_temp.select_request(key,'review');return (select text from fmat.photon_replies where inbox_id=(select id from fmat.photon_inbox where message_id=key));end$$;
create function pg_temp.review_id(key text) returns uuid language sql as $$select id from fmat.photon_proposal_reviews where inbox_id=(select id from fmat.photon_inbox where message_id=key)$$;
create function pg_temp.review_check(key text,review_key text) returns jsonb language sql as $$select fmat.photon_proposal_review_check((select id from fmat.photon_inbox where message_id=key),pg_temp.review_id(review_key))$$;
create function pg_temp.publish(v integer,purpose text default E'Research 연구\nDo not approve automatically',p_request uuid default 'b7000000-0000-4000-8000-000000000001') returns void language plpgsql as $$
declare request_id uuid:=p_request;ev uuid:=gen_random_uuid();ranking uuid:=gen_random_uuid();pub uuid:=gen_random_uuid();check_id uuid:=gen_random_uuid();basis text;p jsonb;i fmat.photon_inbox;
begin
 p:=jsonb_build_object('version',v,'start',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'end',to_char((clock_timestamp()+interval '1 day 30 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'timezone','Asia/Seoul','mode','online','location','https://meet.example.test/review','requesterName','Guest','requesterEmail','guest@example.test','purpose',purpose);
 update fmat.requests set details=p,revision=revision+1,current_proposal_version=v,requester_agreed_version=null,contact_verified_email='guest@example.test' where id=request_id;
 select inbox.* into strict i from fmat.photon_inbox inbox join fmat.conversation_scopes scope on scope.id=inbox.conversation_id where scope.request_id=p_request order by inbox.received_order desc limit 1;
 basis:=fmat.evaluate_availability('current_context',jsonb_build_object('kind','photon_review','grantId',i.execution_grant_id,'conversationId',i.conversation_id),jsonb_build_object('requestId',request_id,'revision',(select revision from fmat.requests where id=request_id)),null)->>'travelBasis';
 insert into fmat.candidate_evaluations(id,request_id,check_id,request_revision,rules_version,basis,candidate_key,candidate,status,evidence,private_context,evaluated_at,expires_at)
 values(ev,request_id,check_id,1,1,basis,repeat('a',64),jsonb_build_object('start',p->>'start','end',p->>'end'),'checks_passed','{"complete":false,"preferences":"pending"}','{}',clock_timestamp(),clock_timestamp()+interval '5 minutes');
 insert into fmat.candidate_rankings(id,request_id,check_id,request_revision,basis,fingerprint,ordered_ids,expires_at) values(ranking,request_id,check_id,1,basis,repeat('b',64),'[]',clock_timestamp()+interval '5 minutes');
 insert into fmat.candidate_publications(id,request_id,ranking_id,check_id,context_basis,result_revision,candidates,resolution,truncated,expires_at) values(pub,request_id,ranking,check_id,basis,1,'[]','available',false,clock_timestamp()+interval '5 minutes');
 insert into fmat.proposals(request_id,version,details,rules_version) values(request_id,v,p,1);
 insert into fmat.proposal_evidence(request_id,proposal_version,publication_id,evaluation_id,context_basis) values(request_id,v,pub,ev,basis);
end$$;

create function pg_temp.command(key text,command text) returns text language plpgsql as $$begin
 -- Each case is a new logical quota window; dedicated budget tests cover limits.
 update fmat.conversation_budgets set minute_started_at=clock_timestamp()-interval '61 seconds' where name='host:b0000000-0000-4000-8000-000000000001';
 perform pg_temp.select_request(key,command);return (select text from fmat.photon_replies where inbox_id=(select id from fmat.photon_inbox where message_id=key));end$$;
create function pg_temp.sent(key text) returns void language sql as $$update fmat.photon_replies set status='delivered',text=null where inbox_id=(select id from fmat.photon_inbox where message_id=key)$$;
select pg_temp.receive(1,'setup-assent','{"text":"yes"}');select pg_temp.dispatch();
select ok((select runtime_message_id is not null from fmat.photon_inbox where message_id='setup-assent'),'setup assent remains ordinary setup input');
select pg_temp.runtime('setup-assent','deliver');select pg_temp.runtime('setup-assent','settle','{"status":"completed","reply":"Setup response"}');
select pg_temp.command('choose','request b7000000-0000-4000-8000-000000000001');select pg_temp.command('empty-review','review');select pg_temp.publish(1);
update fmat.requests set requester_agreed_version=1,revision=revision+1 where id='b7000000-0000-4000-8000-000000000001';
select alike(pg_temp.command('review-one','review'),'%To approve this exact proposal, reply: approve %','authored review includes exact explicit command');
select alike(pg_temp.command('bare','yes'),'%No decision was recorded.%','bare assent is authored clarification');
select is((select count(*)::integer from fmat.host_approvals),0,'bare assent never approves');
select alike(pg_temp.command('not-sent','approve '||pg_temp.review_id('review-one')),'%No new decision was recorded.%','unsent review cannot authorize a decision');
select pg_temp.sent('review-one');
update fmat.requests set revision=revision+1 where id='b7000000-0000-4000-8000-000000000001';
select alike(pg_temp.command('stale','approve '||pg_temp.review_id('review-one')),'%No new decision was recorded.%','changed revision rejects old explicit command');
select pg_temp.command('review-two','review');select pg_temp.sent('review-two');
select pg_temp.command('other','request b7000000-0000-4000-8000-000000000002');
select alike(pg_temp.command('foreign','approve '||pg_temp.review_id('review-two')),'%No new decision was recorded.%','review cannot authorize selected other request');
select pg_temp.command('back','request b7000000-0000-4000-8000-000000000001');
select alike(pg_temp.command('approve-one','approve '||pg_temp.review_id('review-two')),'%Approval recorded for proposal 1. Booking is pending;%','exact current human command records approval, not a booking success');
select is((select count(*)::integer from fmat.host_approvals),1,'one host approval');
select is((select source from fmat.host_approvals),'verified_imessage','source is verified iMessage, never fabricated browser');
select is((select count(*)::integer from fmat.web_approval_decisions),0,'no synthetic web session attribution');
select is((select count(*)::integer from fmat.photon_proposal_decisions),1,'one immutable channel decision');
select is((select count(*)::integer from fmat.approval_attributions),1,'shared worker recognizes the durable attribution');
select is((select count(*)::integer from fmat.booking_attempts),1,'one prepared booking effect');
select is((select count(*)::integer from fmat.jobs where kind='booking'),1,'one durable booking job');
select is((select runtime_message_id from fmat.photon_inbox where message_id='approve-one'),null,'decision bypasses the model');
select alike(pg_temp.command('duplicate','approve '||pg_temp.review_id('review-two')),'%already recorded. Current request status: booking.%','lost acknowledgement retry reports current state');
select is((select count(*)::integer from fmat.booking_attempts),1,'new-message retry cannot duplicate booking');
select alike(pg_temp.command('opposite','decline '||pg_temp.review_id('review-two')),'%No new decision was recorded.%','consumed review cannot be used for opposite action');
insert into fixture values('lease',public.fmat_booking_worker('claim','{"workerId":"photon-booking-fixture"}','{}')->'job');
select ok(pg_temp.f('lease')->>'jobId' is not null,'actual booking worker claims channel approval');
select lives_ok($$select public.fmat_booking_worker('load',pg_temp.f('lease'),'{}')$$,'worker loads attributed attempt');
select lives_ok($$select public.fmat_booking_evaluation('start',pg_temp.f('lease'),jsonb_build_object('requestId',r.id,'revision',r.revision,'checkId',gen_random_uuid(),'candidate',jsonb_build_object('start',p.details->>'start','end',p.details->>'end'))) from fmat.requests r join fmat.proposals p on p.request_id=r.id and p.version=r.current_proposal_version where r.id='b7000000-0000-4000-8000-000000000001'$$,'fresh booking evaluation accepts channel attribution');
select pg_temp.command('decline-choice','request b7000000-0000-4000-8000-000000000002');select pg_temp.command('empty-second','review');
select pg_temp.publish(1,'Separate decline','b7000000-0000-4000-8000-000000000002');
select pg_temp.command('decline-review','review');select pg_temp.sent('decline-review');
select alike(pg_temp.command('no-agree','approve '||pg_temp.review_id('decline-review')),'%No new decision was recorded.%','missing requester agreement cannot approve');
select alike(pg_temp.command('decline-one','decline '||pg_temp.review_id('decline-review')),'%Declined proposal 1. This request is closed%','explicit decline uses shared closure mutation');
select is((select status from fmat.requests where id='b7000000-0000-4000-8000-000000000002'),'declined','decline closes request');
select ok((select actor_scope like 'photon:%' from fmat.request_closures where request_id='b7000000-0000-4000-8000-000000000002'),'closure retains channel attribution');
select is((select count(*)::integer from fmat.booking_attempts where request_id='b7000000-0000-4000-8000-000000000002'),0,'decline creates no booking');
select alike(pg_temp.command('decline-retry','decline '||pg_temp.review_id('decline-review')),'%already recorded. Current request status: declined.%','closed decline retry returns minimal current state');
select is((select count(*)::integer from fmat.photon_proposal_decisions),2,'one decision per review');
select throws_ok($$update fmat.photon_proposal_decisions set result_revision=result_revision+1$$,'P0001','IMMUTABLE_EVALUATION','decision evidence is immutable');
select ok(not has_table_privilege('service_role','fmat.photon_proposal_decisions','INSERT'),'service cannot forge decision evidence');
select ok(not has_function_privilege('service_role','fmat.photon_proposal_decide(uuid)','EXECUTE'),'decision command is private to signed dispatch');
select ok(not has_function_privilege('authenticated','fmat.commit_host_approval(fmat.requests,jsonb,text)','EXECUTE'),'shared write primitive is not a client API');
select ok(not has_table_privilege('authenticated','fmat.approval_attributions','SELECT'),'attribution view is private');
select * from finish();rollback;
