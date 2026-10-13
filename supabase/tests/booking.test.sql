begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temporary table booking_fixture(name text primary key,value jsonb not null);
create function pg_temp.fixture(p_name text) returns jsonb language sql as $$ select value from booking_fixture where name=p_name $$;
create function pg_temp.book_command(p_op text,p_actor_name text,p_input jsonb default '{}') returns jsonb language sql as $$
  select public.fmat_command(p_op,pg_temp.fixture(p_actor_name),p_input||jsonb_build_object('idempotencyKey',gen_random_uuid()::text))
$$;
insert into booking_fixture values('host','{"kind":"host","id":"00000000-0000-4000-8000-000000000011","email":"host@example.com","confirmationSource":"authenticated_web"}'),
 ('worker','{"kind":"worker","id":"booking-test"}'),('otherWorker','{"kind":"worker","id":"other-worker"}'),('operator','{"kind":"operator","id":"booking-operator"}');
insert into fmat.invitations(id,email,token_hash,expires_at,issued_by,redeemed_by,redeemed_at)
  values('00000000-0000-4000-8000-000000000010','host@example.com',repeat('a',64),now()+interval '1 day','operator','00000000-0000-4000-8000-000000000011',now());
insert into fmat.hosts(id,email,invitation_id,handle,display_name,rules,rules_version,conflict_calendar_ids,booking_calendar_id)
  values('00000000-0000-4000-8000-000000000011','host@example.com','00000000-0000-4000-8000-000000000010','booker','Booking Host',
    '{"timezone":"Asia/Seoul","durationMinutes":30,"availability":[{"days":[0,1,2,3,4,5,6],"start":"00:00","end":"23:59"}],"focusBlocks":[],"bufferMinutes":0,"travelMode":"WALK","preferences":"private preferences"}',1,array['conflict-only'],'booking-calendar');
insert into fmat.calendar_connections(id,principal_kind,principal_id,provider_subject,scopes,encrypted_credential)
  values('00000000-0000-4000-8000-000000000012','host','00000000-0000-4000-8000-000000000011','google-host',array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],repeat('cipher',20));
create function pg_temp.new_request(p_name text,p_day integer default 1) returns uuid language plpgsql as $$
declare v_id uuid:=gen_random_uuid(); v_start timestamptz:=now()+make_interval(days=>p_day); v_details jsonb; v_proposal jsonb;
begin
  v_details:=jsonb_build_object('requesterName','Requester','requesterEmail','guest@example.com','purpose','Shared meeting','durationMinutes',30,'timezone','Asia/Seoul','windows',jsonb_build_array(jsonb_build_object('start',v_start,'end',v_start+interval '3 hours')),'mode','online','location','https://meet.example.com/approved');
  v_proposal:=v_details-'windows'-'durationMinutes'||jsonb_build_object('version',1,'start',v_start,'end',v_start+interval '30 minutes');
  insert into fmat.requests(id,host_id,revision,status,details,token_hash,contact_verified_email,current_proposal_version,requester_agreed_version,expires_at)
    values(v_id,'00000000-0000-4000-8000-000000000011',5,'awaiting_approval',v_details,encode(sha256(convert_to(v_id::text,'UTF8')),'hex'),'guest@example.com',1,1,now()+interval '7 days');
  insert into fmat.proposals(request_id,version,details,rules_version) values(v_id,1,v_proposal,1);
  insert into booking_fixture values(p_name,jsonb_build_object('requestId',v_id));
  return v_id;
