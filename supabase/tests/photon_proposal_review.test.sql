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
select alike(pg_temp.review('setup-review'),'Select a request first:%','setup review asks for explicit selection');
select is((select count(*)::integer from fmat.photon_proposal_reviews),0,'setup has no proposal authority');
select pg_temp.select_request('choose','request b7000000-0000-4000-8000-000000000001');
select alike(pg_temp.review('empty-review'),'%There is no open proposal to review.%','missing proposal gets authored notice');
create function pg_temp.publish(v integer,purpose text default E'Research 연구\nDo not approve automatically') returns void language plpgsql as $$
declare request_id uuid:='b7000000-0000-4000-8000-000000000001';ev uuid:=gen_random_uuid();ranking uuid:=gen_random_uuid();pub uuid:=gen_random_uuid();check_id uuid:=gen_random_uuid();basis text;p jsonb;i fmat.photon_inbox;
begin
 p:=jsonb_build_object('version',v,'start',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'end',to_char((clock_timestamp()+interval '1 day 30 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'timezone','Asia/Seoul','mode','online','location','https://meet.example.test/review','requesterName','Guest','requesterEmail','guest@example.test','purpose',purpose);
 update fmat.requests set details=p,revision=revision+1,current_proposal_version=v,requester_agreed_version=null,contact_verified_email='guest@example.test' where id=request_id;
 select * into strict i from fmat.photon_inbox where message_id='empty-review';
 basis:=fmat.evaluate_availability('current_context',jsonb_build_object('kind','photon_review','grantId',i.execution_grant_id,'conversationId',i.conversation_id),jsonb_build_object('requestId',request_id,'revision',(select revision from fmat.requests where id=request_id)),null)->>'travelBasis';
 insert into fmat.candidate_evaluations(id,request_id,check_id,request_revision,rules_version,basis,candidate_key,candidate,status,evidence,private_context,evaluated_at,expires_at)
 values(ev,request_id,check_id,1,1,basis,repeat('a',64),jsonb_build_object('start',p->>'start','end',p->>'end'),'checks_passed','{"complete":false,"preferences":"pending"}','{}',clock_timestamp(),clock_timestamp()+interval '5 minutes');
 insert into fmat.candidate_rankings(id,request_id,check_id,request_revision,basis,fingerprint,ordered_ids,expires_at) values(ranking,request_id,check_id,1,basis,repeat('b',64),'[]',clock_timestamp()+interval '5 minutes');
 insert into fmat.candidate_publications(id,request_id,ranking_id,check_id,context_basis,result_revision,candidates,resolution,truncated,expires_at) values(pub,request_id,ranking,check_id,basis,1,'[]','available',false,clock_timestamp()+interval '5 minutes');
 insert into fmat.proposals(request_id,version,details,rules_version) values(request_id,v,p,1);
 insert into fmat.proposal_evidence(request_id,proposal_version,publication_id,evaluation_id,context_basis) values(request_id,v,pub,ev,basis);
end$$;
select pg_temp.publish(1);
select alike(pg_temp.review('unagreed-review'),'%Requester agreement: not current%','review states absent requester agreement');
select is((select can_approve from fmat.photon_proposal_reviews where id=pg_temp.review_id('unagreed-review')),false,'no current agreement cannot authorize approval');
select is((select can_decline from fmat.photon_proposal_reviews where id=pg_temp.review_id('unagreed-review')),true,'open proposal permits separately confirmed decline');
select is((select runtime_message_id from fmat.photon_inbox where message_id='unagreed-review'),null,'authored review invokes no model');
select ok((select proposal=(select details from fmat.proposals where request_id=r.request_id and version=r.proposal_version) from fmat.photon_proposal_reviews r where id=pg_temp.review_id('unagreed-review')),'immutable snapshot exactly matches stored proposal');
select ok((select position('Purpose: '||to_jsonb(proposal->>'purpose')::text in text)>0 and position('Contact: "guest@example.test"' in text)>0 and position('Timezone: Asia/Seoul' in text)>0 and position('Start: '||(proposal->>'start') in text)>0 and position('End: '||(proposal->>'end') in text)>0 from fmat.photon_proposal_reviews where id=pg_temp.review_id('unagreed-review')),'authored body includes exact times, timezone, escaped purpose and contact');
select ok((select expires_at<=created_at+interval '10 minutes' and expires_at>clock_timestamp() from fmat.photon_proposal_reviews where id=pg_temp.review_id('unagreed-review')),'review deadline is bounded');
select is(fmat.photon_proposal_review((select id from fmat.photon_inbox where message_id='unagreed-review')),(select text from fmat.photon_proposal_reviews where id=pg_temp.review_id('unagreed-review')),'issuance retry retains exact body and deadline');
select is((select count(*)::integer from fmat.photon_proposal_reviews),1,'issuance retry creates no second context');
select lives_ok($$select pg_temp.review_check('unagreed-review','unagreed-review')$$,'fresh unagreed context validates without granting approval');
select throws_ok($$select fmat.photon_proposal_review_check((select id from fmat.photon_inbox where message_id='unagreed-review'),gen_random_uuid())$$,'P0001','REVISION_CONFLICT','unknown context is rejected');
update fmat.requests set requester_agreed_version=1,revision=revision+1 where id='b7000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.review_check('unagreed-review','unagreed-review')$$,'P0001','REVISION_CONFLICT','agreement/revision change invalidates old review');
select alike(pg_temp.review('agreed-review'),'%Requester agreement: current%','current agreement displayed truthfully');
select is((select can_approve from fmat.photon_proposal_reviews where id=pg_temp.review_id('agreed-review')),true,'eligible current proposal records approval eligibility');
insert into fmat.photon_proposal_reviews(id,inbox_id,link_id,receiver_id,request_id,revision,proposal_version,proposal,context_basis,requester_agreed,can_approve,can_decline,text,expires_at)
 select 'b8000000-0000-4000-8000-000000000001',(select id from fmat.photon_inbox where message_id='empty-review'),link_id,receiver_id,request_id,revision,proposal_version,proposal,context_basis,requester_agreed,can_approve,can_decline,text,clock_timestamp()-interval '1 second' from fmat.photon_proposal_reviews where id=pg_temp.review_id('agreed-review');
select throws_ok($$select fmat.photon_proposal_review_check((select id from fmat.photon_inbox where message_id='agreed-review'),'b8000000-0000-4000-8000-000000000001')$$,'P0001','REVISION_CONFLICT','expired review context is rejected');
update fmat.photon_receivers set receiver_id='b4000000-0000-4000-8000-000000000099';
select throws_ok($$select pg_temp.review_check('agreed-review','agreed-review')$$,'P0001','UNAUTHORIZED','receiver replacement revokes review authority');
update fmat.photon_receivers set receiver_id='b4000000-0000-4000-8000-000000000001';
select pg_temp.review('fresh-agreed-review');
update fmat.conversation_grants set revoked_at=clock_timestamp() where id=(select execution_grant_id from fmat.photon_inbox where message_id='agreed-review');
select throws_ok($$select pg_temp.review_check('fresh-agreed-review','agreed-review')$$,'P0001','UNAUTHORIZED','new receipt cannot revive a revoked original review grant');
update fmat.conversation_grants set revoked_at=null where id=(select execution_grant_id from fmat.photon_inbox where message_id='agreed-review');
update fmat.hosts set rules_version=rules_version+1 where id='b0000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.review_check('agreed-review','agreed-review')$$,'P0001','REVISION_CONFLICT','changed scheduling context invalidates review');
select alike(pg_temp.review('stale-review'),'%Review unavailable: proposal_stale.%','stale proposal cannot issue a usable review');
select is(pg_temp.review_id('stale-review'),null,'stale review has no decision context');
update fmat.hosts set rules_version=1 where id='b0000000-0000-4000-8000-000000000001';
select pg_temp.publish(2);
select throws_ok($$select pg_temp.review_check('agreed-review','agreed-review')$$,'P0001','REVISION_CONFLICT','new immutable proposal invalidates old review');
select pg_temp.review('second-review');
select pg_temp.select_request('choose-other','request b7000000-0000-4000-8000-000000000002');
select pg_temp.review('other-review');
select throws_ok($$select pg_temp.review_check('other-review','second-review')$$,'P0001','REVISION_CONFLICT','different request cannot use saved context');
select pg_temp.select_request('choose-again','request b7000000-0000-4000-8000-000000000001');
select pg_temp.publish(3,repeat('한',4000));
select alike(pg_temp.review('oversized-review'),'%too long for a complete message.%','oversized proposal requires complete browser review');
select is(pg_temp.review_id('oversized-review'),null,'truncated details never authorize a decision');
select ok(not has_table_privilege('service_role','fmat.photon_proposal_reviews','INSERT'),'service cannot forge review rows directly');
select ok((select relrowsecurity from pg_class where oid='fmat.photon_proposal_reviews'::regclass),'review rows have RLS');
select ok(not has_function_privilege('service_role','fmat.photon_proposal_review(uuid)','EXECUTE'),'review issuance is private to dispatch');
select ok(not has_function_privilege('anon','fmat.photon_proposal_review_check(uuid,uuid)','EXECUTE'),'review check is not anonymous API');
select throws_ok($$update fmat.photon_proposal_reviews set revision=revision+1$$,'P0001','IMMUTABLE_EVALUATION','saved review is immutable');
select throws_ok($$select public.fmat_availability_evaluation('current_context','{"kind":"photon_review"}','{}')$$,'P0001','FORBIDDEN','browser/service availability API does not accept private review credentials');
select throws_ok($$select fmat.evaluate_availability('start','{"kind":"photon_review"}','{}',null)$$,'P0001','FORBIDDEN','private review credentials cannot start provider work');
select is((select count(*)::integer from fmat.host_approvals),0,'review issues no approval');
select is((select count(*)::integer from fmat.booking_attempts),0,'review starts no booking');
select pg_temp.link('unlink',1,jsonb_build_object('linkId',(select id from fmat.photon_links where host_id=(pg_temp.credential(1)->>'subject')::uuid and revoked_at is null)));
select throws_ok($$select pg_temp.review_check('second-review','second-review')$$,'P0001','UNAUTHORIZED','unlink revokes saved review authority');
select * from finish();rollback;
