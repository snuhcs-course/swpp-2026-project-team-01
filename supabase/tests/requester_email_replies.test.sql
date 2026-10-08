begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('ed000000-0000-4000-8000-000000000001','host@example.test',repeat('a',64),now()+interval '1 day','email-reply-fixture');
insert into fmat.hosts(id,email,invitation_id) values('ed000000-0000-4000-8000-000000000002','host@example.test','ed000000-0000-4000-8000-000000000001');
insert into fmat.agentmail_receivers(inbox_id,receiver_id,enabled) values('replies@example.test','ed000000-0000-4000-8000-000000000003',true);
create temporary table fixture(n int primary key,request_id uuid,link_id uuid,receipt_id uuid,message_id uuid,grant_id uuid,scope_id uuid);
create function pg_temp.prepare(n int) returns void language plpgsql as $$
declare req uuid:=gen_random_uuid(); link uuid:=gen_random_uuid(); original uuid:=gen_random_uuid(); incoming uuid:=gen_random_uuid(); scope uuid:=gen_random_uuid(); g uuid:=gen_random_uuid(); m uuid:=gen_random_uuid();
begin
 insert into fmat.requests(id,host_id,details,token_hash,contact_verified_email,expires_at)
 values(req,'ed000000-0000-4000-8000-000000000002','{"requesterEmail":"guest@example.test"}',md5(req::text)||md5(req::text),'guest@example.test',clock_timestamp()+interval '1 day');
 insert into fmat.agentmail_inbox(id,inbox_id,receiver_id,event_id,message_id,thread_id,occurred_at,payload_hash,received_at)
 values(original,'replies@example.test','ed000000-0000-4000-8000-000000000003',original::text,original::text,link::text,clock_timestamp(),repeat('d',64),clock_timestamp()-interval '2 seconds');
 insert into fmat.requester_email_links(id,request_id,token_hash,email,inbox_id,receiver_id,operation_key,request_revision,proof_hash,state,thread_id,bound_receipt_id,challenge_expires_at,expires_at,bound_at)
 values(link,req,md5(req::text)||md5(req::text),'guest@example.test','replies@example.test','ed000000-0000-4000-8000-000000000003',gen_random_uuid(),1,repeat('e',64),'linked',link::text,original,clock_timestamp()+interval '10 minutes',clock_timestamp()+interval '1 hour',clock_timestamp()-interval '1 second');
 insert into fmat.agentmail_inbox(id,inbox_id,receiver_id,event_id,message_id,thread_id,occurred_at,payload_hash,received_at,link_id,verified_text,processing_outcome)
 values(incoming,'replies@example.test','ed000000-0000-4000-8000-000000000003',incoming::text,incoming::text,link::text,clock_timestamp(),repeat('d',64),clock_timestamp(),link,'Please discuss my meeting','accepted');
 insert into fmat.requester_email_evidence(receipt_id,link_id,inbox_id,author_email,recipient_email,parent_message_id,raw_hash,signature_id)
 values(original,link,'replies@example.test','guest@example.test','replies@example.test',null,repeat('d',64),md5(original::text)||md5(original::text)),
 (incoming,link,'replies@example.test','guest@example.test','replies@example.test',original::text,repeat('d',64),md5(incoming::text)||md5(incoming::text));
 insert into fmat.conversation_scopes(id,host_id,request_id,audience,runtime_session_id) values(scope,'ed000000-0000-4000-8000-000000000002',req,'request_shared','email-'||scope);
 insert into fmat.conversation_grants(id,conversation_id,actor_kind,authority_key,credential,expires_at)
 values(g,scope,'guest','requester-email:'||incoming,jsonb_build_object('kind','requester_email','receiptId',incoming,'linkId',link,'receiverId','ed000000-0000-4000-8000-000000000003'),clock_timestamp()+interval '1 hour');
 insert into fmat.runtime_messages(id,conversation_id,grant_id,client_id,text) values(m,scope,g,incoming,'Please discuss my meeting');
 update fmat.agentmail_inbox set runtime_message_id=m where id=incoming;
 insert into fixture values(n,req,link,incoming,m,g,scope);
end$$;
create function pg_temp.settle(n int,input jsonb default '{"status":"completed","reply":"Private frozen answer"}') returns jsonb language sql as $$
 select public.fmat_runtime_message('settle',f.grant_id,f.scope_id,jsonb_build_object('messageId',f.message_id,'sessionId','email-'||f.scope_id)||input) from fixture f where f.n=$1
