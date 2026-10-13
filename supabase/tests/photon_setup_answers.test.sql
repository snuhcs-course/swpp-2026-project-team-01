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
create function pg_temp.draft(n integer,patch jsonb) returns jsonb language sql as $$select fmat.host_setup_operation('draft',pg_temp.actor(n),jsonb_build_object('expectedRevision',fmat.host_setup_view(pg_temp.host(n))->'revision','patch',patch,'unresolved','["en:availability"]'::jsonb,'idempotencyKey',gen_random_uuid()),'assistant')$$;
select pg_temp.draft(n,jsonb_build_object('handle','setup-review-'||n,'displayName','Host '||n,'rules','{"timezone":"UTC","durationMinutes":30,"availability":[{"days":[1,2,3,4,5],"start":"09:00","end":"17:00"}],"focusBlocks":[],"bufferMinutes":10,"preferences":"Private exact preference","meetingMode":"either","locationPolicy":"preferred","locations":["Library"],"travelMode":"TRANSIT","travelBufferMinutes":20}'::jsonb)) from generate_series(1,2)n;
create function pg_temp.receive(n integer,body text) returns uuid language plpgsql as $$declare receipt jsonb;begin
 receipt:=public.fmat_photon_ingress('a8510000-0000-4000-8000-000000000001','a8520000-0000-4000-8000-000000000001',jsonb_build_object('messageId',gen_random_uuid(),'senderId','+1555010000'||n,'spaceId','any;-;+1555010000'||n,'line','shared','text',body,'occurredAt',clock_timestamp()));
 -- All SQL assertions share one rollback transaction; model the distinct
 -- arrival transactions rather than giving every receipt its BEGIN time.
 update fmat.photon_inbox set received_at=clock_timestamp() where id=(receipt->>'inboxId')::uuid;
 return (receipt->>'inboxId')::uuid;
