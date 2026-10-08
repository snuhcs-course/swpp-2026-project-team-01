import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Database} from '../../lib/server/database/client.ts';
import {BookingRecovery} from '../../lib/server/booking/recovery.ts';
import {BookingWorker} from '../../lib/server/booking/worker.ts';
import {GoogleBookingProvider} from '../../lib/server/calendar/booking.ts';
import {AvailabilityEvaluation} from '../../lib/server/scheduling/availability.ts';
import {LocalSql} from './local-sql.ts';

export async function verifyBookingRecovery(database:Database,env:NodeJS.ProcessEnv,createApproved:()=>Promise<string>){
 const sql=new LocalSql(),recovery=new BookingRecovery(database,env);let reject=true,inserts=0,loseResponse=false,miss=false,gets=0;const events=new Map<string,unknown>();
 const calendar={async refresh(bundle:import('../../lib/server/calendar/google.ts').TokenBundle){return {...bundle,expiresAt:Date.now()+3600000};},async list(){return [{id:'fixture-calendar',name:'fixture',accessRole:'owner' as const,primary:false,timeZone:'UTC',color:null}];}};
 const worker=new BookingWorker(database,env,new AvailabilityEvaluation(database,env,calendar,{async read(){return [];}}),new GoogleBookingProvider(async(url,init)=>{
  if(init?.method==='GET'){
   gets++;const id=decodeURIComponent(new URL(String(url)).pathname.split('/').at(-1)!);
   return miss||!events.has(id)?Response.json({error:{code:404,errors:[{reason:'notFound'}]}},{status:404}):Response.json(events.get(id));
  }
  assert.equal(init?.method,'POST');inserts++;
  if(reject)return Response.json({error:{code:403,errors:[{reason:'forbidden'}]}},{status:403});
  const payload=JSON.parse(String(init.body)),event={...payload,organizer:{email:'recovery@example.test'},status:'confirmed',etag:'recovery-etag',htmlLink:'https://www.google.com/calendar/event?eid=recovery'};
  events.set(payload.id,event);if(loseResponse)throw new Error('successful provider response lost');
  return Response.json(event);
 }),calendar);
 const command=(requestId:string,action:'retry'|'reconcile')=>({project:'local',operator:'recovery-fixture',requestId,action,idempotencyKey:randomUUID()});
 async function lease(requestId:string,kind='booking',dedupeKey?:string){
  const jobId=await sql.query(`select id from fmat.jobs where kind='${kind}' and payload->>'requestId'='${requestId}' and status<>'complete' ${dedupeKey?`and dedupe_key='${dedupeKey}'`:''} order by created_at desc,id desc limit 1;`);
  const value={workerId:'recovery-test',jobId,leaseToken:randomUUID()};assert.ok(jobId);
  await sql.query(`update fmat.jobs set status='running',worker_id='${value.workerId}',lease_token='${value.leaseToken}',lease_until=clock_timestamp()+interval '90 seconds' where id='${jobId}';`);return value;
 }
 try{
  const r=await createApproved(),identity=await sql.query(`select event_id from fmat.booking_identities where request_id='${r}';`);
  // A live or pending original job cannot be replaced by an operator.
  await assert.rejects(recovery.run(command(r,'retry')));
  assert.equal(await worker.process(await lease(r)),'noncreating');assert.equal(inserts,1);
  const retry=command(r,'retry');let dropped=false;
  const lost=new BookingRecovery(new Database(env,async(url,init)=>{const response=await fetch(url,init);if(response.ok&&!dropped){dropped=true;throw new Error('committed recovery response lost');}return response;}),env);
  await assert.rejects(lost.run(retry));assert.equal(dropped,true);
  await recovery.run(retry);await recovery.run(retry);
  const replay=JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/booking-recovery.ts','--project','local','--operator',retry.operator,'--request',r,'--action','retry','--key',retry.idempotencyKey],{env:{...process.env,...env},encoding:'utf8'}));
  assert.equal(replay.ok,true);assert.equal(replay.idempotencyKey,retry.idempotencyKey);
  assert.equal(await sql.query(`select count(*) from fmat.booking_attempts where request_id='${r}';`),'2');
  assert.equal(await sql.query(`select count(distinct event_id) from fmat.booking_attempts where request_id='${r}';`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.audit_events where subject_id='${r}' and operation='booking_retry';`),'1');
  reject=false;assert.equal(await worker.process(await lease(r)),'confirmed');assert.equal(inserts,2);
  assert.equal(await sql.query(`select event->>'id' from fmat.requests where id='${r}';`),identity);
  // Recovery of a completed request cannot enqueue replacement work.
  await assert.rejects(recovery.run(command(r,'retry')));await assert.rejects(recovery.run(command(r,'reconcile')));
  // Changed decisions after rejection cannot be resurrected by operator retry.
  const stale=await createApproved();reject=true;assert.equal(await worker.process(await lease(stale)),'noncreating');
  await sql.query(`update fmat.requests set requester_agreed_version=null where id='${stale}';`);
  await assert.rejects(recovery.run(command(stale,'retry')));
  assert.equal(await sql.query(`select count(*) from fmat.booking_attempts where request_id='${stale}';`),'1');
  // Exercise the operator CLI after a real worker dispatch whose provider
  // response is lost. No attempt, reservation or booked state is forced.
  const uncertain=await createApproved();reject=false;loseResponse=true;
  const before=inserts;assert.equal(await worker.process(await lease(uncertain)),'uncertain');
  const attempt=await sql.query(`select id from fmat.booking_attempts where request_id='${uncertain}';`);
  const eventId=await sql.query(`select event_id from fmat.booking_identities where request_id='${uncertain}';`);
  const frozen=await sql.query(`select payload::text from fmat.booking_attempts where id='${attempt}';`);
  await assert.rejects(recovery.run(command(uncertain,'retry')));
  const reconcile=command(uncertain,'reconcile'),dedupe=`operator-reconcile:${attempt}:${reconcile.idempotencyKey}`;
  const runCli=()=>JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/booking-recovery.ts','--project','local','--operator',reconcile.operator,'--request',uncertain,'--action','reconcile','--key',reconcile.idempotencyKey],{env:{...process.env,...env},encoding:'utf8'}));
  for(let i=0;i<2;i++){const result=runCli();assert.equal(result.ok,true);assert.equal('booked' in result,false);}
  assert.equal(await sql.query(`select count(*) from fmat.jobs where dedupe_key='${dedupe}';`),'1');
  miss=true;assert.equal(await worker.process(await lease(uncertain,'booking_reconcile',dedupe)),'uncertain');
  assert.equal(await sql.query(`select count(*) from fmat.host_reservations where attempt_id='${attempt}';`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.outbox where payload->>'requestId'='${uncertain}';`),'0');
  await assert.rejects(recovery.run(command(uncertain,'retry')));
  miss=false;assert.equal(await worker.process(await lease(uncertain,'booking_reconcile')),'confirmed');
  assert.equal(inserts,before+1);assert.equal(gets,2);
  assert.equal(await sql.query(`select event->>'id' from fmat.requests where id='${uncertain}';`),eventId);
  assert.equal(await sql.query(`select payload::text from fmat.booking_attempts where id='${attempt}';`),frozen);
  assert.equal(await sql.query(`select count(*) from fmat.booking_attempts where request_id='${uncertain}';`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.host_reservations where attempt_id='${attempt}';`),'0');
  assert.equal(await sql.query(`select count(*) from fmat.outbox where payload->>'requestId'='${uncertain}';`),'2');
  assert.equal(await sql.query(`select count(*) from fmat.audit_events where subject_id='${uncertain}' and operation='booking_reconcile';`),'1');
 }finally{sql.close();}
}