end;
$$;
select pg_temp.new_request('first');
select pg_temp.new_request('second',2);
select pg_temp.new_request('unverified',3);
update fmat.requests set contact_verified_email=null where id=(pg_temp.fixture('unverified')->>'requestId')::uuid;
select ok(not has_table_privilege('authenticated','fmat.booking_attempts','UPDATE'),'browser cannot edit booking attempt snapshots');
select throws_ok($$select public.fmat_command('host_approve',pg_temp.fixture('host')-'confirmationSource',pg_temp.fixture('first')||'{"expectedRevision":5,"proposalVersion":1,"confirmed":true,"idempotencyKey":"missing-source"}'::jsonb)$$,'P0001','HUMAN_CONFIRMATION_REQUIRED','model-supplied approved flag lacks web confirmation attribution');
select throws_ok($$select pg_temp.book_command('host_approve','host',pg_temp.fixture('first')||'{"expectedRevision":4,"proposalVersion":1,"confirmed":true}'::jsonb)$$,'P0001','STALE_REVISION','stale request approval rejected');
select throws_ok($$select pg_temp.book_command('host_approve','host',pg_temp.fixture('first')||'{"expectedRevision":5,"proposalVersion":2,"confirmed":true}'::jsonb)$$,'P0001','PROPOSAL_STALE','host approval identifies exact current proposal');
select throws_ok($$select pg_temp.book_command('host_approve','host',pg_temp.fixture('unverified')||'{"expectedRevision":5,"proposalVersion":1,"confirmed":true}'::jsonb)$$,'P0001','CONTACT_NOT_VERIFIED','unverified requester contact blocks booking');
select is((select count(*)::integer from fmat.booking_attempts),0,'failed approvals leave no attempts or jobs');
select lives_ok($$select pg_temp.book_command('host_approve','host',pg_temp.fixture('first')||'{"expectedRevision":5,"proposalVersion":1,"confirmed":true}'::jsonb)$$,'current human approval creates durable booking');
select is((select count(*)::integer from fmat.host_approvals),1,'host approval persisted separately from requester agreement');
select is((select count(*)::integer from fmat.jobs where kind='booking'),1,'approval atomically publishes one durable booking job');
select lives_ok($$select pg_temp.book_command('host_approve','host',pg_temp.fixture('second')||'{"expectedRevision":5,"proposalVersion":1,"confirmed":true}'::jsonb)$$,'another request can await serialized host booking');
insert into booking_fixture values('claimed',pg_temp.book_command('jobs_claim','worker','{"workerId":"booking-test","limit":10}'));
insert into booking_fixture select 'firstJob',j from jsonb_array_elements(pg_temp.fixture('claimed')->'jobs') j where j->'payload'->>'requestId'=pg_temp.fixture('first')->>'requestId';
insert into booking_fixture select 'secondJob',j from jsonb_array_elements(pg_temp.fixture('claimed')->'jobs') j where j->'payload'->>'requestId'=pg_temp.fixture('second')->>'requestId';
create function pg_temp.fence(p_name text) returns jsonb language sql as $$select jsonb_build_object('jobId',pg_temp.fixture(p_name)->>'id','leaseToken',pg_temp.fixture(p_name)->>'leaseToken')$$;
insert into booking_fixture values('snapshot',pg_temp.book_command('booking_load','worker',pg_temp.fixture('first')||pg_temp.fence('firstJob')));
select lives_ok($$select public.fmat_command('booking_load',pg_temp.fixture('worker'),pg_temp.fixture('first')||pg_temp.fence('firstJob'))$$,'worker lease operations require fencing rather than client idempotency keys');
select is(pg_temp.fixture('snapshot')->>'calendarId','booking-calendar','destination is frozen host booking calendar');
select ok((pg_temp.fixture('snapshot')->>'eventId') ~ '^[0-9a-v]{36}$','event identity valid Google base32hex alphabet');
select ok(not ((pg_temp.fixture('snapshot')->'payload')::text like '%private preferences%'),'provider payload excludes host-private preferences');
select throws_ok($$select pg_temp.book_command('booking_load','worker',pg_temp.fixture('second')||pg_temp.fence('secondJob'))$$,'P0001','HOST_BUSY','per-host durable reservation serializes competing writes');
select throws_ok($$update fmat.booking_attempts set calendar_id='other-calendar' where id=(pg_temp.fixture('snapshot')->>'attemptId')::uuid$$,'P0001','BOOKING_SNAPSHOT_IMMUTABLE','provider destination cannot mutate after snapshot freezes');
create function pg_temp.dispatch_input(p_snapshot text,p_job text) returns jsonb language sql as $$
  select pg_temp.fence(p_job)||jsonb_build_object('attemptId',pg_temp.fixture(p_snapshot)->>'attemptId','expectedRevision',pg_temp.fixture(p_snapshot)->'expectedRevision','rulesVersion',pg_temp.fixture(p_snapshot)->'rulesVersion','connectionId',pg_temp.fixture(p_snapshot)->>'connectionId','connectionUpdatedAt',(select updated_at from fmat.calendar_connections where id=(pg_temp.fixture(p_snapshot)->>'connectionId')::uuid),'providerSubject',pg_temp.fixture(p_snapshot)->>'connectionProviderSubject','feasibility',jsonb_build_object('valid',true,'checkedAt',now()))
