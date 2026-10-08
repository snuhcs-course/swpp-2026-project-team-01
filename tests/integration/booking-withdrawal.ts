import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {AvailabilityEvaluation} from '../../lib/server/scheduling/availability.ts';
import {RequestLifecycle} from '../../lib/server/scheduling/lifecycle.ts';
import {BookingDispatch} from '../../lib/server/booking/dispatch.ts';
import {BookingWorker} from '../../lib/server/booking/worker.ts';
import {GoogleBookingProvider} from '../../lib/server/calendar/booking.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import type {Credential} from '../../lib/server/identity/credentials.ts';
import type {Database} from '../../lib/server/database/client.ts';
import {LocalSql} from './local-sql.ts';

export async function verifyBookingWithdrawal(database:Database,env:NodeJS.ProcessEnv,host:Credential,createApproved:()=>Promise<{id:string;guest:Credential}>){
 const sql=new LocalSql(),control=new LocalSql(),lifecycle=new RequestLifecycle(database),dispatch=new BookingDispatch(database);
 let providerWrites=0;
 const provider=new GoogleBookingProvider(async()=>{providerWrites++;throw new Error('Closed request must never reach Calendar');});
 const calendar={async refresh(bundle:import('../../lib/server/calendar/google.ts').TokenBundle){return bundle;},async list(){return [{id:'fixture-calendar',name:'fixture',accessRole:'owner' as const,primary:false,timeZone:'UTC',color:null}];}};
 const evaluator=new AvailabilityEvaluation(database,env,calendar,{async read(){return [];}}),worker=new BookingWorker(database,env,evaluator,provider,calendar);
 async function prepare(){
  const request=await createApproved();
  const saved=JSON.parse(await sql.query(`select json_build_object('jobId',j.id,'attemptId',a.id,'revision',r.revision,'eventId',a.event_id,'candidate',json_build_object('start',a.payload->'start'->>'dateTime','end',a.payload->'end'->>'dateTime')) from fmat.jobs j join fmat.booking_attempts a on a.id=(j.payload->>'attemptId')::uuid join fmat.requests r on r.id=a.request_id where j.kind='booking' and r.id='${request.id}';`));
  const lease={workerId:'withdrawal-fixture-'+randomUUID(),jobId:saved.jobId,leaseToken:randomUUID()};
  await sql.query(`update fmat.jobs set status='running',worker_id='${lease.workerId}',lease_token='${lease.leaseToken}',lease_until=clock_timestamp()+interval '90 seconds' where id='${lease.jobId}';`);
  const target={requestId:request.id,revision:saved.revision,candidate:saved.candidate};
  return {request,saved,lease,target,closure:{requestId:request.id,revision:saved.revision,confirmed:true as const,idempotencyKey:randomUUID()}};
 }
 const input=(f:Awaited<ReturnType<typeof prepare>>,checked:Awaited<ReturnType<AvailabilityEvaluation['readForBooking']>>)=>({requestId:f.request.id,revision:f.saved.revision,checkId:checked.context.checkId,basis:checked.context.basis,evaluationId:checked.persisted!.evaluationId});
 async function waitBlocked(pid:string){for(let n=0;n<100;n++){if(await sql.query(`select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid)));`)==='t')return;await delay(10);}throw new Error('Expected operation did not wait on request lock');}
 async function closed(f:Awaited<ReturnType<typeof prepare>>,status:string){
  assert.equal(await sql.query(`select status from fmat.requests where id='${f.request.id}';`),status);
  assert.equal(await sql.query(`select phase from fmat.booking_attempts where id='${f.saved.attemptId}';`),'blocked');
  assert.equal(await sql.query(`select count(*) from fmat.host_reservations where attempt_id='${f.saved.attemptId}';`),'0');
  assert.equal(await sql.query(`select count(*) from fmat.booking_dispatches where attempt_id='${f.saved.attemptId}';`),'0');
  assert.equal(await worker.process(f.lease),'complete');assert.equal(providerWrites,0);
 }
 try{
  // Worker owns its job and waits for the request; closure must not wait on that job.
  const first=await prepare(),checked=await evaluator.readForBooking(first.lease,first.target),target=input(first,checked);
  assert.equal((await lifecycle.read(first.request.guest,{requestId:first.request.id})).canWithdraw,true);
  await control.query(`begin;select id from fmat.requests where id='${first.request.id}' for update;`);
  const pid=await control.query('select pg_backend_pid();'),waiting=dispatch.dispatch(first.lease,target);
  await waitBlocked(pid);
  const result=JSON.parse(await control.query(`select public.fmat_request_lifecycle('withdraw','${JSON.stringify(first.request.guest)}','${JSON.stringify(first.closure)}');`));assert.equal(result.status,'withdrawn');
  await control.query('commit;');assert.deepEqual(await waiting,{dispatched:false});await closed(first,'withdrawn');
  assert.equal((await lifecycle.withdraw(first.request.guest,first.closure)).revision,first.saved.revision+1);
  // Host decline uses the same undispatched cutoff and retires its reservation.
  const declined=await prepare();await evaluator.readForBooking(declined.lease,declined.target);
  assert.equal((await lifecycle.decline(host,declined.closure)).status,'declined');await closed(declined,'declined');
  // Withdrawal while provider reads are in flight prevents saving dispatch evidence.
  const reading=await prepare();let withdrew=false;
  const interrupted=new AvailabilityEvaluation(database,env,calendar,{async read(){if(!withdrew){withdrew=true;await lifecycle.withdraw(reading.request.guest,reading.closure);}return [];}});
  await assert.rejects(interrupted.readForBooking(reading.lease,reading.target));assert.equal(withdrew,true);await closed(reading,'withdrawn');
  // Once dispatch commits, a waiting closure cannot claim that it prevented the write.
  const last=await prepare(),lastCheck=await evaluator.readForBooking(last.lease,last.target),lastInput=input(last,lastCheck);
  await control.query(`begin;select id from fmat.requests where id='${last.request.id}' for update;`);
  const rejected=assert.rejects(lifecycle.withdraw(last.request.guest,last.closure),(e:unknown)=>e instanceof ApplicationError&&e.code==='RECONCILIATION_PENDING');
  await waitBlocked(pid);
  const positive=JSON.parse(await control.query(`select public.fmat_booking_dispatch('${JSON.stringify(last.lease)}','${JSON.stringify(lastInput)}');`));assert.equal(positive.dispatched,true);
  await control.query('commit;');await rejected;
  assert.equal((await lifecycle.read(last.request.guest,{requestId:last.request.id})).canWithdraw,false);
  assert.equal(await sql.query(`select phase||':'||event_id from fmat.booking_attempts where id='${last.saved.attemptId}';`),'dispatched:'+last.saved.eventId);
  assert.equal(await sql.query(`select count(*) from fmat.host_reservations where attempt_id='${last.saved.attemptId}';`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.request_closures where request_id='${last.request.id}';`),'0');assert.equal(providerWrites,0);
 }finally{await control.query('rollback;').catch(()=>{});control.close();sql.close();}
}
