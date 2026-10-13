import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Database} from '../../lib/server/database/client.ts';
import {BookingWorker} from '../../lib/server/booking/worker.ts';
import {GoogleBookingProvider} from '../../lib/server/calendar/booking.ts';
import {AvailabilityEvaluation} from '../../lib/server/scheduling/availability.ts';
import {routeFingerprint} from '../../lib/server/routes/google.ts';
import type {TravelCommitment} from '../../lib/server/calendar/adjacent.ts';
import {LocalSql} from './local-sql.ts';

export function bookingNeighbors(candidate:{start:string;end:string}):TravelCommitment[]{
 const at=(base:string,minutes:number)=>new Date(Date.parse(base)+minutes*60000).toISOString();
 return [
  {id:'previous',calendarId:'fixture-calendar',eventId:'previous',version:'v1',interval:{start:at(candidate.start,-90),end:at(candidate.start,-60)},location:{address:'Previous venue'}},
  {id:'next',calendarId:'fixture-calendar',eventId:'next',version:'v1',interval:{start:at(candidate.end,60),end:at(candidate.end,90)},location:{address:'Next venue'}},
 ];
}
export async function verifyBookingRevalidation(database:Database,env:NodeJS.ProcessEnv,hostId:string,createApproved:(mode:'online'|'guest'|'travel')=>Promise<string>){
 const sql=new LocalSql();
 const scenarios=['destination_only_busy','host_busy','guest_busy','host_revoked','guest_revoked','rules_changed','approval_changed','destination_changed','destination_missing','destination_readonly','travel_conflict','travel_neighbor_changed','travel_unavailable','grant_changed_during_read','rules_changed_during_routes','guest_valid','travel_valid'] as const;
 try{
  for(const scenario of scenarios){
   const physical=scenario.startsWith('travel_')||scenario==='rules_changed_during_routes',valid=scenario.endsWith('_valid');
   if(scenario==='destination_only_busy')await sql.query(`update fmat.hosts set conflict_calendar_ids=array['conflict-calendar'] where id='${hostId}';`);
   const requestId=await createApproved(physical?'travel':scenario.startsWith('guest_')?'guest':'online');
   const saved=JSON.parse(await sql.query(`select json_build_object('jobId',j.id,'attemptId',a.id,'rulesVersion',h.rules_version,'credential',c.encrypted_credential,'candidate',json_build_object('start',a.payload->'start'->>'dateTime','end',a.payload->'end'->>'dateTime')) from fmat.jobs j join fmat.booking_attempts a on a.id=(j.payload->>'attemptId')::uuid join fmat.hosts h on h.id=a.host_id join fmat.calendar_connections c on c.id=a.connection_id where j.kind='booking' and a.request_id='${requestId}';`));
   const lease={workerId:'revalidate-'+randomUUID(),jobId:saved.jobId,leaseToken:randomUUID()};
   await sql.query(`update fmat.jobs set status='running',worker_id='${lease.workerId}',lease_token='${lease.leaseToken}',lease_until=clock_timestamp()+interval '90 seconds' where id='${lease.jobId}';`);
   let inserts=0,guestReads=0,eventReads=0,routeReads=0;let changedRules:Promise<string>|undefined;
   // Exercise revocation after BOTH parallel provider calls have started.
   // Without this barrier one preflight can observe the other's rule change
   // and correctly stop before its provider call, making the count race CI.
   let releaseRoutes!:()=>void;
   const routesStarted=new Promise<void>(resolve=>{releaseRoutes=resolve;});
   const calendar={async refresh(bundle:import('../../lib/server/calendar/google.ts').TokenBundle){return bundle;},async list(){return scenario==='destination_missing'?[]:[{id:'fixture-calendar',name:'fixture',accessRole:scenario==='destination_readonly'?'reader' as const:'owner' as const,primary:false,timeZone:'UTC',color:null}];}};
   const revoke=()=>sql.query(`update fmat.calendar_connections set revoked_at=clock_timestamp(),encrypted_credential=null where principal_kind='host' and principal_id='${hostId}';`);
   const evaluation=new AvailabilityEvaluation(database,env,calendar,{async read(access,ids){
    if(access==='booking-guest-access'){guestReads++;assert.deepEqual(ids,['guest-calendar']);return scenario==='guest_busy'?[saved.candidate]:[];}
    assert.equal(access,'fixture-access');if(scenario!=='destination_only_busy')assert.deepEqual(ids,['fixture-calendar']);
    if(scenario==='grant_changed_during_read')await revoke();
    return scenario==='host_busy'||(scenario==='destination_only_busy'&&ids.includes('fixture-calendar'))?[saved.candidate]:[];
   }},{async read(access,ids,candidate,assertCurrent){eventReads++;assert.equal(access,'fixture-access');assert.deepEqual(ids,['fixture-calendar']);await assertCurrent();const neighbors=bookingNeighbors(candidate);if(scenario==='travel_neighbor_changed'){neighbors[1].version='moved-after-approval';neighbors[1].interval.start=new Date(Date.parse(candidate.end)+60000).toISOString();}return neighbors;}},{async estimate(request){
    routeReads++;assert.equal(request.mode,'DRIVE');
    if(scenario==='rules_changed_during_routes'){
     if(routeReads===2)releaseRoutes();
     await routesStarted;
     await (changedRules??=sql.query(`update fmat.hosts set rules_version=rules_version+1 where id='${hostId}';`));
    }
    if(scenario==='travel_unavailable')return {status:'no_route',fingerprint:routeFingerprint(request),checkedAt:new Date().toISOString()};
    return {status:'success',fingerprint:routeFingerprint(request),checkedAt:new Date().toISOString(),departureTime:request.departureTime,durationNanoseconds:String(BigInt(scenario==='travel_conflict'?7200:300)*1000000000n),distanceMeters:1000};
   }});
   const worker=new BookingWorker(database,env,evaluation,new GoogleBookingProvider(async(_url,init)=>{inserts++;assert.equal(init?.method,'POST');return Response.json({...JSON.parse(String(init.body)),organizer:{email:'revalidation@example.test'},status:'confirmed',etag:'revalidation-etag'});}),calendar);
   try{
    if(scenario==='host_revoked')await revoke();
    if(scenario==='guest_revoked')await sql.query(`update fmat.calendar_connections set revoked_at=clock_timestamp(),encrypted_credential=null where principal_kind='guest' and principal_id='${requestId}';`);
    if(scenario==='rules_changed')await sql.query(`update fmat.hosts set rules_version=rules_version+1 where id='${hostId}';`);
    if(scenario==='approval_changed')await sql.query(`update fmat.requests set host_approved_version=null where id='${requestId}';`);
    if(scenario==='destination_changed')await sql.query(`update fmat.hosts set booking_calendar_id='other-calendar' where id='${hostId}';`);
    // A catalog failure has already blocked the attempt in the evaluator;
    // the worker then acknowledges that terminal state as complete.
    assert.equal(await worker.process(lease),valid?'confirmed':['destination_missing','destination_readonly'].includes(scenario)?'complete':'blocked',scenario);
    assert.equal(inserts,valid?1:0,scenario);
    assert.equal(await sql.query(`select phase from fmat.booking_attempts where id='${saved.attemptId}';`),valid?'confirmed':'blocked',scenario);
    assert.equal(await sql.query(`select count(*) from fmat.booking_dispatches where attempt_id='${saved.attemptId}';`),valid?'1':'0',scenario);
    assert.equal(await sql.query(`select count(*) from fmat.host_reservations where attempt_id='${saved.attemptId}';`),'0',scenario);
    assert.equal(await sql.query(`select count(*) from fmat.outbox where payload->>'requestId'='${requestId}';`),valid?'2':'0',scenario);
    if(scenario==='guest_busy'||scenario==='guest_valid')assert.equal(guestReads,1);
    if(physical){assert.equal(eventReads,1,scenario);assert.equal(routeReads,2,scenario);}
   }finally{
    await sql.query(`update fmat.hosts set rules_version=${saved.rulesVersion},booking_calendar_id='fixture-calendar',conflict_calendar_ids=array['fixture-calendar'] where id='${hostId}';update fmat.calendar_connections set revoked_at=null,encrypted_credential='${saved.credential}' where principal_kind='host' and principal_id='${hostId}';`);
   }
  }
 }finally{sql.close();}
}