$$;
select throws_ok($$select pg_temp.book_command('booking_dispatch','otherWorker',pg_temp.dispatch_input('snapshot','firstJob'))$$,'P0001','LEASE_LOST','another worker cannot dispatch under copied lease');
select throws_ok($$select pg_temp.book_command('booking_dispatch','worker',pg_temp.dispatch_input('snapshot','firstJob')||jsonb_build_object('feasibility',jsonb_build_object('valid',true,'checkedAt',now()-interval '1 minute')))$$,'P0001','FEASIBILITY_STALE','dispatch rejects stale feasibility evidence');
savepoint changed_rules;
update fmat.hosts set rules_version=rules_version+1 where id=(pg_temp.fixture('host')->>'id')::uuid;
select throws_ok($$select pg_temp.book_command('booking_dispatch','worker',pg_temp.dispatch_input('snapshot','firstJob'))$$,'P0001','FEASIBILITY_STALE','changed host rules invalidate queued dispatch');
rollback to changed_rules;
select throws_ok($$select pg_temp.book_command('booking_dispatch','worker',pg_temp.dispatch_input('snapshot','firstJob')-'connectionUpdatedAt')$$,'P0001','FEASIBILITY_STALE','dispatch requires credential version from fresh provider reads');
select throws_ok($$select pg_temp.book_command('booking_dispatch','worker',pg_temp.dispatch_input('snapshot','firstJob')||jsonb_build_object('connectionUpdatedAt',now()-interval '1 second'))$$,'P0001','FEASIBILITY_STALE','credential rotation after revalidation invalidates dispatch');
savepoint changed_provider;
update fmat.calendar_connections set provider_subject='different-google-account' where id=(pg_temp.fixture('snapshot')->>'connectionId')::uuid;
select throws_ok($$select pg_temp.book_command('booking_dispatch','worker',pg_temp.dispatch_input('snapshot','firstJob')||'{"providerSubject":"different-google-account"}'::jsonb)$$,'P0001','RECONNECT_REQUIRED','same connection identity cannot authorize a different calendar account');
rollback to changed_provider;
select is(pg_temp.book_command('connection_read','worker',jsonb_build_object('hostId',pg_temp.fixture('host')->>'id'))->>'providerSubject','google-host','server connection reads provide credential subject for dispatch guard');
select is((pg_temp.book_command('booking_dispatch','worker',pg_temp.dispatch_input('snapshot','firstJob'))->>'dispatched')::boolean,true,'fresh guarded dispatch marks possible provider write');
select is((pg_temp.book_command('booking_dispatch','worker',pg_temp.dispatch_input('snapshot','firstJob'))->>'dispatched')::boolean,false,'redelivery cannot authorize second provider insert');
select lives_ok($$select pg_temp.book_command('booking_record_outcome','worker',pg_temp.fence('firstJob')||jsonb_build_object('attemptId',pg_temp.fixture('snapshot')->>'attemptId','outcome','uncertain','reason','insert_response_lost'))$$,'lost provider response persists uncertainty');
select is((select count(*)::integer from fmat.host_reservations),1,'uncertain write retains occupied reservation');
select ok(not fmat.withdraw_allowed((pg_temp.fixture('first')->>'requestId')::uuid),'withdrawal cannot erase possible external write');
select is((select count(*)::integer from fmat.jobs where kind='booking_reconcile'),1,'uncertainty atomically saves reconciliation job');
select throws_ok($$select pg_temp.book_command('booking_record_outcome','worker',pg_temp.fence('firstJob')||jsonb_build_object('attemptId',pg_temp.fixture('snapshot')->>'attemptId','outcome','noncreating','reason','event_not_observed'))$$,'P0001','BOOKING_UNCERTAIN','not-found lookup never proves earlier write noncreating');
select throws_ok($$select pg_temp.book_command('booking_retry','operator',pg_temp.fixture('first'))$$,'P0001','BOOKING_UNCERTAIN','operator cannot reset uncertainty to fresh creation');
create function pg_temp.confirm_input() returns jsonb language sql as $$
  select pg_temp.fence('firstJob')||jsonb_build_object('attemptId',pg_temp.fixture('snapshot')->>'attemptId','outcome','confirmed','evidence',jsonb_build_object('calendarId',pg_temp.fixture('snapshot')->>'calendarId','eventId',pg_temp.fixture('snapshot')->>'eventId','eventUrl','https://www.google.com/calendar/event?eid=test','payloadFingerprint',pg_temp.fixture('snapshot')->>'payloadFingerprint'))
