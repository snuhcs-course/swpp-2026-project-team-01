import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {AvailabilityEvaluation} from '../../lib/server/scheduling/availability.ts';
import {BookingDispatch} from '../../lib/server/booking/dispatch.ts';
import type {Database} from '../../lib/server/database/client.ts';
import {LocalSql} from './local-sql.ts';

export async function verifyBookingDispatch(database:Database,env:NodeJS.ProcessEnv,hostId:string,createApproved:()=>Promise<string>){
 const sql=new LocalSql(),dispatch=new BookingDispatch(database),workerId='dispatch-'+randomUUID();
 try{
  const requestId=await createApproved(),otherId=await createApproved();
  async function prepare(id:string){
   const saved=JSON.parse(await sql.query(`select json_build_object('jobId',j.id,'attemptId',a.id,'revision',r.revision,'calendarId',a.calendar_id,'connectionId',a.connection_id,'connectionUpdatedAt',c.updated_at,'providerSubject',a.connection_provider_subject,'rulesVersion',a.rules_version,'candidate',json_build_object('start',a.payload->'start'->>'dateTime','end',a.payload->'end'->>'dateTime')) from fmat.jobs j join fmat.booking_attempts a on a.id=(j.payload->>'attemptId')::uuid join fmat.requests r on r.id=a.request_id join fmat.calendar_connections c on c.id=a.connection_id where j.kind='booking' and r.id='${id}';`));
   const lease={workerId,jobId:saved.jobId,leaseToken:randomUUID()};
   await sql.query(`update fmat.jobs set status='running',worker_id='${workerId}',lease_token='${lease.leaseToken}',lease_until=clock_timestamp()+interval '90 seconds' where id='${saved.jobId}';`);
   return {saved,lease,target:{requestId:id,revision:saved.revision,candidate:saved.candidate}};
  }
  const a=await prepare(requestId),b=await prepare(otherId);
  const evaluator=new AvailabilityEvaluation(database,env,{async refresh(bundle){return bundle;},async list(){return [{id:a.saved.calendarId,name:'fixture',accessRole:'owner',primary:false,timeZone:'UTC',color:null}];}},{async read(){return [];}});
  const checked=await evaluator.readForBooking(a.lease,a.target);
  const input={requestId,revision:a.target.revision,checkId:checked.context.checkId,basis:checked.context.basis,evaluationId:checked.persisted!.evaluationId};
  await assert.rejects(evaluator.readForBooking(b.lease,b.target));
  for(const wrong of [{...input,evaluationId:randomUUID()},{...input,checkId:randomUUID()},{...input,revision:input.revision+1},{...input,basis:'f'.repeat(64)},{...input,feasibility:{valid:true}}])await assert.rejects(dispatch.dispatch(a.lease,wrong));
  await assert.rejects(dispatch.dispatch({...a.lease,leaseToken:randomUUID()},input));await assert.rejects(dispatch.dispatch(b.lease,input));
  const legacy={jobId:a.lease.jobId,leaseToken:a.lease.leaseToken,attemptId:a.saved.attemptId,expectedRevision:a.saved.revision,rulesVersion:a.saved.rulesVersion,connectionId:a.saved.connectionId,connectionUpdatedAt:a.saved.connectionUpdatedAt,providerSubject:a.saved.providerSubject,feasibility:{valid:true,checkedAt:new Date().toISOString()}};
  await sql.query(`do $$begin perform public.fmat_command('booking_dispatch','${JSON.stringify({kind:'worker',id:workerId})}','${JSON.stringify(legacy)}');raise exception 'LEGACY_DISPATCH_ACCEPTED';exception when raise_exception then if sqlerrm<>'FEASIBILITY_STALE' then raise;end if;end$$;`);
  await sql.query(`update fmat.requests set requester_agreed_version=null where id='${requestId}';`);await assert.rejects(dispatch.dispatch(a.lease,input));await sql.query(`update fmat.requests set requester_agreed_version=current_proposal_version where id='${requestId}';`);
  await sql.query(`update fmat.hosts set rules_version=rules_version+1 where id='${hostId}';`);await assert.rejects(dispatch.dispatch(a.lease,input));await sql.query(`update fmat.hosts set rules_version=rules_version-1 where id='${hostId}';`);
  const originalEmail=await sql.query(`select email from fmat.hosts where id='${hostId}';`);await sql.query(`update fmat.hosts set email='changed@example.test' where id='${hostId}';`);await assert.rejects(dispatch.dispatch(a.lease,input));await sql.query(`update fmat.hosts set email='${originalEmail}' where id='${hostId}';`);
  await sql.query(`update fmat.requests set token_revoked_at=clock_timestamp() where id='${requestId}';`);await assert.rejects(dispatch.dispatch(a.lease,input));await sql.query(`update fmat.requests set token_revoked_at=null where id='${requestId}';`);
  await sql.query(`update fmat.booking_checks set destination_checked_at=clock_timestamp()-interval '31 seconds' where attempt_id='${a.saved.attemptId}';`);await assert.rejects(dispatch.dispatch(a.lease,input));
  await sql.query(`update fmat.booking_checks set destination_checked_at=clock_timestamp() where attempt_id='${a.saved.attemptId}';`);
  assert.equal(await sql.query(`select count(*) from fmat.booking_dispatches where attempt_id='${a.saved.attemptId}';`),'0');
  // Age actual evidence without bypassing its immutable-row trigger.
  await delay(Math.max(0,31_000-(Date.now()-Date.parse(checked.receipt.checkedAt))));
  await sql.query(`update fmat.booking_checks set destination_checked_at=clock_timestamp() where attempt_id='${a.saved.attemptId}';`);
  await assert.rejects(dispatch.dispatch(a.lease,input));
  const fresh=await evaluator.readForBooking(a.lease,a.target),current={...input,checkId:fresh.context.checkId,basis:fresh.context.basis,evaluationId:fresh.persisted!.evaluationId};
  await assert.rejects(dispatch.dispatch(a.lease,input));
  const results=await Promise.all(Array.from({length:8},()=>dispatch.dispatch(a.lease,current)));
  assert.equal(results.filter(x=>x.dispatched).length,1);const positive=results.find(x=>x.dispatched)!;assert.ok(positive.dispatched);
  assert.equal(positive.snapshot.requestId,requestId);assert.equal(positive.snapshot.attemptId,a.saved.attemptId);assert.equal(positive.snapshot.calendarId,a.saved.calendarId);
  assert.deepEqual(await dispatch.dispatch(a.lease,current),{dispatched:false});
  assert.equal(await sql.query(`select count(*) from fmat.booking_dispatches where attempt_id='${a.saved.attemptId}' and evaluation_id='${fresh.persisted!.evaluationId}';`),'1');
  assert.equal(await sql.query(`select phase from fmat.booking_attempts where id='${a.saved.attemptId}';`),'dispatched');
  assert.equal(await sql.query(`select count(*) from fmat.host_reservations where attempt_id='${a.saved.attemptId}';`),'1');
  await assert.rejects(evaluator.readForBooking(b.lease,b.target));
  const next={...a.lease,leaseToken:randomUUID()};await sql.query(`update fmat.jobs set lease_token='${next.leaseToken}' where id='${a.lease.jobId}';`);
  await assert.rejects(dispatch.dispatch(a.lease,current));assert.deepEqual(await dispatch.dispatch(next,current),{dispatched:false});
  await sql.query(`do $$begin update fmat.booking_dispatches set evaluation_id=gen_random_uuid() where attempt_id='${a.saved.attemptId}';raise exception 'MUTABLE_DISPATCH';exception when raise_exception then if sqlerrm<>'IMMUTABLE_EVALUATION' then raise;end if;end$$;`);
  assert.equal(await sql.query(`select has_function_privilege('anon','public.fmat_booking_dispatch(jsonb,jsonb)','EXECUTE')||','||has_function_privilege('authenticated','public.fmat_booking_dispatch(jsonb,jsonb)','EXECUTE')||','||has_table_privilege('service_role','fmat.booking_dispatches','SELECT');`),'false,false,false');
 }finally{sql.close();}
}