$$;
select ok((select relrowsecurity from pg_class where oid='fmat.requester_email_replies'::regclass),'reply ledger has RLS');
select ok(not has_table_privilege(role,'fmat.requester_email_replies','select,insert,update,delete'),role||' has no direct reply access') from unnest(array['anon','authenticated','service_role']) role;
select ok(not has_function_privilege(role,'fmat.requester_email_reply_prepare(uuid,uuid,jsonb)','execute'),role||' cannot directly enqueue') from unnest(array['anon','authenticated','service_role']) role;
select pg_temp.prepare(1);
select throws_ok($$select pg_temp.settle(1,jsonb_build_object('status','completed','reply',repeat('x',10001)))$$,'P0001','INVALID_INPUT','oversized answer rolls back completion');
select throws_ok($$select pg_temp.settle(1,'{"status":"completed","reply":{"secret":true}}')$$,'P0001','INVALID_INPUT','object answer cannot become private output');
select is((select status from fmat.runtime_messages where id=(select message_id from fixture where n=1)),'pending','failed capture retains pending input');
select is((select count(*)::int from fmat.requester_email_replies),0,'failed capture creates no partial reply');
select throws_ok($$select pg_temp.settle(1,'{"status":"completed","sessionId":"wrong"}')$$,'P0001','FORBIDDEN','wrong runtime cannot capture');
select pg_temp.settle(1);
select pg_temp.settle(1,'{"status":"failed","reply":"Replacement"}');
select is((select count(*)::int from fmat.requester_email_replies),1,'settlement retry creates one reply');
select is((select text from fmat.requester_email_replies),'Private frozen answer','first committed answer frozen');
select is((select status from fmat.runtime_messages where id=(select message_id from fixture where n=1)),'completed','late failure cannot replace completion');
select ok((select r.recipient='guest@example.test' and r.inbox_id='replies@example.test' and r.receiver_id='ed000000-0000-4000-8000-000000000003' and r.thread_id=f.link_id::text and r.parent_message_id=f.receipt_id::text and r.link_id=f.link_id and r.runtime_message_id=f.message_id from fmat.requester_email_replies r join fixture f on f.receipt_id=r.receipt_id where n=1),'private destination frozen from verified binding');
select ok((select first_attempt_at is null and provider_message_id is null and status='prepared' from fmat.requester_email_replies),'capture is not dispatch or acceptance');
select pg_temp.prepare(2);select pg_temp.settle(2,'{"status":"failed","reply":"Never send partial success"}');
select alike((select text from fmat.requester_email_replies where receipt_id=(select receipt_id from fixture where n=2)),'I could not complete this reply.%','failed generation uses bounded recovery fallback');
select pg_temp.prepare(3);update fmat.requests set token_revoked_at=clock_timestamp() where id=(select request_id from fixture where n=3);
select lives_ok($$select pg_temp.settle(3)$$,'revoked turn may record completion');
select ok((select text is null and suppressed_at is not null from fmat.requester_email_replies where receipt_id=(select receipt_id from fixture where n=3)),'revocation suppresses private content');
select pg_temp.prepare(4);update fmat.conversation_grants set expires_at=clock_timestamp()-interval '1 second' where id=(select grant_id from fixture where n=4);select pg_temp.settle(4);
select ok((select text is null and suppressed_at is not null from fmat.requester_email_replies where receipt_id=(select receipt_id from fixture where n=4)),'expired grant suppresses private content');
select pg_temp.prepare(5);update fmat.agentmail_receivers set enabled=false;select pg_temp.settle(5);
select ok((select text is null and suppressed_at is not null from fmat.requester_email_replies where receipt_id=(select receipt_id from fixture where n=5)),'disabled receiver suppresses private content');
update fmat.agentmail_receivers set enabled=true;
select pg_temp.prepare(6);update fmat.runtime_messages set status='completed' where id=(select message_id from fixture where n=6);select pg_temp.settle(6);
select is((select count(*)::int from fmat.requester_email_replies where receipt_id=(select receipt_id from fixture where n=6)),0,'historical completion cannot backfill untrusted output');
select pg_temp.prepare(7);update fmat.conversation_grants set credential=jsonb_set(credential,'{receiptId}',to_jsonb(gen_random_uuid())) where id=(select grant_id from fixture where n=7);
select throws_ok($$select pg_temp.settle(7)$$,'P0001','FORBIDDEN','mismatched receipt grant cannot capture');
select is((select count(*)::int from fmat.booking_attempts),0,'reply capture never books');