$$;
select throws_ok($$select pg_temp.book_command('booking_record_outcome','worker',jsonb_set(pg_temp.confirm_input(),'{evidence,eventId}','"wrong-event"'))$$,'P0001','INVALID_PROVIDER_EVIDENCE','matching saved event identity required for Booked');
select throws_ok($$select pg_temp.book_command('booking_record_outcome','worker',jsonb_set(pg_temp.confirm_input(),'{evidence,payloadFingerprint}','"wrong-payload"'))$$,'P0001','INVALID_PROVIDER_EVIDENCE','verified immutable payload evidence required for Booked');
savepoint expire_owner;
update fmat.jobs set lease_until=now()-interval '1 second' where id=(pg_temp.fixture('firstJob')->>'id')::uuid;
select throws_ok($$select public.fmat_command('booking_load',pg_temp.fixture('worker'),pg_temp.fixture('first')||pg_temp.fence('firstJob'))$$,'P0001','LEASE_LOST','worker snapshot reload rechecks current lease on every invocation');
select throws_ok($$select pg_temp.book_command('booking_record_outcome','worker',pg_temp.confirm_input())$$,'P0001','LEASE_LOST','expired worker cannot confirm provider evidence');
select is((select count(*)::integer from fmat.host_reservations),1,'expired lease does not release possible external reservation');
rollback to expire_owner;
select lives_ok($$select pg_temp.book_command('booking_record_outcome','worker',pg_temp.confirm_input())$$,'verified observation confirms uncertain write');
select is((select status from fmat.requests where id=(pg_temp.fixture('first')->>'requestId')::uuid),'booked','Booked requires verified provider evidence');
select is((select count(*)::integer from fmat.host_reservations),0,'confirmed booking releases internal reservation');
select is((select count(*)::integer from fmat.outbox where payload->>'type'='booking_confirmed'),2,'confirmation atomically creates separate requester and host notifications');
select is((select count(*)::integer from fmat.jobs where kind='delivery'),2,'notification delivery saved independently from booking');
update fmat.outbox set status='failed' where payload->>'type'='booking_confirmed';
select is((select status from fmat.requests where id=(pg_temp.fixture('first')->>'requestId')::uuid),'booked','notification failure cannot reverse confirmed booking');
select lives_ok($$select pg_temp.book_command('booking_record_outcome','worker',pg_temp.confirm_input())$$,'duplicate verified observation is harmless');
select is((select count(*)::integer from fmat.outbox where payload->>'type'='booking_confirmed'),2,'duplicate confirmation does not duplicate notifications');
select lives_ok($$select pg_temp.book_command('booking_load','worker',pg_temp.fixture('second')||pg_temp.fence('secondJob'))$$,'second request may acquire host reservation after first confirms');
insert into booking_fixture values('secondSnapshot',pg_temp.book_command('booking_load','worker',pg_temp.fixture('second')||pg_temp.fence('secondJob')));
select is(jsonb_array_length(pg_temp.fixture('secondSnapshot')->'localBookings'),1,'revalidation receives confirmed local bookings despite provider read lag');
select is(pg_temp.fixture('secondSnapshot')->'localBookings'->0->>'mode','online','confirmed local booking preserves explicit immutable proposal mode');
select is(pg_temp.fixture('secondSnapshot')->'localBookings'->0->>'calendarId','booking-calendar','confirmed local booking supplies calendar identity for dedupe');
select is((pg_temp.book_command('booking_dispatch','worker',pg_temp.dispatch_input('secondSnapshot','secondJob'))->>'dispatched')::boolean,true,'second distinct interval dispatches under current reservation');
select lives_ok($$select pg_temp.book_command('booking_record_outcome','worker',pg_temp.fence('secondJob')||jsonb_build_object('attemptId',pg_temp.fixture('secondSnapshot')->>'attemptId','outcome','noncreating','reason','calendar_insert_rejected'))$$,'definitive provider rejection records noncreating attempt');
select is((select count(*)::integer from fmat.host_reservations),0,'conclusively rejected write releases reservation');
select lives_ok($$select pg_temp.book_command('booking_retry','operator',pg_temp.fixture('second'))$$,'audited operator can retry conclusively noncreating approved attempt');
select is((select count(*)::integer from fmat.booking_attempts where request_id=(pg_temp.fixture('second')->>'requestId')::uuid),2,'retry creates a new immutable attempt');
select is((select count(distinct event_id)::integer from fmat.booking_attempts where request_id=(pg_temp.fixture('second')->>'requestId')::uuid),1,'retry retains one stable booking identity per request');
insert into booking_fixture values('retryClaimed',pg_temp.book_command('jobs_claim','worker','{"workerId":"booking-test","limit":10}'));
insert into booking_fixture select 'retryJob',j from jsonb_array_elements(pg_temp.fixture('retryClaimed')->'jobs') j where j->>'kind'='booking' and j->'payload'->>'requestId'=pg_temp.fixture('second')->>'requestId';
insert into booking_fixture values('retrySnapshot',pg_temp.book_command('booking_load','worker',pg_temp.fixture('second')||pg_temp.fence('retryJob')));
select ok(fmat.withdraw_allowed((pg_temp.fixture('second')->>'requestId')::uuid),'prepared retry may be withdrawn before provider dispatch');
savepoint cancelled_before_dispatch;
update fmat.requests set status='withdrawn',revision=revision+1 where id=(pg_temp.fixture('second')->>'requestId')::uuid;
select throws_ok($$select pg_temp.book_command('booking_dispatch','worker',pg_temp.dispatch_input('retrySnapshot','retryJob'))$$,'P0001','STALE_REVISION','withdrawal wins atomically before provider boundary');
rollback to cancelled_before_dispatch;
select lives_ok($$select pg_temp.book_command('booking_record_outcome','worker',pg_temp.fence('retryJob')||jsonb_build_object('attemptId',pg_temp.fixture('retrySnapshot')->>'attemptId','outcome','blocked','reason','pre_dispatch_conflict'))$$,'pre-dispatch feasibility rejection blocks without asserting an external write');
select pg_temp.new_request('overlap',1);
select pg_temp.book_command('host_approve','host',pg_temp.fixture('overlap')||'{"expectedRevision":5,"proposalVersion":1,"confirmed":true}'::jsonb);
insert into booking_fixture values('overlapClaimed',pg_temp.book_command('jobs_claim','worker','{"workerId":"booking-test","limit":10}'));
insert into booking_fixture select 'overlapJob',j from jsonb_array_elements(pg_temp.fixture('overlapClaimed')->'jobs') j where j->'payload'->>'requestId'=pg_temp.fixture('overlap')->>'requestId';
insert into booking_fixture values('overlapSnapshot',pg_temp.book_command('booking_load','worker',pg_temp.fixture('overlap')||pg_temp.fence('overlapJob')));
select throws_ok($$select pg_temp.book_command('booking_dispatch','worker',pg_temp.dispatch_input('overlapSnapshot','overlapJob'))$$,'P0001','CALENDAR_CONFLICT','local confirmed booking prevents overlapping write even if Calendar read misses it');
-- Credential refresh uses the same server-observed subject and revision as provider reads.
select throws_ok($$select pg_temp.book_command('token_update','worker',jsonb_build_object('connectionId',pg_temp.fixture('snapshot')->>'connectionId','encryptedCredential',repeat('new',20),'providerSubject','google-host','expectedUpdatedAt',now()-interval '1 second'))$$,'P0001','FEASIBILITY_STALE','late refresh cannot overwrite a newer credential bundle');
select throws_ok($$select pg_temp.book_command('token_update','worker',jsonb_build_object('connectionId',pg_temp.fixture('snapshot')->>'connectionId','encryptedCredential',repeat('new',20),'providerSubject','another-account','expectedUpdatedAt',now()))$$,'P0001','RECONNECT_REQUIRED','refresh cannot replace credentials from a different provider account');
select lives_ok($$select pg_temp.book_command('token_update','worker',jsonb_build_object('connectionId',pg_temp.fixture('snapshot')->>'connectionId','encryptedCredential',repeat('new',20),'providerSubject','google-host','expectedUpdatedAt',(select updated_at from fmat.calendar_connections where id=(pg_temp.fixture('snapshot')->>'connectionId')::uuid)))$$,'current refresh context can atomically rotate encrypted credentials');

