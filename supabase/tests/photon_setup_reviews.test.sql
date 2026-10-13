begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temporary table fixture(name text primary key,value jsonb);
create function pg_temp.f(text) returns jsonb language sql as $$select value from fixture where name=$1$$;
create function pg_temp.host(n integer) returns uuid language sql as $$select ('a8500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,email,email_confirmed_at) select pg_temp.host(n),'setup-review-'||n||'@example.test',now() from generate_series(1,2)n;
insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) select gen_random_uuid(),'setup-review-'||n||'@example.test',md5(n::text)||md5(n::text),now()+interval '1 day','setup-review-fixture' from generate_series(1,2)n;
insert into fmat.hosts(id,email,invitation_id) select u.id,u.email,i.id from auth.users u join fmat.invitations i on i.email=u.email where i.issued_by='setup-review-fixture';
insert into fmat.photon_receivers(project_id,receiver_id,enabled) values('a8510000-0000-4000-8000-000000000001','a8520000-0000-4000-8000-000000000001',true);
insert into fmat.photon_link_challenges(id,host_id,project_id,credential,browser_hash,phone,line,space_id,code_hash,request_key,delivery_status,consumed_at)
 select gen_random_uuid(),pg_temp.host(n),'a8510000-0000-4000-8000-000000000001','{}',repeat('a',64),'+1555010000'||n,'shared','any;-;+1555010000'||n,repeat('b',64),gen_random_uuid(),'delivered',now() from generate_series(1,2)n;
insert into fmat.photon_links(host_id,project_id,phone,line,space_id,challenge_id,linked_at)
 select host_id,project_id,phone,line,space_id,id,clock_timestamp()-interval '1 second' from fmat.photon_link_challenges where project_id='a8510000-0000-4000-8000-000000000001';
insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential)
 select 'host',pg_temp.host(n),'google-setup-'||n,array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],repeat('e',40) from generate_series(1,2)n;
update fmat.hosts set conflict_calendar_ids=array['conflict'],booking_calendar_id='destination' where id in(pg_temp.host(1),pg_temp.host(2));
create function pg_temp.actor(n integer) returns jsonb language sql as $$select jsonb_build_object('kind','host','id',id,'email',email) from fmat.hosts where id=pg_temp.host(n)$$;
create function pg_temp.draft(n integer,patch jsonb) returns jsonb language sql as $$select fmat.host_setup_operation('draft',pg_temp.actor(n),jsonb_build_object('expectedRevision',fmat.host_setup_view(pg_temp.host(n))->'revision','patch',patch,'unresolved','[]'::jsonb,'idempotencyKey',gen_random_uuid()),'host')$$;
select pg_temp.draft(n,jsonb_build_object('handle','setup-review-'||n,'displayName','Host '||n,'rules','{"timezone":"UTC","durationMinutes":30,"availability":[{"days":[1,2,3,4,5],"start":"09:00","end":"17:00"}],"focusBlocks":[],"bufferMinutes":10,"preferences":"Private exact preference","meetingMode":"online"}'::jsonb)) from generate_series(1,2)n;
create function pg_temp.receive(n integer,body text) returns uuid language plpgsql as $$declare receipt jsonb;begin
 receipt:=public.fmat_photon_ingress('a8510000-0000-4000-8000-000000000001','a8520000-0000-4000-8000-000000000001',jsonb_build_object('messageId',gen_random_uuid(),'senderId','+1555010000'||n,'spaceId','any;-;+1555010000'||n,'line','shared','text',body,'occurredAt',clock_timestamp()));
 -- All SQL assertions share one rollback transaction; model the distinct
 -- arrival transactions rather than giving every receipt its BEGIN time.
 update fmat.photon_inbox set received_at=clock_timestamp() where id=(receipt->>'inboxId')::uuid;
 return (receipt->>'inboxId')::uuid;