end$$;
insert into fixture values('source',to_jsonb(pg_temp.receive(1,'review setup answers')));
create function pg_temp.source() returns uuid language sql as $$select (pg_temp.f('source')#>>'{}')::uuid$$;
insert into fixture select 'issued',fmat.photon_setup_answer_review_start(pg_temp.source());
create function pg_temp.review() returns uuid language sql as $$select (pg_temp.f('issued')->>'reviewId')::uuid$$;
insert into fixture values('decision',to_jsonb(pg_temp.receive(1,'accept setup answers '||pg_temp.review()||' mode,location,transport,travel_buffer')));
create function pg_temp.decision() returns uuid language sql as $$select (pg_temp.f('decision')#>>'{}')::uuid$$;
create function pg_temp.check() returns jsonb language sql as $$select fmat.photon_setup_answer_review_check(pg_temp.decision(),pg_temp.review())$$;


-- Concurrency fixture boundary.
select ok(not has_table_privilege(role,tab,priv),role||' cannot '||priv||' '||tab)
 from unnest(array['anon','authenticated','service_role']) role cross join unnest(array['fmat.photon_setup_answer_reviews','fmat.photon_setup_answer_review_publications','fmat.photon_setup_answer_acceptances']) tab cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) priv;
select ok((select relrowsecurity from pg_class where oid=tab::regclass),tab||' uses RLS') from unnest(array['fmat.photon_setup_answer_reviews','fmat.photon_setup_answer_review_publications','fmat.photon_setup_answer_acceptances']) tab;
select ok(not has_function_privilege(role,fn,'EXECUTE'),role||' cannot call '||fn) from unnest(array['anon','authenticated','service_role']) role cross join unnest(array['fmat.setup_answer_patches(jsonb)','fmat.photon_setup_answer_command_keys(text,uuid)','fmat.photon_setup_answer_review_start(uuid)','fmat.photon_setup_answer_review_publish(uuid,uuid,text)','fmat.photon_setup_answer_review_check(uuid,uuid)']) fn;
select ok(not has_function_privilege(role,'public.fmat_photon_setup_answers(text,uuid,jsonb)','EXECUTE'),role||' cannot accept') from unnest(array['anon','authenticated']) role;
select ok(has_function_privilege('service_role','public.fmat_photon_setup_answers(text,uuid,jsonb)','EXECUTE'),'service can invoke checked boundary');
create function pg_temp.accept() returns jsonb language sql as $$select public.fmat_photon_setup_answers('accept',pg_temp.decision(),jsonb_build_object('reviewId',pg_temp.review()))$$;
select throws_ok($$select pg_temp.accept()$$,'P0001','REVIEW_DELIVERY_REQUIRED','unpublished review cannot authorize');
select is((select count(*) from fmat.photon_setup_answer_acceptances),0::bigint,'no implicit acceptance');
select throws_ok($$select public.fmat_photon_setup_answers('accept',pg_temp.decision(),jsonb_build_object('reviewId',pg_temp.review(),'keys',array['mode']))$$,'P0001','INVALID_INPUT','caller cannot replace signed subset');
select throws_ok($$select public.fmat_photon_setup_answers('publish',pg_temp.source(),jsonb_build_object('reviewId',pg_temp.review(),'text',repeat('🙂',2001)))$$,'P0001','INVALID_INPUT','UTF-16 publication bound');
select lives_ok($$select public.fmat_photon_setup_answers('publish',pg_temp.source(),jsonb_build_object('reviewId',pg_temp.review(),'text','Complete synthetic answer review'))$$,'exact publication created');
select throws_ok($$select pg_temp.accept()$$,'P0001','REVIEW_DELIVERY_REQUIRED','publication is not delivery');
select throws_ok($$select public.fmat_photon_setup_answers('publish',pg_temp.source(),jsonb_build_object('reviewId',pg_temp.review(),'text','Changed'))$$,'P0001','IDEMPOTENCY_CONFLICT','changed publication retry denied');
update fmat.photon_replies set status='accepted',provider_reference='fixture-accepted' where inbox_id=pg_temp.source();
select throws_ok($$select public.fmat_photon_setup_answers('accept',pg_temp.receive(2,'accept setup answers '||pg_temp.review()||' mode'),jsonb_build_object('reviewId',pg_temp.review()))$$,'P0001','FORBIDDEN','other linked host cannot accept');
select throws_ok($$select public.fmat_photon_setup_answers('accept',pg_temp.receive(1,'yes'),jsonb_build_object('reviewId',pg_temp.review()))$$,'P0001','FORBIDDEN','bare assent denied');
select throws_ok($$select public.fmat_photon_setup_answers('accept',pg_temp.receive(1,'accept setup answers '||pg_temp.review()||' mode,mode'),jsonb_build_object('reviewId',pg_temp.review()))$$,'P0001','INVALID_INPUT','duplicate keys denied');
select throws_ok($$select public.fmat_photon_setup_answers('accept',pg_temp.receive(1,'accept setup answers '||pg_temp.review()||' location'),jsonb_build_object('reviewId',pg_temp.review()))$$,'P0001','INVALID_INPUT','dependent keys require pending mode');
select throws_ok($$select public.fmat_photon_setup_answers('accept',pg_temp.receive(1,'accept setup answers '||pg_temp.review()||' mode,all'),jsonb_build_object('reviewId',pg_temp.review()))$$,'P0001','INVALID_INPUT','unknown shortcut denied');

savepoint expired_answer_review;
alter table fmat.photon_setup_answer_reviews disable trigger photon_setup_answer_reviews_immutable;
update fmat.photon_setup_answer_reviews set created_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute' where id=pg_temp.review();
alter table fmat.photon_setup_answer_reviews enable trigger photon_setup_answer_reviews_immutable;
select throws_ok($$select pg_temp.accept()$$,'P0001','REVISION_CONFLICT','expired review denied');
rollback to expired_answer_review;
savepoint replaced_receiver;
update fmat.photon_receivers set receiver_id=gen_random_uuid() where project_id='a8510000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.accept()$$,'P0001','UNAUTHORIZED','replaced receiver denied');
rollback to replaced_receiver;
update fmat.photon_replies set status='uncertain' where inbox_id=pg_temp.source();
select throws_ok($$select pg_temp.accept()$$,'P0001','REVIEW_DELIVERY_REQUIRED','uncertain delivery cannot authorize');
update fmat.photon_replies set status='accepted',provider_reference=null where inbox_id=pg_temp.source();
select throws_ok($$select pg_temp.accept()$$,'P0001','REVIEW_DELIVERY_REQUIRED','missing reference cannot authorize');
select throws_ok($$update fmat.photon_replies set provider_reference='fixture-accepted',text=null where inbox_id=pg_temp.source()$$,'23514',null,'accepted body cannot be removed');
update fmat.photon_replies set status='delivered',text=null,provider_reference='fixture-accepted' where inbox_id=pg_temp.source();
select lives_ok($$select pg_temp.check()$$,'purged delivered body retains exact publication evidence');
insert into fixture select 'before',fmat.host_setup_view(pg_temp.host(1));
update fmat.hosts set rules_version=rules_version+1 where id=pg_temp.host(1);
select throws_ok($$select pg_temp.accept()$$,'P0001','REVISION_CONFLICT','changed rules deny acceptance');
update fmat.hosts set rules_version=rules_version-1 where id=pg_temp.host(1);
insert into fixture select 'generation',to_jsonb(generation) from fmat.calendar_connections where principal_id=pg_temp.host(1);
update fmat.calendar_connections set generation=gen_random_uuid() where principal_id=pg_temp.host(1);
select throws_ok($$select pg_temp.accept()$$,'P0001','REVISION_CONFLICT','changed grant denies acceptance');
update fmat.calendar_connections set generation=(pg_temp.f('generation')#>>'{}')::uuid where principal_id=pg_temp.host(1);
-- Any failure saving the receipt must roll back the draft/provenance transition.
create function pg_temp.fail_receipt() returns trigger language plpgsql as $$begin raise exception 'fixture receipt failure';end$$;
create trigger fixture_fail before insert on fmat.photon_setup_answer_acceptances for each row execute function pg_temp.fail_receipt();
select throws_ok($$select pg_temp.accept()$$,'P0001','fixture receipt failure','receipt and draft commit atomically');
select is(fmat.host_setup_view(pg_temp.host(1)),pg_temp.f('before'),'receipt failure preserves all setup state');
drop trigger fixture_fail on fmat.photon_setup_answer_acceptances;
savepoint elapsed_draft_wait;
create function pg_temp.delay_draft() returns trigger language plpgsql as $$begin perform pg_sleep(0.5);return new;end$$;
create trigger fixture_delay before insert on fmat.setup_drafts for each row execute function pg_temp.delay_draft();
alter table fmat.photon_setup_answer_reviews disable trigger photon_setup_answer_reviews_immutable;
update fmat.photon_setup_answer_reviews set expires_at=clock_timestamp()+interval '300 milliseconds' where id=pg_temp.review();
alter table fmat.photon_setup_answer_reviews enable trigger photon_setup_answer_reviews_immutable;
select throws_ok($$select pg_temp.accept()$$,'P0001','REVISION_CONFLICT','expiry inside shared draft mutation rolls back acceptance');
select is(fmat.host_setup_view(pg_temp.host(1)),pg_temp.f('before'),'expired save leaves no draft/provenance mutation');
rollback to elapsed_draft_wait;
insert into fixture select 'accepted',pg_temp.accept();
select is(pg_temp.accept(),pg_temp.f('accepted'),'same signed input recovers exact original result');
select is((pg_temp.f('accepted')->>'revision')::integer,(pg_temp.f('before')->>'revision')::integer+1,'one conversation revision');
select is((select count(*) from fmat.photon_setup_answer_acceptances where review_id=pg_temp.review()),1::bigint,'one acceptance receipt');
select is(fmat.host_setup_view(pg_temp.host(1))->'confirmed',pg_temp.f('before')->'confirmed','accepted answers do not save settings');
select is(fmat.host_setup_view(pg_temp.host(1))->'draft'->'origins',pg_temp.f('before')->'draft'->'origins','assistant origins retained');
select is(fmat.host_setup_view(pg_temp.host(1))->'draft'->'clarifications',pg_temp.f('before')->'draft'->'clarifications','questions retained');
select is(fmat.host_setup_view(pg_temp.host(1))->'draft'->'provenance'->>key,'host','accepted provenance: '||key) from unnest(array['rules.meetingMode','rules.locationPolicy','rules.locations','rules.travelMode','rules.travelBufferMinutes'])key;
select is(fmat.host_setup_view(pg_temp.host(1))->'draft'->'provenance'->>'rules.durationMinutes','assistant','unselected field retains provenance');
select is((select channel from fmat.setup_turns where conversation_id=(select conversation_id from fmat.photon_setup_answer_reviews where id=pg_temp.review()) order by sequence desc limit 1),'imessage','actual human channel attribution');
select is((select count(*) from fmat.booking_attempts where host_id=pg_temp.host(1)),0::bigint,'no booking effects');
select throws_ok($$select public.fmat_photon_setup_answers('accept',pg_temp.receive(1,'accept setup answers '||pg_temp.review()||' mode,location,transport,travel_buffer'),jsonb_build_object('reviewId',pg_temp.review()))$$,'P0001','REVISION_CONFLICT','new message cannot reuse accepted review');
select throws_ok($$update fmat.photon_setup_answer_acceptances set result='{}' where review_id=pg_temp.review()$$,'P0001','IMMUTABLE_EVALUATION','saved receipt immutable');
select throws_ok($$update fmat.photon_setup_answer_reviews set snapshot='{}' where id=pg_temp.review()$$,'P0001','IMMUTABLE_EVALUATION','review immutable');
select throws_ok($$update fmat.photon_setup_answer_review_publications set text='changed' where review_id=pg_temp.review()$$,'P0001','IMMUTABLE_EVALUATION','publication immutable');
-- Later drafts survive a lost-response replay without current-state substitution.
select fmat.host_setup_operation('draft',pg_temp.actor(1),jsonb_build_object('expectedRevision',fmat.host_setup_view(pg_temp.host(1))->'revision','patch','{"rules":{"bufferMinutes":25}}'::jsonb,'unresolved','[]'::jsonb,'idempotencyKey',gen_random_uuid()),'host');
insert into fixture select 'later',fmat.host_setup_view(pg_temp.host(1));
select is(pg_temp.accept(),pg_temp.f('accepted'),'replay returns original receipt after later edit');
select is(fmat.host_setup_view(pg_temp.host(1)),pg_temp.f('later'),'replay preserves newer draft');
update fmat.photon_links set revoked_at=clock_timestamp() where host_id=pg_temp.host(1);
select throws_ok($$select pg_temp.accept()$$,'P0001','UNAUTHORIZED','unlink fences cached result');

insert into fixture values('partial-source',to_jsonb(pg_temp.receive(2,'review setup answers')));
insert into fixture select 'partial-review',public.fmat_photon_setup_answers('review',(pg_temp.f('partial-source')#>>'{}')::uuid,'{}');
select public.fmat_photon_setup_answers('publish',(pg_temp.f('partial-source')#>>'{}')::uuid,jsonb_build_object('reviewId',pg_temp.f('partial-review')->'reviewId','text','Complete second-host review'));
update fmat.photon_replies set status='accepted',provider_reference='second-reference' where inbox_id=(pg_temp.f('partial-source')#>>'{}')::uuid;
select public.fmat_photon_setup_answers('accept',pg_temp.receive(2,'accept setup answers '||(pg_temp.f('partial-review')->>'reviewId')||' mode'),jsonb_build_object('reviewId',pg_temp.f('partial-review')->'reviewId'));
select is(fmat.host_setup_view(pg_temp.host(2))->'draft'->'provenance'->>'rules.meetingMode','host','partial acceptance promotes selected mode');
select is(fmat.host_setup_view(pg_temp.host(2))->'draft'->'provenance'->>'rules.travelMode','assistant','unselected physical answer remains advisory');
select ok(not(fmat.setup_answer_patches(fmat.host_setup_view(pg_temp.host(2))) ? 'mode'),'accepted mode is not requested again');
select ok(fmat.setup_answer_patches(fmat.host_setup_view(pg_temp.host(2))) ? 'transport','remaining physical answers stay eligible');
select is(fmat.host_setup_view(pg_temp.host(2))->'review','null'::jsonb,'partial explicit answers cannot create a complete final review');
select * from finish();
rollback;
