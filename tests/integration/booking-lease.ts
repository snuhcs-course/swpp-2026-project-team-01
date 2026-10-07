import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalSql} from './local-sql.ts';

// Exercise real PostgreSQL lock waits, not a mocked clock or a source assertion.
export async function verifyBookingLeaseCutoffs(requestId:string,hostId:string) {
 const control=new LocalSql(),holder=new LocalSql(),worker=new LocalSql();
 const owner='lease-'+randomUUID(),token=randomUUID(),application='lease-wait-'+randomUUID();
 const actor=JSON.stringify({kind:'worker',id:owner});
 try {
  const job=JSON.parse(await control.query(`select json_build_object('id',id,'attemptId',payload->>'attemptId') from fmat.jobs where kind='booking' and payload->>'requestId'='${requestId}';`));
  const saved=JSON.parse(await control.query(`select json_build_object('revision',r.revision,'rulesVersion',a.rules_version,'connectionId',a.connection_id,'providerSubject',a.connection_provider_subject,'connectionUpdatedAt',c.updated_at) from fmat.requests r join fmat.booking_attempts a on a.request_id=r.id join fmat.calendar_connections c on c.id=a.connection_id where r.id='${requestId}';`));
  await worker.query(`set application_name='${application}';`);
  async function lease(){await control.query(`update fmat.jobs set status='running',worker_id='${owner}',lease_token='${token}',lease_until=clock_timestamp()+interval '2 seconds' where id='${job.id}';`);}
  async function until(sql:string){const deadline=Date.now()+6000;while(await control.query(sql)!=='t'){assert.ok(Date.now()<deadline,'Expected database lock/expiry was not observed');await delay(20);}}
  async function expiresWhileLocked(operation:string,lock:string,input:Record<string,unknown>,foundation=false){
   await lease();await holder.query(`begin;${lock}`);
   const payload=JSON.stringify({jobId:job.id,leaseToken:token,requestId,attemptId:job.attemptId,...input});
   const pending=worker.query(`do $$begin perform fmat.${foundation?'foundation_command':'booking_command'}('${operation}','${actor}','${payload}');raise exception 'EXPIRED_WORKER_ACCEPTED';exception when raise_exception then if sqlerrm<>'LEASE_LOST' then raise;end if;end$$;`);
   // Attach a handler now so an early failure cannot become an unhandled rejection.
   const result=pending.then(()=>({ok:true as const}),error=>({ok:false as const,error}));
   await until(`select exists(select 1 from pg_stat_activity where application_name='${application}' and wait_event_type='Lock');`);
   await until(`select lease_until<=clock_timestamp() from fmat.jobs where id='${job.id}';`);
   await holder.query('commit;');
   const outcome=await result;if(!outcome.ok)throw outcome.error;
   assert.equal(await control.query(`select phase from fmat.booking_attempts where id='${job.attemptId}';`),'prepared');
   assert.equal(await control.query(`select status from fmat.jobs where id='${job.id}';`),'running');
  }
  await expiresWhileLocked('booking_load',`select id from fmat.requests where id='${requestId}' for update;`,{});
  assert.equal(await control.query(`select count(*) from fmat.host_reservations where attempt_id='${job.attemptId}';`),'0');
  await lease();await worker.query(`select fmat.booking_command('booking_load','${actor}','${JSON.stringify({jobId:job.id,leaseToken:token,requestId})}');`);
  await expiresWhileLocked('booking_dispatch',`select id from fmat.hosts where id='${hostId}' for update;`,{expectedRevision:saved.revision,rulesVersion:saved.rulesVersion,connectionId:saved.connectionId,connectionUpdatedAt:saved.connectionUpdatedAt,providerSubject:saved.providerSubject,feasibility:{valid:true,checkedAt:new Date().toISOString()}});
  await expiresWhileLocked('booking_record_outcome',`select id from fmat.requests where id='${requestId}' for update;`,{outcome:'blocked',reason:'fixture'});
  for(const operation of ['jobs_complete','jobs_fail'])await expiresWhileLocked(operation,`select id from fmat.jobs where id='${job.id}' for update;`,{result:{ok:true},errorCode:'fixture'},true);
  assert.equal(await control.query(`select count(*) from fmat.host_reservations where attempt_id='${job.attemptId}';`),'1');
  assert.equal(await control.query(`select status from fmat.requests where id='${requestId}';`),'booking');
  // A lease that expires inside one transaction must not inherit transaction-start time.
  await lease();await worker.query('begin;');
  await until(`select lease_until<=clock_timestamp() from fmat.jobs where id='${job.id}';`);
  await worker.query(`do $$begin perform fmat.require_job_lease('${actor}','${job.id}','${token}');raise exception 'EXPIRED_WORKER_ACCEPTED';exception when raise_exception then if sqlerrm<>'LEASE_LOST' then raise;end if;end$$;commit;`);
 } finally {
  await holder.query('rollback;').catch(()=>{});await worker.query('rollback;').catch(()=>{});
  holder.close();worker.close();control.close();
 }
}
