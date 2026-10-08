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
 const sql=new LocalSql(),recovery=new BookingRecovery(database,env);let reject=true,inserts=0;
 const calendar={async refresh(bundle:import('../../lib/server/calendar/google.ts').TokenBundle){return {...bundle,expiresAt:Date.now()+3600000};},async list(){return [{id:'fixture-calendar',name:'fixture',accessRole:'owner' as const,primary:false,timeZone:'UTC',color:null}];}};
 const worker=new BookingWorker(database,env,new AvailabilityEvaluation(database,env,calendar,{async read(){return [];}}),new GoogleBookingProvider(async(_url,init)=>{
  assert.equal(init?.method,'POST');inserts++;
  if(reject)return Response.json({error:{code:403,errors:[{reason:'forbidden'}]}},{status:403});
  return Response.json({...JSON.parse(String(init.body)),organizer:{email:'recovery@example.test'},status:'confirmed',etag:'recovery-etag',htmlLink:'https://www.google.com/calendar/event?eid=recovery'});
 }),calendar);
 const command=(requestId:string,action:'retry'|'reconcile')=>({project:'local',operator:'recovery-fixture',requestId,action,idempotencyKey:randomUUID()});
 async function lease(requestId:string){
  const jobId=await sql.query(`select id from fmat.jobs where kind='booking' and payload->>'requestId'='${requestId}' and status<>'complete' order by created_at desc,id desc limit 1;`);
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
 }finally{sql.close();}
}