-- Exercise actual generic claim exhaustion rather than manually assigning a dead status.
create function pg_temp.exhaust_job(p_job_name text,p_host_busy boolean default false) returns void language plpgsql as $$
declare v_job fmat.jobs; v_claimed jsonb; v_item jsonb;
begin
  for i in 1..6 loop
    select * into strict v_job from fmat.jobs where id=(pg_temp.fixture(p_job_name)->>'id')::uuid;
    exit when v_job.status='dead';
    update fmat.jobs set lease_until=now()-interval '1 second' where id=v_job.id;
    v_claimed:=pg_temp.book_command('jobs_claim','worker','{"workerId":"booking-test","limit":10}');
    for v_item in select value from jsonb_array_elements(v_claimed->'jobs') loop
      if v_item->>'id'=v_job.id::text then
        update booking_fixture set value=v_item where name=p_job_name;
        if p_host_busy then
          begin
            perform pg_temp.book_command('booking_load','worker',jsonb_build_object('requestId',v_item->'payload'->>'requestId')||pg_temp.fence(p_job_name));
            raise exception 'expected host contention';
          exception when raise_exception then
            if sqlerrm<>'HOST_BUSY' then raise; end if;
          end;
        end if;
      end if;
    end loop;
  end loop;
  if (select status from fmat.jobs where id=v_job.id)<>'dead' then raise exception 'job did not exhaust'; end if;
end;
$$;
create function pg_temp.approve_claim(p_name text,p_day integer,p_load boolean default true) returns void language plpgsql as $$
declare v_claimed jsonb; v_item jsonb;
begin
  perform pg_temp.new_request(p_name,p_day);
  perform pg_temp.book_command('host_approve','host',pg_temp.fixture(p_name)||'{"expectedRevision":5,"proposalVersion":1,"confirmed":true}'::jsonb);
  v_claimed:=pg_temp.book_command('jobs_claim','worker','{"workerId":"booking-test","limit":10}');
  select value into strict v_item from jsonb_array_elements(v_claimed->'jobs') where value->>'kind'='booking' and value->'payload'->>'requestId'=pg_temp.fixture(p_name)->>'requestId';
  insert into booking_fixture values(p_name||'Job',v_item);
  if p_load then insert into booking_fixture values(p_name||'Snapshot',pg_temp.book_command('booking_load','worker',pg_temp.fixture(p_name)||pg_temp.fence(p_name||'Job'))); end if;
end;
$$;
select throws_ok($$select pg_temp.book_command('booking_retry','operator',pg_temp.fixture('overlap')||pg_temp.fence('overlapJob'))$$,'P0001','JOB_STILL_ACTIVE','copied unexpired worker lease cannot authorize prepared retirement');
select pg_temp.exhaust_job('overlapJob');
select is((select attempts from fmat.jobs where id=(pg_temp.fixture('overlapJob')->>'id')::uuid),5,'worker crashes exhaust bounded claim budget');
select is((select status from fmat.jobs where id=(pg_temp.fixture('overlapJob')->>'id')::uuid),'dead','exhausted prepared job is dead');
select is((select count(*)::integer from fmat.host_reservations where attempt_id=(pg_temp.fixture('overlapSnapshot')->>'attemptId')::uuid),1,'generic claim exhaustion preserves prepared reservation until audited recovery');
update fmat.hosts set rules_version=2 where id=(pg_temp.fixture('host')->>'id')::uuid;
select is((pg_temp.book_command('booking_retry','operator',pg_temp.fixture('overlap'))->>'retired')::boolean,true,'changed rules retire dead undispatched attempt without failed recreation rollback');
select is((select count(*)::integer from fmat.host_reservations),0,'changed-prerequisite retirement commits reservation release');
select is((select status from fmat.requests where id=(pg_temp.fixture('overlap')->>'requestId')::uuid),'negotiating','changed prerequisites require a new proposal and decisions');
select is((select count(*)::integer from fmat.booking_attempts where request_id=(pg_temp.fixture('overlap')->>'requestId')::uuid),1,'changed-prerequisite retirement publishes no new booking');
update fmat.hosts set rules_version=1 where id=(pg_temp.fixture('host')->>'id')::uuid;

