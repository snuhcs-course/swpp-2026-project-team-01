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
select * from finish();rollback;
