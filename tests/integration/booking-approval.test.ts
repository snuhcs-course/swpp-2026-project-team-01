import {verifyIMessageBooking} from './booking-imessage.ts';
import {verifyBookingCrashes} from './booking-crashes.ts';
import {bookingNeighbors,verifyBookingRevalidation} from './booking-revalidation.ts';
import {routeFingerprint} from '../../lib/server/routes/google.ts';
import {verifyBookingCompetition} from './booking-competition.ts';
import {bookingAgentProbe} from './booking-agent.ts';
import {verifyBookingRecovery} from './booking-recovery.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {BookingApproval} from '../../lib/server/booking/approval.ts';
import {SchedulingPublication} from '../../lib/server/scheduling/publication.ts';
import {AvailabilityEvaluation} from '../../lib/server/scheduling/availability.ts';
import {CandidateRanking} from '../../lib/server/scheduling/ranking.ts';
import {TokenCipher} from '../../lib/server/calendar/encryption.ts';
import {calendarScopes} from '../../lib/server/calendar/google.ts';
import {Database} from '../../lib/server/database/client.ts';
import {verifyHostToken,guestCredential,type Credential} from '../../lib/server/identity/credentials.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {LocalSql} from './local-sql.ts';
import {verifyBookingLeaseCutoffs} from './booking-lease.ts';
import {verifyBookingEvaluation} from './booking-evaluation.ts';
import {verifyBookingDispatch} from './booking-dispatch.ts';
import {verifyBookingReceipt} from './booking-receipt.ts';
import {verifyBookingWithdrawal} from './booking-withdrawal.ts';
import {verifyBookingDelivery} from './booking-delivery.ts';
import {verifyBookingWorker} from './booking-worker.ts';
const code=(value:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===value;
test('Web approval requires exact current host/session/proposal/agreement and commits one attributable approval and job',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const env={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
 const headers={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'},db=new Database(env),sql=new LocalSql(),cipher=new TokenCipher(env),approval=new BookingApproval(db);
 const hosts:{id:string;invite:string;token:string;credential:Credential}[]=[],requests:string[]=[];
 let agent:Awaited<ReturnType<typeof bookingAgentProbe>>|undefined;
 const evaluation=new AvailabilityEvaluation(db,env,{async refresh(bundle){return bundle;},async list(){return [];}},{async read(){return [];}},{async read(_access,_ids,candidate){return bookingNeighbors(candidate);}},{async estimate(request){return {status:'success',fingerprint:routeFingerprint(request),checkedAt:new Date().toISOString(),departureTime:request.departureTime,durationNanoseconds:'300000000000',distanceMeters:1000};}});
 const publication=new SchedulingPublication(db,evaluation,new CandidateRanking(db,{async rank(input,reserve){await reserve();return {orderedIds:input.candidates.map(x=>x.id)};}}));
 const rules={timezone:'UTC',availability:[{days:[0,1,2,3,4,5,6],start:'00:00',end:'23:59'}],focusBlocks:[],bufferMinutes:0,durationMinutes:30,preferences:'',travelMode:'NONE',meetingMode:'online',locationPolicy:'per_meeting',locations:[],travelBufferMinutes:0};
 async function fixture(host=hosts[0],days=2,singleSlot=false,kind:'online'|'guest'|'travel'='online'){
  const id=randomUUID(),token=randomBytes(32).toString('base64url'),day=new Date(Date.now()+days*86400000).toISOString().slice(0,10),details={requesterName:'Guest',requesterEmail:'guest@example.test',purpose:'Approved fixture',durationMinutes:30,timezone:'UTC',windows:[{start:day+'T09:00:00Z',end:day+(singleSlot?'T09:30:00Z':'T10:00:00Z')}],mode:kind==='travel'?'in_person':'online',location:kind==='travel'?'Meeting venue':'https://meet.example.test/approved'};requests.push(id);
  await sql.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values('${id}','${host.id}','${JSON.stringify(details)}','${createHash('sha256').update(token).digest('hex')}',now()+interval '3 days');`);
  if(kind==='guest'){
   const encrypted=cipher.seal({accessToken:'booking-guest-access',refreshToken:'booking-guest-refresh',subject:'booking-guest-'+id,expiresAt:Date.now()+3600000,scopes:[...calendarScopes.guest]},'google:guest:'+id);
   await sql.query(`update fmat.requests set availability_mode='calendar' where id='${id}';insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential,guest_authority_key,selected_calendar_ids) values('guest','${id}','booking-guest-${id}',array['https://www.googleapis.com/auth/calendar.events.freebusy','https://www.googleapis.com/auth/calendar.calendarlist.readonly'],'${encrypted}','${createHash('sha256').update(token).digest('hex')}',array['guest-calendar']);`);
  }
  const guest=guestCredential(id,token);let state=await publication.evaluate(guest,{requestId:id,revision:1});state=await publication.select(guest,{requestId:id,revision:state.revision,publicationId:state.publication!.id,candidateId:state.publication!.candidates[0].id,confirmed:true,idempotencyKey:randomUUID()});
  return {id,guest,state,agree:async()=>publication.agree(guest,{requestId:id,revision:state.revision,proposalVersion:state.proposal!.version,confirmed:true,idempotencyKey:randomUUID()})};
 }
 async function createHost(){
   const email=randomUUID()+'@example.test',password=randomUUID()+randomUUID(),invite=randomUUID();const created=await fetch(local.API_URL+'/auth/v1/admin/users',{method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(created.status,200);const id=(await created.json()).id;
   const login=await fetch(local.API_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:local.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);const token=(await login.json()).access_token,credential=await verifyHostToken(token,{env});hosts.push({id,invite,token,credential});
   const encrypted=cipher.seal({accessToken:'fixture-access',refreshToken:'fixture-refresh',subject:'google-'+id,expiresAt:Date.now()+3600000,scopes:[...calendarScopes.host]},'google:host:'+id);
   await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invite}','${email}','${createHash('sha256').update(invite).digest('hex')}',now()+interval '1 day','approval-test');insert into fmat.hosts(id,email,invitation_id,handle,display_name,rules,rules_version,conflict_calendar_ids,booking_calendar_id) values('${id}','${email}','${invite}','approval-${id.slice(0,8)}','Host','${JSON.stringify(rules)}',1,array['fixture-calendar'],'fixture-calendar');insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential) values('host','${id}','google-${id}',array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],'${encrypted}');`);
  return hosts.at(-1)!;
 }
 try{
  for(let i=0;i<6;i++)await createHost();
  const [a,b,c,d,e,f]=hosts,r=await fixture();
  assert.equal((await approval.read(a.credential,{requestId:r.id})).blocker,'agreement_required');
  await assert.rejects(approval.read(b.credential,{requestId:r.id}),code('NOT_FOUND'));await assert.rejects(approval.read(r.guest,{requestId:r.id}),code('FORBIDDEN'));await assert.rejects(approval.read({...a.credential},{requestId:r.id}),code('UNAUTHORIZED'));
  const agreed=await r.agree(),input={requestId:r.id,revision:agreed.revision,proposalVersion:agreed.proposal!.version,confirmed:true as const,idempotencyKey:randomUUID()};
  assert.equal((await approval.read(a.credential,{requestId:r.id})).blocker,'contact_verification_required');await assert.rejects(approval.approve(a.credential,input),code('CONTACT_NOT_VERIFIED'));
  await sql.query(`update fmat.requests set contact_verified_email='guest@example.test' where id='${r.id}';`);
  assert.equal((await approval.read(a.credential,{requestId:r.id})).canApprove,true);
  await assert.rejects(approval.approve(a.credential,{...input,confirmed:false}));await assert.rejects(approval.approve(a.credential,{...input,confirmationSource:'authenticated_web'}));await assert.rejects(approval.approve(a.credential,{...input,revision:1}),code('STALE_REVISION'));await assert.rejects(approval.approve(a.credential,{...input,proposalVersion:99}),code('STALE_REVISION'));
  await sql.query(`update fmat.hosts set rules_version=2 where id='${a.id}';`);assert.equal((await approval.read(a.credential,{requestId:r.id})).blocker,'proposal_stale');await assert.rejects(approval.approve(a.credential,input),code('STALE_REVISION'));await sql.query(`update fmat.hosts set rules_version=1 where id='${a.id}';`);
  await sql.query(`update fmat.requests set token_revoked_at=now() where id='${r.id}';`);assert.equal((await approval.read(a.credential,{requestId:r.id})).blocker,'proposal_stale');await assert.rejects(approval.approve(a.credential,input),code('STALE_REVISION'));await sql.query(`update fmat.requests set token_revoked_at=null where id='${r.id}';`);
  const results=await Promise.all(Array.from({length:8},()=>approval.approve(a.credential,input)));assert.ok(results.every(x=>x.approved&&x.status==='booking'&&!x.canApprove&&x.revision===input.revision+1));
  for(const table of ['web_approval_decisions','host_approvals','booking_attempts','booking_identities'])assert.equal(await sql.query(`select count(*) from fmat.${table} where request_id='${r.id}';`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.jobs where kind='booking' and payload->>'requestId'='${r.id}';`),'1');
  assert.equal(await sql.query(`select host_id='${a.id}' and session_id='${a.credential.kind==='host'?a.credential.sessionId:''}' and input->>'proposalVersion'='1' from fmat.web_approval_decisions where request_id='${r.id}';`),'t');
  await assert.rejects(approval.approve(a.credential,{...input,revision:input.revision+1}),code('IDEMPOTENCY_CONFLICT'));await assert.rejects(approval.approve(a.credential,{...input,revision:input.revision+1,idempotencyKey:randomUUID()}),code('RECONCILIATION_PENDING'));
  assert.equal(await sql.query(`select has_function_privilege('anon','public.fmat_booking_approval(text,jsonb,jsonb)','EXECUTE')||','||has_function_privilege('authenticated','public.fmat_booking_approval(text,jsonb,jsonb)','EXECUTE')||','||has_function_privilege('service_role','public.fmat_booking_approval(text,jsonb,jsonb)','EXECUTE');`),'false,false,true');
  await sql.query(`do $$begin update fmat.web_approval_decisions set input='{}' where request_id='${r.id}';raise exception 'mutable fixture';exception when raise_exception then if sqlerrm<>'IMMUTABLE_EVALUATION' then raise;end if;end$$;`);
  const imessageHost=await createHost();let imessageDay=20;
  await verifyIMessageBooking(db,env,imessageHost,async()=>{const f=await fixture(imessageHost,imessageDay++);await f.agree();await sql.query(`update fmat.requests set contact_verified_email='guest@example.test' where id='${f.id}';`);return {id:f.id,guest:f.guest};},publication);
  await verifyBookingLeaseCutoffs(r.id,a.id);
  await verifyBookingEvaluation(db,env,r.id,a.id);
  const changed=await fixture();await changed.agree();await sql.query(`update fmat.requests set details=details||'{"purpose":"Changed"}' where id='${changed.id}';`);assert.equal((await approval.read(a.credential,{requestId:changed.id})).blocker,'proposal_stale');
  const racing=await fixture(),raceState=await racing.agree();await sql.query(`update fmat.requests set contact_verified_email='guest@example.test' where id='${racing.id}';`);
  const raceInput={requestId:racing.id,revision:raceState.revision,proposalVersion:raceState.proposal!.version,confirmed:true as const,idempotencyKey:randomUUID()};
  const race=await Promise.allSettled([approval.approve(a.credential,raceInput),approval.approve(a.credential,{...raceInput,idempotencyKey:randomUUID()})]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);assert.equal(await sql.query(`select count(*) from fmat.host_approvals where request_id='${racing.id}';`),'1');
  await verifyBookingDispatch(db,env,a.id,async()=>{
   const f=await fixture(),agreed=await f.agree();await sql.query(`update fmat.requests set contact_verified_email='guest@example.test' where id='${f.id}';`);
   await approval.approve(a.credential,{requestId:f.id,revision:agreed.revision,proposalVersion:agreed.proposal!.version,confirmed:true,idempotencyKey:randomUUID()});return f.id;
  });
  await verifyBookingWithdrawal(db,env,c.credential,async()=>{
   const f=await fixture(c),agreed=await f.agree();await sql.query(`update fmat.requests set contact_verified_email='guest@example.test' where id='${f.id}';`);
   await approval.approve(c.credential,{requestId:f.id,revision:agreed.revision,proposalVersion:agreed.proposal!.version,confirmed:true,idempotencyKey:randomUUID()});return {id:f.id,guest:f.guest};
  });
  let recoveryDay=3;
  await verifyBookingRecovery(db,env,d.credential,async()=>{
   const f=await fixture(d,recoveryDay++),agreed=await f.agree();await sql.query(`update fmat.requests set contact_verified_email='guest@example.test' where id='${f.id}';`);
   await approval.approve(d.credential,{requestId:f.id,revision:agreed.revision,proposalVersion:agreed.proposal!.version,confirmed:true,idempotencyKey:randomUUID()});return f.id;
  });
  await verifyBookingCompetition(db,env,async()=>{
   const f=await fixture(e,2,true),agreed=await f.agree();await sql.query(`update fmat.requests set contact_verified_email='guest@example.test' where id='${f.id}';`);
   await approval.approve(e.credential,{requestId:f.id,revision:agreed.revision,proposalVersion:agreed.proposal!.version,confirmed:true,idempotencyKey:randomUUID()});return f.id;
  });
  let revalidationDay=3;
  await verifyBookingRevalidation(db,env,f.id,async kind=>{
   const selectedRules={...rules,meetingMode:kind==='travel'?'in_person':'online',travelMode:kind==='travel'?'DRIVE':'NONE'};
   await sql.query(`update fmat.hosts set rules='${JSON.stringify(selectedRules)}',rules_version=rules_version+1 where id='${f.id}';`);
   const request=await fixture(f,revalidationDay++,true,kind),agreed=await request.agree();await sql.query(`update fmat.requests set contact_verified_email='guest@example.test' where id='${request.id}';`);
   await approval.approve(f.credential,{requestId:request.id,revision:agreed.revision,proposalVersion:agreed.proposal!.version,confirmed:true,idempotencyKey:randomUUID()});return request.id;
  });
  await verifyBookingCrashes(env,async()=>{
   const owner=await createHost(),request=await fixture(owner,3,true),agreed=await request.agree();
   await sql.query(`update fmat.requests set contact_verified_email='guest@example.test' where id='${request.id}';`);
   await approval.approve(owner.credential,{requestId:request.id,revision:agreed.revision,proposalVersion:agreed.proposal!.version,confirmed:true,idempotencyKey:randomUUID()});return request.id;
  });
  agent=await bookingAgentProbe(db,env,b.credential);
  let workerDay=3;const workerGuests=new Map<string,Credential>();
  await verifyBookingWorker(db,env,b.id,async()=>{
   const f=await fixture(b,workerDay++),agreed=await f.agree();workerGuests.set(f.id,f.guest);await sql.query(`update fmat.requests set contact_verified_email='guest@example.test' where id='${f.id}';`);
   await agent!.beforeApproval(f.id,f.guest);
   await approval.approve(b.credential,{requestId:f.id,revision:agreed.revision,proposalVersion:agreed.proposal!.version,confirmed:true,idempotencyKey:randomUUID()});await agent!.observe(f.id,false);return f.id;
  },requestId=>verifyBookingReceipt(db,requestId,b.credential,a.credential,workerGuests.get(requestId)!),(requestId,confirmed)=>agent!.observe(requestId,confirmed));
  await verifyBookingDelivery(db,env,b.id);
  const expired=await fixture(),expiredState=await expired.agree();await sql.query(`update fmat.requests set created_at=now()-interval '2 days',expires_at=now()-interval '1 second',contact_verified_email='guest@example.test' where id='${expired.id}';`);
  assert.equal((await approval.read(a.credential,{requestId:expired.id})).blocker,'closed');await assert.rejects(approval.approve(a.credential,{requestId:expired.id,revision:expiredState.revision,proposalVersion:1,confirmed:true,idempotencyKey:randomUUID()}),code('NOT_FOUND'));
  const savedCredential=await sql.query(`select encrypted_credential from fmat.calendar_connections where principal_id='${a.id}';`);
  await sql.query(`update fmat.calendar_connections set revoked_at=now(),encrypted_credential=null where principal_id='${a.id}';`);assert.equal((await approval.read(a.credential,{requestId:changed.id})).blocker,'reconnect_required');await sql.query(`update fmat.calendar_connections set revoked_at=null,encrypted_credential='${savedCredential}' where principal_id='${a.id}';`);
  await sql.query(`update fmat.hosts set revoked_at=now() where id='${a.id}';`);await assert.rejects(approval.approve(a.credential,input),code('HOST_NOT_ADMITTED'));await sql.query(`update fmat.hosts set revoked_at=null where id='${a.id}';`);
  await fetch(local.API_URL+'/auth/v1/logout?scope=global',{method:'POST',headers:{apikey:local.ANON_KEY,authorization:'Bearer '+a.token}});await assert.rejects(approval.approve(a.credential,input),code('UNAUTHORIZED'));
 }finally{
  await agent?.close();sql.close();const cleanup=new LocalSql();
  // Lock fixture jobs before removing their transport records, in the same
  // transaction as job deletion. Recovery uses SKIP LOCKED and cannot republish
  // into the cleanup gap. Replica mode below suppresses FK cascades.
  await cleanup.query('begin;');
  for(const id of requests){
   const jobs=`select j.id from fmat.jobs j where j.payload->>'requestId'='${id}' or j.payload->>'outboxId' in(select id::text from fmat.outbox where payload->>'requestId'='${id}')`;
   await cleanup.query(`select id from fmat.jobs where id in(${jobs}) order by id for update;delete from pgmq.q_fmat_jobs where message->>'jobId' in(select id::text from (${jobs}) fixture_jobs);delete from pgmq.a_fmat_jobs where message->>'jobId' in(select id::text from (${jobs}) fixture_jobs);delete from fmat.queue_publications where job_id in(${jobs});`);
  }
  for(const id of requests){await cleanup.query(`set session_replication_role=replica;delete from fmat.calendar_connections where principal_kind='guest' and principal_id='${id}';delete from fmat.request_closures where request_id='${id}';delete from fmat.booking_deliveries where request_id='${id}';delete from fmat.idempotency where input->>'requestId'='${id}';delete from fmat.jobs where payload->>'outboxId' in(select id::text from fmat.outbox where payload->>'requestId'='${id}');delete from fmat.outbox where payload->>'requestId'='${id}';delete from fmat.booking_dispatches where attempt_id in(select id from fmat.booking_attempts where request_id='${id}');delete from fmat.booking_checks where attempt_id in(select id from fmat.booking_attempts where request_id='${id}');delete from fmat.jobs where payload->>'requestId'='${id}';delete from fmat.web_approval_decisions where request_id='${id}';delete from fmat.host_reservations where attempt_id in(select id from fmat.booking_attempts where request_id='${id}');delete from fmat.booking_attempts where request_id='${id}';delete from fmat.host_approvals where request_id='${id}';delete from fmat.booking_identities where request_id='${id}';delete from fmat.scheduling_decisions where request_id='${id}';delete from fmat.proposal_evidence where request_id='${id}';delete from fmat.proposals where request_id='${id}';delete from fmat.candidate_publications where request_id='${id}';delete from fmat.candidate_rankings where request_id='${id}';delete from fmat.candidate_evaluations where request_id='${id}';delete from fmat.host_revision_drafts where request_id='${id}';delete from fmat.request_history where request_id='${id}';delete from fmat.audit_events where subject_id='${id}';delete from fmat.requests where id='${id}';set session_replication_role=origin;`);}
  await cleanup.query('commit;');
  for(const host of hosts){await cleanup.query(`delete from fmat.audit_events where subject_id in(select id::text from fmat.oauth_exchanges where actor->>'id'='${host.id}');delete from fmat.oauth_exchanges where actor->>'id'='${host.id}';delete from fmat.calendar_connections where principal_id='${host.id}';delete from fmat.hosts where id='${host.id}';delete from fmat.invitations where id='${host.invite}';`);await fetch(local.API_URL+'/auth/v1/admin/users/'+host.id,{method:'DELETE',headers});}cleanup.close();
 }
});