select pg_temp.approve_claim('crashedOwner',3);
select pg_temp.exhaust_job('crashedOwnerJob');
select lives_ok($$select pg_temp.book_command('booking_retry','operator',pg_temp.fixture('crashedOwner'))$$,'exhausted prepared owner with current decisions can recreate after crashes');
select is((select count(*)::integer from fmat.host_reservations),0,'prepared owner recovery releases old reservation before new worker ownership');
select is((select count(*)::integer from fmat.booking_attempts where request_id=(pg_temp.fixture('crashedOwner')->>'requestId')::uuid),2,'crash recovery publishes exactly one new attempt');
insert into booking_fixture values('crashedOwnerRecoveryClaim',pg_temp.book_command('jobs_claim','worker','{"workerId":"booking-test","limit":10}'));
insert into booking_fixture select 'crashedOwnerRecoveryJob',j from jsonb_array_elements(pg_temp.fixture('crashedOwnerRecoveryClaim')->'jobs') j where j->>'kind'='booking' and j->'payload'->>'requestId'=pg_temp.fixture('crashedOwner')->>'requestId';
insert into booking_fixture values('crashedOwnerRecoverySnapshot',pg_temp.book_command('booking_load','worker',pg_temp.fixture('crashedOwner')||pg_temp.fence('crashedOwnerRecoveryJob')));
select is((select attempt_id::text from fmat.host_reservations),pg_temp.fixture('crashedOwnerRecoverySnapshot')->>'attemptId','new fenced owner reacquires only its fresh reservation');
select pg_temp.book_command('booking_record_outcome','worker',pg_temp.fence('crashedOwnerRecoveryJob')||jsonb_build_object('attemptId',pg_temp.fixture('crashedOwnerRecoverySnapshot')->>'attemptId','outcome','blocked','reason','fixture_cleanup'));

select pg_temp.approve_claim('uncertainOwner',4);
select pg_temp.book_command('booking_dispatch','worker',pg_temp.dispatch_input('uncertainOwnerSnapshot','uncertainOwnerJob'));
select pg_temp.book_command('booking_record_outcome','worker',pg_temp.fence('uncertainOwnerJob')||jsonb_build_object('attemptId',pg_temp.fixture('uncertainOwnerSnapshot')->>'attemptId','outcome','uncertain','reason','insert_response_lost'));
select pg_temp.approve_claim('contender',5,false);
select throws_ok($$select pg_temp.book_command('booking_load','worker',pg_temp.fixture('contender')||pg_temp.fence('contenderJob'))$$,'P0001','HOST_BUSY','second prepared attempt waits while possible write holds host');
select pg_temp.exhaust_job('contenderJob',true);
select is((select status from fmat.jobs where id=(pg_temp.fixture('contenderJob')->>'id')::uuid),'dead','repeated host contention can exhaust generic retries');
select lives_ok($$select pg_temp.book_command('booking_retry','operator',pg_temp.fixture('contender'))$$,'audited recovery republishes definitively undispatched contender after exhaustion');
select is((select count(*)::integer from fmat.booking_attempts where request_id=(pg_temp.fixture('contender')->>'requestId')::uuid),2,'prepared recovery creates a fresh immutable attempt');
select throws_ok($$select pg_temp.book_command('booking_retry','operator',pg_temp.fixture('contender'))$$,'P0001','JOB_STILL_ACTIVE','queued recovered attempt cannot be retired before its worker runs');
select is((select count(distinct event_id)::integer from fmat.booking_attempts where request_id=(pg_temp.fixture('contender')->>'requestId')::uuid),1,'prepared recovery preserves stable provider event identity');
select is((select attempt_id::text from fmat.host_reservations),pg_temp.fixture('uncertainOwnerSnapshot')->>'attemptId','contender recovery never releases another possibly dispatched reservation');
select throws_ok($$select pg_temp.book_command('booking_retry','operator',pg_temp.fixture('uncertainOwner'))$$,'P0001','BOOKING_UNCERTAIN','prepared recovery cannot reset the uncertain owner');
select pg_temp.book_command('booking_record_outcome','worker',pg_temp.fence('uncertainOwnerJob')||jsonb_build_object('attemptId',pg_temp.fixture('uncertainOwnerSnapshot')->>'attemptId','outcome','confirmed','evidence',jsonb_build_object('calendarId',pg_temp.fixture('uncertainOwnerSnapshot')->>'calendarId','eventId',pg_temp.fixture('uncertainOwnerSnapshot')->>'eventId','eventUrl',null,'payloadFingerprint',pg_temp.fixture('uncertainOwnerSnapshot')->>'payloadFingerprint')));
insert into booking_fixture values('contenderRecoveryClaim',pg_temp.book_command('jobs_claim','worker','{"workerId":"booking-test","limit":10}'));
insert into booking_fixture select 'contenderRecoveryJob',j from jsonb_array_elements(pg_temp.fixture('contenderRecoveryClaim')->'jobs') j where j->>'kind'='booking' and j->'payload'->>'requestId'=pg_temp.fixture('contender')->>'requestId';
select lives_ok($$select pg_temp.book_command('booking_load','worker',pg_temp.fixture('contender')||pg_temp.fence('contenderRecoveryJob'))$$,'recovered contender acquires reservation after owner observation confirms');
insert into booking_fixture values('contenderRecoverySnapshot',pg_temp.book_command('booking_load','worker',pg_temp.fixture('contender')||pg_temp.fence('contenderRecoveryJob')));
select pg_temp.exhaust_job('contenderRecoveryJob');
update fmat.requests set status='withdrawn',revision=revision+1 where id=(pg_temp.fixture('contender')->>'requestId')::uuid;
select is((pg_temp.book_command('booking_retry','operator',pg_temp.fixture('contender'))->>'retired')::boolean,true,'withdrawn exhausted owner retires without recreating booking');
select is((select count(*)::integer from fmat.host_reservations),0,'withdrawn exhausted owner releases only its undispatched reservation');
select is((select count(*)::integer from fmat.booking_attempts where request_id=(pg_temp.fixture('contender')->>'requestId')::uuid),2,'terminal retirement adds no new attempt');

