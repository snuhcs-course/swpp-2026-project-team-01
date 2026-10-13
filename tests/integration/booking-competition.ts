import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Database} from '../../lib/server/database/client.ts';
import {BookingWorker} from '../../lib/server/booking/worker.ts';
import {GoogleBookingProvider} from '../../lib/server/calendar/booking.ts';
import {AvailabilityEvaluation} from '../../lib/server/scheduling/availability.ts';
import {LocalSql} from './local-sql.ts';

export async function verifyBookingCompetition(database:Database,env:NodeJS.ProcessEnv,createApproved:()=>Promise<string>){
 const sql=new LocalSql();let inserts=0,release!:()=>void,arrived!:()=>void;
 const inserted=new Promise<void>(resolve=>{arrived=resolve;}),response=new Promise<void>(resolve=>{release=resolve;});
 const calendar={async refresh(bundle:import('../../lib/server/calendar/google.ts').TokenBundle){return bundle;},async list(){return [{id:'fixture-calendar',name:'fixture',accessRole:'owner' as const,primary:false,timeZone:'UTC',color:null}];}};
 const worker=new BookingWorker(database,env,new AvailabilityEvaluation(database,env,calendar,{async read(){return [];}}),new GoogleBookingProvider(async(_url,init)=>{
  assert.equal(init?.method,'POST');inserts++;arrived();await response;
  return Response.json({...JSON.parse(String(init.body)),organizer:{email:'competition@example.test'},status:'confirmed',etag:'competition-etag'});
 }),calendar);
 async function own(requestId:string){
  const jobId=await sql.query(`select id from fmat.jobs where kind='booking' and payload->>'requestId'='${requestId}';`),lease={workerId:'competition-'+randomUUID(),jobId,leaseToken:randomUUID()};
  await sql.query(`update fmat.jobs set status='running',worker_id='${lease.workerId}',lease_token='${lease.leaseToken}',lease_until=clock_timestamp()+interval '90 seconds' where id='${jobId}';`);return lease;
 }
 let first:Promise<unknown>|undefined;
 try{
  const a=await createApproved(),b=await createApproved();
  assert.equal(await sql.query(`select a.host_id=b.host_id and a.starts_at=b.starts_at and a.ends_at=b.ends_at from fmat.booking_attempts a,fmat.booking_attempts b where a.request_id='${a}' and b.request_id='${b}';`),'t');
  assert.equal(await sql.query(`select count(distinct event_id)=2 and bool_and(length(event_id) between 5 and 1024 and event_id ~ '^[0-9a-v]+$') from fmat.booking_identities where request_id in('${a}','${b}');`),'t');
  first=worker.process(await own(a));
  // Fail promptly if dispatch never reaches the provider, without leaving a
  // blocked transport behind when another assertion fails.
  await Promise.race([inserted,first.then(outcome=>{throw new Error('First worker ended before dispatch: '+outcome);})]);
  assert.equal(await worker.process(await own(b)),'retry');assert.equal(inserts,1);
  assert.equal(await sql.query(`select r.attempt_id=a.id from fmat.host_reservations r join fmat.booking_attempts a on a.host_id=r.host_id where a.request_id='${a}';`),'t');
  assert.equal(await sql.query(`select phase from fmat.booking_attempts where request_id='${b}';`),'prepared');
  release();assert.equal(await first,'confirmed');
  // Even an empty provider read cannot hide the application's confirmed write.
  assert.equal(await worker.process(await own(b)),'blocked');assert.equal(inserts,1);
  assert.equal(await sql.query(`select count(*) from fmat.booking_attempts where request_id in('${a}','${b}') and phase='confirmed';`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.outbox where payload->>'requestId'='${b}';`),'0');
 }finally{release();await first;sql.close();}
}