end$$;
insert into fixture values('source',to_jsonb(pg_temp.receive(1,'review setup')));
create function pg_temp.source() returns uuid language sql as $$select (pg_temp.f('source')#>>'{}')::uuid$$;
insert into fixture select 'issued',fmat.photon_setup_review_start(pg_temp.source());
create function pg_temp.review() returns uuid language sql as $$select (pg_temp.f('issued')->>'reviewId')::uuid$$;
insert into fixture values('decision',to_jsonb(pg_temp.receive(1,'confirm setup '||pg_temp.review())));
create function pg_temp.decision() returns uuid language sql as $$select (pg_temp.f('decision')#>>'{}')::uuid$$;
create function pg_temp.check() returns jsonb language sql as $$select fmat.photon_setup_review_check(pg_temp.decision(),pg_temp.review())$$;

-- Concurrency fixture boundary. The Node integration reuses only setup above.
select ok(not has_table_privilege(role,tab,priv),role||' cannot '||priv||' '||tab)
 from unnest(array['anon','authenticated','service_role']) role cross join unnest(array['fmat.photon_setup_reviews','fmat.photon_setup_review_publications']) tab cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) priv;
select ok((select relrowsecurity from pg_class where oid=tab::regclass),tab||' uses RLS') from unnest(array['fmat.photon_setup_reviews','fmat.photon_setup_review_publications']) tab;
select ok(not has_function_privilege(role,fn,'EXECUTE'),role||' cannot invoke '||fn)
 from unnest(array['anon','authenticated','service_role']) role cross join unnest(array['fmat.photon_setup_context(uuid)','fmat.photon_setup_review_start(uuid)','fmat.photon_setup_review_publish(uuid,uuid,text)','fmat.photon_setup_review_check(uuid,uuid)']) fn;
select is(fmat.photon_setup_review_start(pg_temp.source()),pg_temp.f('issued'),'start retries retain exact identity, snapshot and deadline');
select is((select count(*)::integer from fmat.photon_setup_reviews),1,'one immutable review');
select ok((pg_temp.f('issued')->>'expiresAt')::timestamptz<=clock_timestamp()+interval '10 minutes','review lifetime is bounded');
select is(pg_temp.f('issued')->'settings'->'rules'->>'preferences','Private exact preference','review retains exact private settings');
select throws_ok($$select fmat.photon_setup_review_start(pg_temp.receive(1,'yes'))$$,'P0001','FORBIDDEN','bare assent cannot request a confirmable review');
select throws_ok($$select pg_temp.check()$$,'P0001','REVIEW_DELIVERY_REQUIRED','unpublished review cannot authorize confirmation');
select throws_ok($$select fmat.photon_setup_review_publish(pg_temp.source(),pg_temp.review(),repeat('🙂',2001))$$,'P0001','INVALID_INPUT','SQL preserves UTF-16 transport bound');
select throws_ok($$select fmat.photon_setup_review_publish(pg_temp.source(),gen_random_uuid(),'Wrong review')$$,'P0001','FORBIDDEN','publication cannot name another review');
select is(fmat.photon_setup_review_publish(pg_temp.source(),pg_temp.review(),'Exact authored fixture summary'),'Exact authored fixture summary','publication freezes its own reply atomically');
select is(fmat.photon_setup_review_publish(pg_temp.source(),pg_temp.review(),'Exact authored fixture summary'),'Exact authored fixture summary','exact publication replay reuses reply');
select is((select count(*)::integer from fmat.photon_replies where inbox_id=pg_temp.source()),1,'publication has one outgoing intent');
select throws_ok($$select fmat.photon_setup_review_publish(pg_temp.source(),pg_temp.review(),'Changed text')$$,'P0001','IDEMPOTENCY_CONFLICT','changed text cannot replace a published summary');
select throws_ok($$select pg_temp.check()$$,'P0001','REVIEW_DELIVERY_REQUIRED','prepared reply is not acceptance');
update fmat.photon_replies set status='uncertain',provider_reference='known-but-unconfirmed' where inbox_id=pg_temp.source();
select throws_ok($$select pg_temp.check()$$,'P0001','REVIEW_DELIVERY_REQUIRED','uncertain reference is not acceptance');
update fmat.photon_replies set status='accepted',provider_reference=null where inbox_id=pg_temp.source();
select throws_ok($$select pg_temp.check()$$,'P0001','REVIEW_DELIVERY_REQUIRED','accepted label without reference is insufficient');
update fmat.photon_replies set provider_reference='verified-fixture-reference',text='Other body' where inbox_id=pg_temp.source();
select throws_ok($$select pg_temp.check()$$,'P0001','REVIEW_DELIVERY_REQUIRED','accepted body must match the publication');
update fmat.photon_replies set text='Exact authored fixture summary' where inbox_id=pg_temp.source();
select lives_ok($$select pg_temp.check()$$,'current same-route review with accepted exact reply can be checked');
update fmat.photon_replies set status='delivered',text=null where inbox_id=pg_temp.source();
select lives_ok($$select pg_temp.check()$$,'purged delivered body retains its atomic publication binding');
select throws_ok($$select fmat.photon_setup_review_check(pg_temp.receive(2,'confirm setup '||pg_temp.review()),pg_temp.review())$$,'P0001','FORBIDDEN','another linked host cannot use copied reference');
select throws_ok($$select fmat.photon_setup_review_check(pg_temp.receive(1,'yes'),pg_temp.review())$$,'P0001','FORBIDDEN','ordinary text is not a confirmation command');
select throws_ok($$update fmat.photon_setup_reviews set snapshot='{}' where id=pg_temp.review()$$,'P0001','IMMUTABLE_EVALUATION','snapshot cannot be rewritten');
select throws_ok($$update fmat.photon_setup_review_publications set text='Changed' where review_id=pg_temp.review()$$,'P0001','IMMUTABLE_EVALUATION','publication cannot be rewritten');
insert into fixture select 'generation',to_jsonb(generation) from fmat.calendar_connections where principal_id=pg_temp.host(1);
update fmat.calendar_connections set generation=gen_random_uuid() where principal_id=pg_temp.host(1);
select throws_ok($$select pg_temp.check()$$,'P0001','REVISION_CONFLICT','changed Calendar grant invalidates review');
update fmat.calendar_connections set generation=(pg_temp.f('generation')#>>'{}')::uuid where principal_id=pg_temp.host(1);
update fmat.hosts set booking_calendar_id='other-destination' where id=pg_temp.host(1);
select throws_ok($$select pg_temp.check()$$,'P0001','REVISION_CONFLICT','changed selection cannot reuse old summary');
update fmat.hosts set booking_calendar_id='destination' where id=pg_temp.host(1);
update fmat.photon_links set revoked_at=clock_timestamp() where host_id=pg_temp.host(1);
select throws_ok($$select pg_temp.check()$$,'P0001','UNAUTHORIZED','unlink removes review authority');
update fmat.photon_links set revoked_at=null where host_id=pg_temp.host(1);
update fmat.photon_receivers set receiver_id=gen_random_uuid() where project_id='a8510000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.check()$$,'P0001','UNAUTHORIZED','replacement receiver removes old receipt authority');
update fmat.photon_receivers set receiver_id='a8520000-0000-4000-8000-000000000001' where project_id='a8510000-0000-4000-8000-000000000001';
insert into fixture select 'expired',to_jsonb(gen_random_uuid());
insert into fmat.photon_setup_reviews(id,inbox_id,host_id,conversation_id,link_id,receiver_id,snapshot,created_at,expires_at)
 select (pg_temp.f('expired')#>>'{}')::uuid,pg_temp.receive(1,'review setup'),host_id,conversation_id,link_id,receiver_id,snapshot,clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '10 minutes'
 from fmat.photon_setup_reviews where id=pg_temp.review();
select throws_ok($$select fmat.photon_setup_review_check(pg_temp.receive(1,'confirm setup '||(pg_temp.f('expired')#>>'{}')),(pg_temp.f('expired')#>>'{}')::uuid)$$,'P0001','REVISION_CONFLICT','expired review cannot authorize a fresh input');
-- A pre-existing unrelated reply cannot be repurposed as review delivery proof.
insert into fixture values('occupied',to_jsonb(pg_temp.receive(1,'review setup')));
insert into fixture select 'occupied-review',fmat.photon_setup_review_start((pg_temp.f('occupied')#>>'{}')::uuid);
insert into fmat.photon_replies(inbox_id,project_id,text,status,provider_reference)
 values((pg_temp.f('occupied')#>>'{}')::uuid,'a8510000-0000-4000-8000-000000000001',null,'delivered','unrelated-delivered-body');
select throws_ok($$select fmat.photon_setup_review_publish((pg_temp.f('occupied')#>>'{}')::uuid,(pg_temp.f('occupied-review')->>'reviewId')::uuid,'New summary')$$,'P0001','IDEMPOTENCY_CONFLICT','purged arbitrary reply cannot become review publication');
select is((select count(*)::integer from fmat.photon_setup_review_publications where review_id=(pg_temp.f('occupied-review')->>'reviewId')::uuid),0,'failed publication leaves no receipt');
select pg_temp.draft(1,'{"rules":{"bufferMinutes":20}}');
select throws_ok($$select pg_temp.check()$$,'P0001','REVISION_CONFLICT','new browser draft invalidates published review');
select throws_ok($$select fmat.photon_setup_review_start(pg_temp.source())$$,'P0001','REVISION_CONFLICT','source retry cannot silently rebase its frozen review');
select is((select rules_version from fmat.hosts where id=pg_temp.host(1)),0,'review operations never save settings');
select is((select count(*)::integer from fmat.host_approvals),0,'review operations never approve meetings');
select is((select count(*)::integer from fmat.booking_attempts),0,'review operations never create booking work');
select * from finish();
rollback;