-- Delivery operates only on the frozen ledger; existing capture fixtures are
-- suppressed here so each ordering and recovery expectation is deterministic.
update fmat.requester_email_replies set suppressed_at=coalesce(suppressed_at,clock_timestamp()),text=null;
create temporary table claims(name text primary key,value jsonb);
create function pg_temp.claimed(name text) returns jsonb language sql as $$select value from claims where claims.name=$1$$;
create function pg_temp.lease(name text) returns jsonb language sql as $$select jsonb_build_object('replyId',value->'reply'->>'id','leaseToken',value->>'leaseToken') from claims where claims.name=$1$$;
create function pg_temp.delivery(op text,input jsonb default '{}') returns jsonb language sql as $$select public.fmat_requester_email_reply_delivery(op,'ed000000-0000-4000-8000-000000000003','replies@example.test',input)$$;
create function pg_temp.next_in_thread(prior_n int,next_n int) returns void language plpgsql as $$
declare f fixture; incoming uuid:=gen_random_uuid(); g uuid:=gen_random_uuid(); m uuid:=gen_random_uuid();
begin
 select * into strict f from fixture where n=prior_n;
 insert into fmat.agentmail_inbox(id,inbox_id,receiver_id,event_id,message_id,thread_id,occurred_at,payload_hash,received_at,link_id,verified_text,processing_outcome)
 values(incoming,'replies@example.test','ed000000-0000-4000-8000-000000000003',incoming::text,incoming::text,f.link_id::text,clock_timestamp(),repeat('d',64),clock_timestamp(),f.link_id,'Next input','accepted');
 insert into fmat.requester_email_evidence(receipt_id,link_id,inbox_id,author_email,recipient_email,parent_message_id,raw_hash,signature_id)
 values(incoming,f.link_id,'replies@example.test','guest@example.test','replies@example.test',f.receipt_id::text,repeat('d',64),md5(incoming::text)||md5(incoming::text));
 insert into fmat.conversation_grants(id,conversation_id,actor_kind,authority_key,credential,expires_at)
 values(g,f.scope_id,'guest','requester-email:'||incoming,jsonb_build_object('kind','requester_email','receiptId',incoming,'linkId',f.link_id,'receiverId','ed000000-0000-4000-8000-000000000003'),clock_timestamp()+interval '1 hour');
 insert into fmat.runtime_messages(id,conversation_id,grant_id,client_id,text) values(m,f.scope_id,g,incoming,'Next input');
 update fmat.agentmail_inbox set runtime_message_id=m where id=incoming;
 insert into fixture values(next_n,f.request_id,f.link_id,incoming,m,g,f.scope_id);