select pg_temp.approve_claim('expiredOwner',6);
select pg_temp.exhaust_job('expiredOwnerJob');
update fmat.requests set expires_at=now()-interval '1 second' where id=(pg_temp.fixture('expiredOwner')->>'requestId')::uuid;
select is((pg_temp.book_command('booking_retry','operator',pg_temp.fixture('expiredOwner'))->>'retired')::boolean,true,'expired exhausted owner retires without recreation');
select is((select count(*)::integer from fmat.host_reservations),0,'expired exhausted owner releases undispatched reservation');
select is((select status from fmat.requests where id=(pg_temp.fixture('expiredOwner')->>'requestId')::uuid),'expired','expired recovery commits lifecycle expiry');
select ok(exists(select 1 from fmat.audit_events where operation='booking_retire'),'retirement is audited for operator diagnosis');
-- Evaluation receipts are server-only evidence with host/calendar/window boundaries.
insert into fmat.invitations(id,email,token_hash,expires_at,issued_by,redeemed_by,redeemed_at)
  values('00000000-0000-4000-8000-000000000020','other-host@example.com',repeat('b',64),now()+interval '1 day','operator','00000000-0000-4000-8000-000000000021',now());
insert into fmat.hosts(id,email,invitation_id,handle,display_name,rules,rules_version,conflict_calendar_ids,booking_calendar_id)
  select '00000000-0000-4000-8000-000000000021','other-host@example.com','00000000-0000-4000-8000-000000000020','other-booker','Other Host',rules,1,array['conflict-only'],'booking-calendar' from fmat.hosts where id=(pg_temp.fixture('host')->>'id')::uuid;
insert into fmat.calendar_connections(id,principal_kind,principal_id,provider_subject,scopes,encrypted_credential)
  values('00000000-0000-4000-8000-000000000022','host','00000000-0000-4000-8000-000000000021','other-google-host',array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],repeat('cipher',20));
create function pg_temp.confirmed_receipt(p_name text,p_host uuid,p_calendar text,p_day integer) returns void language plpgsql as $$
declare v_request uuid; v_attempt uuid:=gen_random_uuid(); v_approval uuid; v_event text:='fmat'||replace(gen_random_uuid()::text,'-',''); v_payload jsonb; v_proposal fmat.proposals; v_connection fmat.calendar_connections;
begin
  v_request:=pg_temp.new_request(p_name,p_day);
  update fmat.requests set host_id=p_host,status='booked',host_approved_version=1 where id=v_request;
  select * into strict v_proposal from fmat.proposals where request_id=v_request and version=1;
  select * into strict v_connection from fmat.calendar_connections where principal_kind='host' and principal_id=p_host;
  insert into fmat.host_approvals(request_id,proposal_version,host_id,source,approved_revision) values(v_request,1,p_host,'authenticated_web',5) returning id into v_approval;
  insert into fmat.booking_identities(request_id,event_id) values(v_request,v_event);
  v_payload:=jsonb_build_object('id',v_event,'location',v_proposal.details->>'location','start',jsonb_build_object('dateTime',v_proposal.details->>'start','timeZone',v_proposal.details->>'timezone'),
    'end',jsonb_build_object('dateTime',v_proposal.details->>'end','timeZone',v_proposal.details->>'timezone'),'attendees',jsonb_build_array(jsonb_build_object('email','guest@example.com')),
    'extendedProperties',jsonb_build_object('private',jsonb_build_object('fmatRequestId',v_request,'fmatAttemptId',v_attempt,'fmatProposalVersion','1')));
  insert into fmat.booking_attempts(id,request_id,host_id,proposal_version,approval_id,expected_revision,rules_version,connection_id,connection_provider_subject,calendar_id,event_id,payload,payload_fingerprint,starts_at,ends_at,phase,dispatched_at,confirmed_at,provider_evidence)
    values(v_attempt,v_request,p_host,1,v_approval,5,1,v_connection.id,v_connection.provider_subject,p_calendar,v_event,v_payload,encode(sha256(convert_to(v_payload::text,'UTF8')),'hex'),
      (v_proposal.details->>'start')::timestamptz,(v_proposal.details->>'end')::timestamptz,'confirmed',now(),now(),jsonb_build_object('calendarId',p_calendar,'eventId',v_event));
