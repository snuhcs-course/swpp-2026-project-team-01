import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AvailabilityEvaluation} from '../../lib/server/scheduling/availability.ts';
import {SchedulingPublication} from '../../lib/server/scheduling/publication.ts';
import {CandidateRanking} from '../../lib/server/scheduling/ranking.ts';
import {RequesterAvailability} from '../../lib/server/calendar/requester-availability.ts';
import {localTimeToInstant} from '../../lib/contracts/time.ts';
import {intervalLabel} from '../../apps/web/lib/timezone-preference.ts';
import type {Database} from '../../lib/server/database/client.ts';
import type {Credential} from '../../lib/server/identity/credentials.ts';
import type {LocalSql} from './local-sql.ts';

/** Actual publication/selection/agreement across both New York clock changes. */
export async function verifySchedulingDst(sql:LocalSql,database:Database,env:NodeJS.ProcessEnv,hostId:string,requestId:string,host:Credential,guest:Credential){
 const original=JSON.parse(await sql.query(`select json_build_object('rules',h.rules,'details',r.details,'mode',r.availability_mode,'expiresAt',r.expires_at,'guest',(select row_to_json(c) from fmat.calendar_connections c where c.principal_kind='guest' and c.principal_id=r.id)) from fmat.requests r join fmat.hosts h on h.id=r.host_id where r.id='${requestId}';`));
 const revision=async()=>Number(await sql.query(`select revision from fmat.requests where id='${requestId}';`));
 const evaluation=new AvailabilityEvaluation(database,env,{async refresh(bundle){return {...bundle,expiresAt:Date.now()+3600000};},async list(){return [];}},{async read(){return [];}});
 const publication=new SchedulingPublication(database,evaluation,new CandidateRanking(database,{async rank(input,reserve){await reserve();return {orderedIds:input.candidates.map(c=>c.id)};}}));
 const manual=new RequesterAvailability(database,env),year=new Date().getUTCFullYear()+1;
 const sunday=(month:number,week:number)=>new Date(Date.UTC(year,month,1+(7-new Date(Date.UTC(year,month,1)).getUTCDay())%7+(week-1)*7)).toISOString().slice(0,10);
 try{
  for(const [season,day,startHour,endHour,ambiguous] of [
   ['spring',sunday(2,2),'06','07','02:30'],['autumn',sunday(10,1),'05','06','01:30'],
  ]){
   const windows=[{start:day+'T'+startHour+':30:00Z',end:day+'T'+endHour+':30:00Z'}];
   const rules={...original.rules,timezone:'America/New_York',availability:[{days:[0],start:'00:00',end:'04:00'}],focusBlocks:[],bufferMinutes:0,durationMinutes:60,preferences:'',meetingMode:'online',travelMode:'NONE',travelBufferMinutes:0};
   const details={...original.details,timezone:'Asia/Seoul',durationMinutes:60,windows,mode:'online',location:'https://meet.example.test/dst'};
   await sql.query(`update fmat.hosts set rules='${JSON.stringify(rules).replaceAll("'","''")}',rules_version=rules_version+1 where id='${hostId}';update fmat.requests set details='${JSON.stringify(details).replaceAll("'","''")}',revision=revision+1 where id='${requestId}';`);
   const before=await revision();
   assert.throws(()=>localTimeToInstant(day+'T'+ambiguous,'America/New_York'),/clock change/,season);
   assert.equal(await revision(),before,'Ambiguous/nonexistent input does not mutate the request');
   await manual.manual(guest,{revision:before,confirmed:true,timezone:'Asia/Seoul',windows});
   const offered=await publication.evaluate(guest,{requestId,revision:await revision()});
   assert.equal(offered.availability,'available',season);assert.equal(offered.publication?.candidates.length,1);
   const selected=await publication.select(guest,{requestId,revision:offered.revision,publicationId:offered.publication!.id,candidateId:offered.publication!.candidates[0].id,confirmed:true,idempotencyKey:randomUUID()});
   const proposal=selected.proposal!;assert.equal(Date.parse(proposal.start),Date.parse(windows[0].start));assert.equal(Date.parse(proposal.end)-Date.parse(proposal.start),3600000);
   assert.deepEqual((await publication.read(host,{requestId})).proposal,proposal);
   const hostDisplay=intervalLabel(proposal.start,proposal.end,'America/New_York'),guestDisplay=intervalLabel(proposal.start,proposal.end,'Asia/Seoul');
   assert.match(hostDisplay,/GMT-4/);assert.match(hostDisplay,/GMT-5/);assert.match(guestDisplay,/GMT\+9/);
   const agreed=await publication.agree(guest,{requestId,revision:selected.revision,proposalVersion:proposal.version,confirmed:true,idempotencyKey:randomUUID()});
   assert.equal(agreed.requesterAgreed,true);assert.deepEqual((await publication.read(host,{requestId})).proposal,proposal);
   assert.equal(await sql.query(`select host_approved_version is null from fmat.requests where id='${requestId}';`),'t');
   assert.equal(await sql.query(`select count(*) from fmat.jobs where payload->>'requestId'='${requestId}' and kind like 'booking%';`),'0');
  }
 }finally{
  // Manual replacement revokes its real fixture grant; restore it for the
  // surrounding authority/Calendar tests, without rewinding request revisions.
  if(original.guest)await sql.query(`update fmat.calendar_connections c set encrypted_credential=s.encrypted_credential,revoked_at=s.revoked_at,selected_calendar_ids=s.selected_calendar_ids,generation=s.generation from jsonb_populate_record(null::fmat.calendar_connections,'${JSON.stringify(original.guest).replaceAll("'","''")}') s where c.id=s.id;`);
  await sql.query(`update fmat.hosts set rules='${JSON.stringify(original.rules).replaceAll("'","''")}',rules_version=rules_version+1 where id='${hostId}';update fmat.requests set details='${JSON.stringify(original.details).replaceAll("'","''")}',availability_mode='${original.mode}',expires_at='${original.expiresAt}',revision=revision+1 where id='${requestId}';`);
 }
}