end$$;
select ok(not has_function_privilege(role,'public.fmat_requester_email_reply_delivery(text,uuid,text,jsonb)','execute'),role||' cannot deliver replies') from unnest(array['anon','authenticated']) role;
select ok(has_function_privilege('service_role','public.fmat_requester_email_reply_delivery(text,uuid,text,jsonb)','execute'),'service may use fenced delivery');
select ok(not has_function_privilege('service_role','fmat.wake_requester_email_replies()','execute'),'scheduler helper remains private');
select pg_temp.prepare(8);select pg_temp.settle(8);select pg_temp.next_in_thread(8,9);select pg_temp.settle(9);
insert into claims values('first',pg_temp.delivery('claim'));
select is(pg_temp.claimed('first')->>'action','send','first ordered reply claimed');
select is(pg_temp.claimed('first')->'reply'->>'parentMessageId',(select receipt_id::text from fixture where n=8),'claim selects earlier input');
select ok((select status='uncertain' and first_attempt_at is not null and lease_until>clock_timestamp() from fmat.requester_email_replies where id=(pg_temp.lease('first')->>'replyId')::uuid),'uncertainty and first attempt persist before HTTP');
select is(pg_temp.delivery('claim')->>'action','idle','leased unknown acceptance holds next same-thread reply');
select throws_ok($$select pg_temp.delivery('finish',pg_temp.lease('first')||jsonb_build_object('status','accepted','messageId','outgoing-first','threadId','wrong'))$$,'P0001','INVALID_INPUT','wrong returned thread cannot establish acceptance');
select throws_ok($$select pg_temp.delivery('finish',pg_temp.lease('first')||'{"status":"accepted","messageId":"bad id"}')$$,'P0001','INVALID_INPUT','invalid provider identity rejected');
select throws_ok($$select pg_temp.delivery('finish',pg_temp.lease('first')||'{"status":"delivered"}')$$,'P0001','INVALID_INPUT','acceptance cannot invent delivered status');
select lives_ok($$select pg_temp.delivery('authorize',pg_temp.lease('first'))$$,'current lease may dispatch');
update fmat.requester_email_replies set lease_until=clock_timestamp()-interval '1 second',checked_at=clock_timestamp()-interval '31 seconds' where id=(pg_temp.lease('first')->>'replyId')::uuid;
insert into claims values('retry',pg_temp.delivery('claim'));
select is(pg_temp.claimed('retry')->'reply',pg_temp.claimed('first')->'reply','recovery retains every byte of frozen payload and first attempt');
select isnt(pg_temp.lease('retry')->>'leaseToken',pg_temp.lease('first')->>'leaseToken','recovery rotates only lease');
select throws_ok($$select pg_temp.delivery('authorize',pg_temp.lease('first'))$$,'P0001','LEASE_LOST','old lease cannot dispatch');
select throws_ok($$select pg_temp.delivery('finish',pg_temp.lease('first')||'{"status":"uncertain"}')$$,'P0001','LEASE_LOST','old lease cannot erase newer result');
select pg_temp.delivery('finish',pg_temp.lease('retry')||jsonb_build_object('status','accepted','messageId','outgoing-first','threadId',pg_temp.claimed('retry')->'reply'->>'threadId'));
select ok((select status='accepted' and accepted_at is not null and provider_message_id='outgoing-first' and lease_token is null from fmat.requester_email_replies where id=(pg_temp.lease('first')->>'replyId')::uuid),'accepted result saved and lease released');
select throws_ok($$select pg_temp.delivery('finish',pg_temp.lease('retry')||'{"status":"uncertain"}')$$,'P0001','LEASE_LOST','lost finish replay cannot regress acceptance');
insert into claims values('second',pg_temp.delivery('claim'));
select is(pg_temp.claimed('second')->'reply'->>'parentMessageId',(select receipt_id::text from fixture where n=9),'acceptance releases next ordered reply');
select throws_ok($$select pg_temp.delivery('finish',pg_temp.lease('second')||jsonb_build_object('status','accepted','messageId','outgoing-first','threadId',pg_temp.claimed('second')->'reply'->>'threadId'))$$,'P0001','IDEMPOTENCY_CONFLICT','provider identity cannot alias another send');
update fmat.requester_email_replies set first_attempt_at=clock_timestamp()-interval '23 hours' where id=(pg_temp.lease('second')->>'replyId')::uuid;
select throws_ok($$select pg_temp.delivery('authorize',pg_temp.lease('second'))$$,'P0001','LEASE_LOST','horizon rechecked before dispatch');
select pg_temp.delivery('finish',pg_temp.lease('second')||'{"status":"uncertain"}');
select pg_temp.next_in_thread(9,10);select pg_temp.settle(10);
select is(pg_temp.delivery('claim')->>'action','idle','expired uncertain reply is not retried and still holds later reply');
select pg_temp.prepare(11);select pg_temp.settle(11);insert into claims values('independent',pg_temp.delivery('claim'));
select is(pg_temp.claimed('independent')->'reply'->>'parentMessageId',(select receipt_id::text from fixture where n=11),'held thread does not block another request');
update fmat.requests set token_revoked_at=clock_timestamp() where id=(select request_id from fixture where n=11);
select throws_ok($$select pg_temp.delivery('authorize',pg_temp.lease('independent'))$$,'P0001','FORBIDDEN','revocation after claim denies dispatch');
select pg_temp.delivery('finish',pg_temp.lease('independent')||'{"status":"suppressed"}');
select ok((select status='uncertain' and text is null and suppressed_at is not null from fmat.requester_email_replies where id=(pg_temp.lease('independent')->>'replyId')::uuid),'suppression redacts content without inventing provider failure');
select pg_temp.prepare(12);select pg_temp.settle(12);update fmat.agentmail_receivers set receiver_id=gen_random_uuid();
select is(pg_temp.delivery('claim')->>'action','suppressed','receiver replacement suppresses old destination');
select * from finish();rollback;
