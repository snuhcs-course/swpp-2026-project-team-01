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


-- Exercise the service-only protocol against current signed inbox evidence.
select ok(not has_table_privilege(role,tab,priv),role||' cannot '||priv||' '||tab)
 from unnest(array['anon','authenticated','service_role']) role cross join unnest(array['fmat.photon_setup_permission_checks','fmat.photon_setup_confirmations']) tab cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) priv;
select ok((select relrowsecurity from pg_class where oid=tab::regclass),tab||' uses RLS') from unnest(array['fmat.photon_setup_permission_checks','fmat.photon_setup_confirmations']) tab;
select ok(not has_function_privilege(role,'fmat.photon_setup_confirmation_replay(uuid,uuid)','EXECUTE'),role||' cannot invoke replay helper') from unnest(array['anon','authenticated','service_role']) role;
select ok(not has_function_privilege(role,'public.fmat_photon_setup(text,uuid,jsonb)','EXECUTE'),role||' cannot invoke internal RPC') from unnest(array['anon','authenticated']) role;
select ok(has_function_privilege('service_role','public.fmat_photon_setup(text,uuid,jsonb)','EXECUTE'),'service may invoke checked protocol');
create function pg_temp.start() returns jsonb language sql as $$select public.fmat_photon_setup('begin_confirmation',pg_temp.decision(),jsonb_build_object('reviewId',pg_temp.review()))$$;
select throws_ok($$select pg_temp.start()$$,'P0001','REVIEW_DELIVERY_REQUIRED','no permission work before delivery');
select public.fmat_photon_setup('publish',pg_temp.source(),jsonb_build_object('reviewId',pg_temp.review(),'text','Complete synthetic review'));
update fmat.photon_replies set status='accepted',provider_reference='synthetic-reference' where inbox_id=pg_temp.source();
insert into fixture select 'check',pg_temp.start();
create function pg_temp.check_id() returns uuid language sql as $$select (pg_temp.f('check')->>'checkId')::uuid$$;
create function pg_temp.finish(calendars jsonb) returns jsonb language sql as $$select public.fmat_photon_setup('finish_confirmation',pg_temp.decision(),jsonb_build_object('checkId',pg_temp.check_id(),'verifiedCalendars',calendars))$$;
insert into fixture values('calendars','[{"id":"conflict","accessRole":"freeBusyReader"},{"id":"destination","accessRole":"writerWithoutPrivateAccess"}]');
select is(pg_temp.f('check')->>'status','checking','begin returns checked grant only to internal service');
select ok((select expires_at<=created_at+interval '30 seconds' from fmat.photon_setup_permission_checks where id=pg_temp.check_id()),'permission check has bounded lifetime');
select throws_ok($$select pg_temp.finish('[{"id":"conflict","accessRole":"reader"},{"id":"destination","accessRole":"reader"}]')$$,'P0001','CALENDAR_ACCESS_INVALID','read-only destination cannot save');
select throws_ok($$select pg_temp.finish('[{"id":"destination","accessRole":"owner"}]')$$,'P0001','CALENDAR_ACCESS_INVALID','missing conflict calendar cannot save');
select throws_ok($$select pg_temp.finish('[{"id":"conflict","accessRole":"owner"},{"id":"conflict","accessRole":"reader"}]')$$,'P0001','INVALID_INPUT','ambiguous duplicate metadata rejected');
select throws_ok($$select pg_temp.finish('[{"id":"conflict","accessRole":"owner","confirmed":true}]')$$,'P0001','INVALID_INPUT','extra metadata cannot confer authority');
select throws_ok($$select public.fmat_photon_setup('begin_confirmation',pg_temp.decision(),jsonb_build_object('reviewId',pg_temp.review(),'hostId',pg_temp.host(1)))$$,'P0001','INVALID_INPUT','caller cannot inject host authority');
select throws_ok($$select public.fmat_photon_setup('finish_confirmation',pg_temp.receive(2,'confirm setup '||pg_temp.review()),jsonb_build_object('checkId',pg_temp.check_id(),'verifiedCalendars',pg_temp.f('calendars')))$$,'P0001','FORBIDDEN','check is bound to original input');
select throws_ok($$update fmat.photon_setup_permission_checks set expires_at=clock_timestamp()+interval '1 day' where id=pg_temp.check_id()$$,'P0001','IMMUTABLE_EVALUATION','deadline cannot be extended');
insert into fixture values('expired-check',to_jsonb(gen_random_uuid()));
insert into fmat.photon_setup_permission_checks(id,inbox_id,review_id,connection_id,generation,created_at,expires_at)
 select (pg_temp.f('expired-check')#>>'{}')::uuid,inbox_id,review_id,connection_id,generation,clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute' from fmat.photon_setup_permission_checks where id=pg_temp.check_id();
select throws_ok($$select public.fmat_photon_setup('finish_confirmation',pg_temp.decision(),jsonb_build_object('checkId',pg_temp.f('expired-check'),'verifiedCalendars',pg_temp.f('calendars')))$$,'P0001','REVISION_CONFLICT','old permission evidence cannot save');
select throws_ok($$select public.fmat_photon_setup('refresh',pg_temp.decision(),jsonb_build_object('checkId',pg_temp.check_id(),'previousCredential','other','encryptedCredential',repeat('n',40)))$$,'P0001','REVISION_CONFLICT','refresh is compare-and-swap');
select lives_ok($$select public.fmat_photon_setup('refresh',pg_temp.decision(),jsonb_build_object('checkId',pg_temp.check_id(),'previousCredential',repeat('e',40),'encryptedCredential',repeat('n',40)))$$,'same-grant token refresh preserves review');
select is((select rules_version from fmat.hosts where id=pg_temp.host(1)),0,'all rejected checks leave confirmed settings unchanged');
select is((select count(*)::integer from fmat.photon_setup_confirmations),0,'rejections leave no confirmation receipt');
create function pg_temp.reject_confirmation_receipt() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_RECEIPT_FAILURE';end$$;
create trigger reject_fixture_receipt before insert on fmat.photon_setup_confirmations for each row execute function pg_temp.reject_confirmation_receipt();
select throws_ok($$select pg_temp.finish(pg_temp.f('calendars'))$$,'P0001','SYNTHETIC_RECEIPT_FAILURE','receipt persistence failure rolls back the settings save');
select is((select rules_version from fmat.hosts where id=pg_temp.host(1)),0,'failed receipt cannot leave a saved policy');
select is((fmat.host_setup_view(pg_temp.host(1))->'draft'->>'status'),'active','failed receipt preserves the current draft');
drop trigger reject_fixture_receipt on fmat.photon_setup_confirmations;
insert into fixture select 'saved',pg_temp.finish(pg_temp.f('calendars'));
select is(pg_temp.f('saved')->>'status','confirmed','fresh metadata saves exact review');
select is((select rules_version from fmat.hosts where id=pg_temp.host(1)),1,'one settings save');
select is((select rules from fmat.hosts where id=pg_temp.host(1)),pg_temp.f('issued')->'settings'->'rules','saved policy equals delivered review');
select is((select count(*)::integer from fmat.photon_setup_confirmations where review_id=pg_temp.review() and inbox_id=pg_temp.decision() and check_id=pg_temp.check_id()),1,'receipt attributes exact review, input and check');
select is((select channel from fmat.setup_turns where conversation_id=(select conversation_id from fmat.photon_setup_reviews where id=pg_temp.review()) order by sequence desc limit 1),'imessage','confirmation turn is attributed to private human input');
select throws_ok($$update fmat.photon_setup_confirmations set result='{}' where review_id=pg_temp.review()$$,'P0001','IMMUTABLE_EVALUATION','saved receipt cannot be rewritten');
select is(pg_temp.start(),pg_temp.f('saved'),'lost-response begin returns same saved receipt');
select is(pg_temp.finish(pg_temp.f('calendars')),pg_temp.f('saved'),'finish retry returns same saved receipt');
select pg_temp.draft(1,'{"rules":{"bufferMinutes":35}}');
select is(pg_temp.start(),pg_temp.f('saved'),'newer draft does not rewrite original receipt');
select is((fmat.host_setup_view(pg_temp.host(1))->'draft'->'settings'->'rules'->>'bufferMinutes')::integer,35,'new draft is preserved');
select is((select rules->>'bufferMinutes' from fmat.hosts where id=pg_temp.host(1)),'10','replay does not save the new draft');
select throws_ok($$select public.fmat_photon_setup('begin_confirmation',pg_temp.receive(1,'confirm setup '||pg_temp.review()),jsonb_build_object('reviewId',pg_temp.review()))$$,'P0001','REVISION_CONFLICT','a new human command cannot replay an old decision');
update fmat.photon_links set revoked_at=clock_timestamp() where host_id=pg_temp.host(1);
select throws_ok($$select pg_temp.start()$$,'P0001','UNAUTHORIZED','saved receipts require current link authority');
select is((select count(*)::integer from fmat.host_approvals),0,'settings save grants no meeting approval');
select is((select count(*)::integer from fmat.booking_attempts),0,'settings save creates no booking work');
select * from finish();
rollback;
