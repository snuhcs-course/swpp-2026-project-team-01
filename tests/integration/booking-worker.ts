import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Database} from '../../lib/server/database/client.ts';
import {BookingWorker} from '../../lib/server/booking/worker.ts';
import {GoogleBookingProvider} from '../../lib/server/calendar/booking.ts';
import {AvailabilityEvaluation} from '../../lib/server/scheduling/availability.ts';
import {LocalSql} from './local-sql.ts';
import {TokenCipher} from '../../lib/server/calendar/encryption.ts';

export async function verifyBookingWorker(database:Database,env:NodeJS.ProcessEnv,hostId:string,createApproved:()=>Promise<string>,confirmed?:(requestId:string)=>Promise<void>){
 const sql=new LocalSql(),events=new Map<string,unknown>();let inserts=0,gets=0,mode='success',conflict=false,miss=false,activeJob='',refreshes=0;
 const calendar={async refresh(bundle:import('../../lib/server/calendar/google.ts').TokenBundle,kind?:'host'|'guest'){assert.equal(kind,'host');refreshes++;return {...bundle,expiresAt:Date.now()+3600000};},async list(){return [{id:'fixture-calendar',name:'fixture',accessRole:'owner' as const,primary:false,timeZone:'UTC',color:null}];}};
 const provider=new GoogleBookingProvider(async(url,init)=>{
  const path=new URL(String(url));assert.equal(path.origin,'https://www.googleapis.com');
  if(init?.method==='POST'){
   inserts++;assert.equal(path.searchParams.get('sendUpdates'),'all');
   if(mode==='rejected')return Response.json({error:{code:403,errors:[{reason:'forbidden'}]}},{status:403});
   const payload=JSON.parse(String(init.body)),event={...payload,organizer:{email:'selected-calendar@example.test'},status:'confirmed',etag:'fixture-etag',htmlLink:'https://www.google.com/calendar/event?eid=fixture'};events.set(payload.id,event);
   if(mode==='lease_expired')await sql.query(`update fmat.jobs set lease_until=clock_timestamp()-interval '1 second' where id='${activeJob}';`);
   if(mode==='lost_insert')throw new Error('fixture successful insert response lost');
   return Response.json(event);
  }
  gets++;const id=decodeURIComponent(path.pathname.split('/').at(-1)!);
  if(miss||!events.has(id))return Response.json({error:{code:404,errors:[{reason:'notFound'}]}},{status:404});
  return Response.json(mode==='foreign'?{...events.get(id) as object,summary:'Foreign event'}:events.get(id));
 });
 const worker=(db=database)=>new BookingWorker(db,env,new AvailabilityEvaluation(db,env,calendar,{async read(_token,_ids,windows){return conflict?[windows[0]]:[];}}),provider,calendar);
 async function job(requestId:string,kind='booking'){
  const id=await sql.query(`select id from fmat.jobs where kind='${kind}' and payload->>'requestId'='${requestId}' and status<>'complete' order by created_at desc,id desc limit 1;`);assert.ok(id);return id;
 }
 async function own(jobId:string){const lease={workerId:'worker-test-'+randomUUID(),jobId,leaseToken:randomUUID()};activeJob=jobId;await sql.query(`update fmat.jobs set status='running',worker_id='${lease.workerId}',lease_token='${lease.leaseToken}',lease_until=clock_timestamp()+interval '90 seconds' where id='${jobId}';`);return lease;}
 const phase=(r:string)=>sql.query(`select phase from fmat.booking_attempts where request_id='${r}';`);
 const reservation=(r:string)=>sql.query(`select count(*) from fmat.host_reservations where attempt_id in(select id from fmat.booking_attempts where request_id='${r}');`);
 async function confirmations(r:string){assert.equal(await phase(r),'confirmed');assert.equal(await reservation(r),'0');assert.equal(await sql.query(`select status from fmat.requests where id='${r}';`),'booked');assert.equal(await sql.query(`select count(*) from fmat.outbox where payload->>'requestId'='${r}';`),'2');assert.equal(await sql.query(`select count(*) from fmat.jobs where kind='delivery' and payload->>'outboxId' in(select id::text from fmat.outbox where payload->>'requestId'='${r}');`),'2');}
 try{
  // Actual selective claim and insertion through the verified HTTP adapter.
  const first=await createApproved(),firstJob=await job(first);await sql.query(`update fmat.jobs set available_at='2000-01-01' where id='${firstJob}';`);
  assert.deepEqual(await worker().run(),{claimed:1,outcome:'confirmed'});assert.equal(inserts,1);await confirmations(first);if(confirmed)await confirmed(first);
  const duplicate=await sql.query(`select fmat.enqueue_job('booking','worker-duplicate-${randomUUID()}',payload) from fmat.jobs where id='${firstJob}';`);
  assert.equal(await worker().process(await own(duplicate)),'complete');assert.equal(inserts,1);await confirmations(first);
  // Conflicting fresh availability cannot cross the dispatch cutoff.
  const busy=await createApproved();conflict=true;assert.equal(await worker().process(await own(await job(busy))),'blocked');conflict=false;
  assert.equal(await phase(busy),'blocked');assert.equal(await reservation(busy),'0');assert.equal(inserts,1);
  // A definitive provider rejection frees only its original dispatched attempt.
  const rejected=await createApproved();mode='rejected';assert.equal(await worker().process(await own(await job(rejected))),'noncreating');mode='success';assert.equal(await reservation(rejected),'0');assert.equal(await phase(rejected),'noncreating');assert.equal(inserts,2);
  // A committed insert with a lost response is reconciled under the same ID.
  const lost=await createApproved();mode='lost_insert';assert.equal(await worker().process(await own(await job(lost))),'uncertain');assert.equal(await reservation(lost),'1');assert.equal(inserts,3);
  const cipher=new TokenCipher(env),ciphertext=await sql.query(`select encrypted_credential from fmat.calendar_connections where principal_kind='host' and principal_id='${hostId}' and revoked_at is null;`);
  const expiredCipher=cipher.seal({...cipher.open(ciphertext,'google:host:'+hostId) as object,expiresAt:Date.now()-1000},'google:host:'+hostId);
  await sql.query(`update fmat.calendar_connections set encrypted_credential='${expiredCipher}' where principal_kind='host' and principal_id='${hostId}' and revoked_at is null;`);
  miss=true;mode='success';assert.equal(await worker().process(await own(await job(lost,'booking_reconcile'))),'uncertain');assert.equal(await reservation(lost),'1');assert.equal(inserts,3);
  miss=false;assert.equal(await worker().process(await own(await job(lost,'booking_reconcile'))),'confirmed');await confirmations(lost);assert.equal(inserts,3);assert.equal(gets,2);assert.equal(refreshes,1);
  // Lease loss after the provider writes cannot authorize a replacement insert.
  const expired=await createApproved(),expiredJob=await job(expired);mode='lease_expired';const previous=await own(expiredJob);assert.equal(await worker().process(previous),'lease_lost');assert.equal(await phase(expired),'dispatched');assert.equal(await reservation(expired),'1');
  mode='success';assert.equal(await worker().process(await own(expiredJob)),'confirmed');await confirmations(expired);assert.equal(inserts,4);
  // A lost atomic outcome/ack response cannot duplicate confirmation or delivery.
  const ack=await createApproved(),ackJob=await job(ack);let dropAck=true;
  const ackDatabase=new Database(env,async(input,init)=>{const response=await fetch(input,init);const body=JSON.parse(String(init?.body));if(dropAck&&String(input).endsWith('/fmat_booking_worker')&&body.p_operation==='record'&&response.ok){dropAck=false;throw new Error('fixture committed outcome response lost');}return response;});
  await worker(ackDatabase).process(await own(ackJob));assert.equal(dropAck,false);await confirmations(ack);assert.equal(inserts,5);
  // A mismatching event remains an operational conflict until audited lookup.
  const foreign=await createApproved();mode='lost_insert';assert.equal(await worker().process(await own(await job(foreign))),'uncertain');
  mode='foreign';assert.equal(await worker().process(await own(await job(foreign,'booking_reconcile'))),'conflict');assert.equal(await reservation(foreign),'1');
  assert.equal(await sql.query(`select count(*) from fmat.outbox where payload->>'requestId'='${foreign}';`),'0');
  const hostLock=new LocalSql(),operator=new LocalSql(),attemptProbe=new LocalSql(),label='booking-recovery-'+randomUUID();
  let recovery:Promise<string>|undefined;
  try{
   await hostLock.query(`begin;select id from fmat.hosts where id='${hostId}' for update;`);
   await operator.query(`set application_name='${label}';`);
   recovery=operator.query(`select public.fmat_command('booking_reconcile','{"kind":"operator","id":"booking-worker-fixture"}','${JSON.stringify({requestId:foreign,idempotencyKey:randomUUID()})}');`);
   let waiting=false;
   for(let i=0;i<100;i++){if(await sql.query(`select count(*) from pg_stat_activity where application_name='${label}' and wait_event_type='Lock';`)==='1'){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
   assert.equal(waiting,true,'Operator waits for host before locking an attempt');
   await attemptProbe.query(`begin;select id from fmat.booking_attempts where request_id='${foreign}' for update nowait;rollback;`);
  }finally{await hostLock.query('rollback;');if(recovery)await recovery;hostLock.close();operator.close();attemptProbe.close();}
  mode='success';assert.equal(await worker().process(await own(await job(foreign,'booking_reconcile'))),'confirmed');await confirmations(foreign);assert.equal(inserts,6);
  // Lost dispatch acknowledgment means lookup only, even when no insert ran.
  const cutoff=await createApproved(),cutoffJob=await job(cutoff);let dropDispatch=true;
  const cutoffDatabase=new Database(env,async(input,init)=>{const response=await fetch(input,init);if(dropDispatch&&String(input).endsWith('/fmat_booking_dispatch')&&response.ok){dropDispatch=false;throw new Error('fixture committed dispatch response lost');}return response;});
  assert.equal(await worker(cutoffDatabase).process(await own(cutoffJob)),'retry');assert.equal(await phase(cutoff),'dispatched');assert.equal(inserts,6);
  const recovered=await own(cutoffJob);
  await assert.rejects(database.rpc('fmat_booking_worker',{p_operation:'record',p_lease:recovered,p_input:{outcome:'noncreating',reason:'permission_denied'}}));
  assert.equal(await worker().process(recovered),'uncertain');assert.equal(inserts,6);assert.equal(await reservation(cutoff),'1');
  // Keep that unresolved reservation: a second request must wait, not steal it.
  const waiting=await createApproved();assert.equal(await worker().process(await own(await job(waiting))),'retry');assert.equal(await phase(waiting),'prepared');assert.equal(await reservation(waiting),'0');assert.equal(inserts,6);
  assert.equal(await sql.query(`select has_function_privilege('anon','public.fmat_booking_worker(text,jsonb,jsonb)','EXECUTE')||','||has_function_privilege('authenticated','public.fmat_booking_worker(text,jsonb,jsonb)','EXECUTE')||','||has_function_privilege('service_role','fmat.wake_booking_worker()','EXECUTE');`),'false,false,false');
 }finally{sql.close();}
}
