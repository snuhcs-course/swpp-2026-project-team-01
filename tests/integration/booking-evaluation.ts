import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AvailabilityEvaluation} from '../../lib/server/scheduling/availability.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import type {Database} from '../../lib/server/database/client.ts';
import {LocalSql} from './local-sql.ts';

export async function verifyBookingEvaluation(database:Database,env:NodeJS.ProcessEnv,requestId:string,hostId:string){
 const sql=new LocalSql(),workerId='evaluation-'+randomUUID();let leaseToken=randomUUID(),reads=0,lists=0,conflict=false,writable=true;let onRead:(()=>Promise<void>)|undefined;
 try{
  const saved=JSON.parse(await sql.query(`select json_build_object('jobId',j.id,'attemptId',a.id,'revision',r.revision,'calendarId',a.calendar_id,'candidate',json_build_object('start',a.payload->'start'->>'dateTime','end',a.payload->'end'->>'dateTime')) from fmat.jobs j join fmat.booking_attempts a on a.id=(j.payload->>'attemptId')::uuid join fmat.requests r on r.id=a.request_id where j.kind='booking' and r.id='${requestId}';`));
  const target={requestId,revision:saved.revision,candidate:saved.candidate};
  const lease=()=>({workerId,jobId:saved.jobId,leaseToken});
  const renew=()=>sql.query(`update fmat.jobs set status='running',worker_id='${workerId}',lease_token='${leaseToken}',lease_until=clock_timestamp()+interval '90 seconds' where id='${saved.jobId}';`);
  const evaluation=new AvailabilityEvaluation(database,env,{async refresh(bundle){return bundle;},async list(){lists++;return [{id:saved.calendarId,name:'fixture',accessRole:writable?'owner':'reader',primary:false,timeZone:'UTC',color:null}];}},{async read(){reads++;await onRead?.();return conflict?[saved.candidate]:[];}});
  await renew();
  for(const invalid of [{...lease(),workerId:'other'},{...lease(),leaseToken:randomUUID()},{...lease(),jobId:randomUUID()}])await assert.rejects(evaluation.readForBooking(invalid,target));
  await assert.rejects(evaluation.readForBooking(lease(),{...target,requestId:randomUUID()}));
  await assert.rejects(evaluation.readForBooking(lease(),{...target,revision:target.revision+1}));
  await assert.rejects(evaluation.readForBooking(lease(),{...target,candidate:{...saved.candidate,end:new Date(Date.parse(saved.candidate.end)+60000).toISOString()}}));
  assert.equal(reads,0);assert.equal(lists,0);
  await sql.query(`update fmat.hosts set rules_version=rules_version+1 where id='${hostId}';`);await assert.rejects(evaluation.readForBooking(lease(),target));await sql.query(`update fmat.hosts set rules_version=rules_version-1 where id='${hostId}';`);
  await sql.query(`update fmat.hosts set booking_calendar_id='wrong-destination' where id='${hostId}';`);await assert.rejects(evaluation.readForBooking(lease(),target));await sql.query(`update fmat.hosts set booking_calendar_id='${saved.calendarId}' where id='${hostId}';`);
  await sql.query(`update fmat.requests set token_revoked_at=clock_timestamp() where id='${requestId}';`);await assert.rejects(evaluation.readForBooking(lease(),target));await sql.query(`update fmat.requests set token_revoked_at=null where id='${requestId}';`);
  // Saved approval is durable; an expired browser session is not worker authority.
  assert.equal(await sql.query(`select count(*) from auth.sessions where user_id='${hostId}' and not_after is not null;`),'0');
  await sql.query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where user_id='${hostId}';`);
  const result=await evaluation.readForBooking(lease(),target);
  await sql.query(`update auth.sessions set not_after=null where user_id='${hostId}';`);
  assert.equal(result.persisted?.status,'checks_passed');assert.equal(result.candidateEvaluation?.interval,'fits');assert.equal(lists,1);assert.equal(reads,1);
  assert.equal(await sql.query(`select lease_token='${leaseToken}' and check_id='${result.context.checkId}' and destination_checked_at is not null from fmat.booking_checks where attempt_id='${saved.attemptId}';`),'t');
  assert.equal(await sql.query(`select phase from fmat.booking_attempts where id='${saved.attemptId}';`),'prepared');
  const oldLease=lease();leaseToken=randomUUID();await renew();
  await assert.rejects(database.rpc('fmat_booking_evaluation',{p_operation:'evidence_read',p_lease:lease(),p_input:{requestId,revision:target.revision,evaluationId:result.persisted!.evaluationId}}));
  await assert.rejects(evaluation.readForBooking(oldLease,target));
  conflict=true;const changed=await evaluation.readForBooking(lease(),target);assert.equal(changed.persisted?.status,'conflict');assert.equal(changed.candidateEvaluation?.interval,'conflict');conflict=false;
  const evidenceCount=await sql.query(`select count(*) from fmat.candidate_evaluations where request_id='${requestId}';`);
  onRead=async()=>{await sql.query(`update fmat.hosts set rules_version=rules_version+1 where id='${hostId}';`);};
  await assert.rejects(evaluation.readForBooking(lease(),target));onRead=undefined;
  await sql.query(`update fmat.hosts set rules_version=rules_version-1 where id='${hostId}';`);
  assert.equal(await sql.query(`select count(*) from fmat.candidate_evaluations where request_id='${requestId}';`),evidenceCount);
  onRead=async()=>{await sql.query(`update fmat.jobs set lease_until=clock_timestamp()-interval '1 second' where id='${saved.jobId}';`);};
  await assert.rejects(evaluation.readForBooking(lease(),target));onRead=undefined;await renew();
  assert.equal(await sql.query(`select count(*) from fmat.candidate_evaluations where request_id='${requestId}';`),evidenceCount);
  await sql.query(`update fmat.hosts set revoked_at=clock_timestamp() where id='${hostId}';`);await assert.rejects(evaluation.readForBooking(lease(),target));await sql.query(`update fmat.hosts set revoked_at=null where id='${hostId}';`);
  assert.equal(await sql.query(`select has_function_privilege('anon','public.fmat_booking_evaluation(text,jsonb,jsonb)','EXECUTE')||','||has_function_privilege('authenticated','public.fmat_booking_evaluation(text,jsonb,jsonb)','EXECUTE')||','||has_function_privilege('service_role','fmat.evaluate_availability(text,jsonb,jsonb,jsonb)','EXECUTE');`),'false,false,false');
  writable=false;await assert.rejects(evaluation.readForBooking(lease(),target),error=>error instanceof ApplicationError&&error.code==='RECONNECT_REQUIRED');
  assert.equal(await sql.query(`select phase from fmat.booking_attempts where id='${saved.attemptId}';`),'blocked');
  assert.equal(await sql.query(`select count(*) from fmat.host_reservations where attempt_id='${saved.attemptId}';`),'0');
  assert.equal(await sql.query(`select status='negotiating' and host_availability_failed and current_proposal_version is null from fmat.requests where id='${requestId}';`),'t');
 }finally{sql.close();const cleanup=new LocalSql();await cleanup.query(`update auth.sessions set not_after=null where user_id='${hostId}';`);cleanup.close();}
}