end;
$$;
select pg_temp.confirmed_receipt('foreignReceipt','00000000-0000-4000-8000-000000000021','booking-calendar',1);
select pg_temp.confirmed_receipt('unselectedReceipt',(pg_temp.fixture('host')->>'id')::uuid,'unselected-calendar',1);
select pg_temp.confirmed_receipt('conflictReceipt',(pg_temp.fixture('host')->>'id')::uuid,'conflict-only',1);
select pg_temp.confirmed_receipt('pastReceipt',(pg_temp.fixture('host')->>'id')::uuid,'booking-calendar',-3);
select pg_temp.confirmed_receipt('adjacentReceipt',(pg_temp.fixture('host')->>'id')::uuid,'booking-calendar',0);
insert into booking_fixture values('evaluationOverlay',pg_temp.book_command('evaluation_read','worker',pg_temp.fixture('overlap')));
select is(jsonb_array_length(pg_temp.fixture('evaluationOverlay')->'localBookings'),3,'evaluation includes booking destination, selected conflict calendar and adjacent travel receipt only');
select ok(exists(select 1 from jsonb_array_elements(pg_temp.fixture('evaluationOverlay')->'localBookings') b where b->'payload'->>'id'=pg_temp.fixture('snapshot')->>'eventId'),'selected booking destination is included even when absent from conflict calendar selection');
select ok(exists(select 1 from jsonb_array_elements(pg_temp.fixture('evaluationOverlay')->'localBookings') b where b->>'calendarId'='conflict-only'),'selected conflict calendar receipt is included');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.fixture('evaluationOverlay')->'localBookings') b where b->'payload'->'extendedProperties'->'private'->>'fmatRequestId'=pg_temp.fixture('foreignReceipt')->>'requestId'),'another host receipt is excluded despite matching calendar identity and window');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.fixture('evaluationOverlay')->'localBookings') b where b->>'calendarId'='unselected-calendar'),'unselected old booking destination receipt is excluded');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.fixture('evaluationOverlay')->'localBookings') b where b->'payload'->'extendedProperties'->'private'->>'fmatRequestId' in (pg_temp.fixture('pastReceipt')->>'requestId',pg_temp.fixture('uncertainOwner')->>'requestId')),'receipts outside relevant windows plus travel margin are excluded');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.fixture('evaluationOverlay')->'localBookings') b where b->>'mode'<>'online'),'online meeting mode comes from immutable proposal despite host-provided URL');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.fixture('evaluationOverlay')->'localBookings') b where b->'payload'->'extendedProperties'->'private'->>'fmatRequestId'=pg_temp.fixture('overlap')->>'requestId'),'nonconfirmed attempt is not treated as a confirmed receipt');
savepoint own_receipt;
update fmat.requests set status='negotiating',expires_at=now()+interval '7 days' where id=(pg_temp.fixture('first')->>'requestId')::uuid;
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.book_command('evaluation_read','worker',pg_temp.fixture('first'))->'localBookings') b where b->'payload'->>'id'=pg_temp.fixture('snapshot')->>'eventId'),'evaluation excludes its own confirmed receipt');
rollback to own_receipt;
insert into booking_fixture select 'evaluationGuest',jsonb_build_object('kind','guest','requestId',id,'tokenHash',token_hash) from fmat.requests where id=(pg_temp.fixture('overlap')->>'requestId')::uuid;
select throws_ok($$select pg_temp.book_command('evaluation_read','evaluationGuest',pg_temp.fixture('overlap'))$$,'P0001','FORBIDDEN','guest cannot directly read host confirmed scheduling receipts');
select ok(not (pg_temp.book_command('request_read','evaluationGuest',pg_temp.fixture('overlap')) ? 'localBookings'),'guest request projection omits confirmed host receipts');
select ok(not (pg_temp.book_command('request_read','host',pg_temp.fixture('overlap')) ? 'localBookings'),'ordinary host request projection also omits evaluation receipt internals');
select ok((pg_temp.book_command('request_read','evaluationGuest',pg_temp.fixture('overlap')))::text not like '%'||(pg_temp.fixture('snapshot')->>'eventId')||'%','guest request response does not disclose another booking identity');
select * from finish();
rollback;
