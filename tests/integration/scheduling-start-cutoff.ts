import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {SchedulingState} from '../../lib/contracts/scheduling.ts';
import type {Credential} from '../../lib/server/identity/credentials.ts';
import type {SchedulingPublication} from '../../lib/server/scheduling/publication.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {LocalSql} from './local-sql.ts';

// Real evaluation/ranking/publication with near-future intervals. Never rewrite
// immutable evidence or proposals to manufacture an elapsed candidate.
export async function verifySchedulingStartCutoff(sql:LocalSql,publication:SchedulingPublication,credential:Credential,host:string,requestId:string,agentRead:()=>Promise<unknown>){
 const literal=(value:unknown)=>"'"+JSON.stringify(value).replaceAll("'","''")+"'";
 const saved=JSON.parse(await sql.query(`select jsonb_build_object('details',r.details,'rules',h.rules) from fmat.requests r join fmat.hosts h on h.id=r.host_id where r.id='${requestId}';`));
 const revision=async()=>Number(await sql.query(`select revision from fmat.requests where id='${requestId}';`));
 const footprint=()=>sql.query(`select jsonb_build_object('revision',revision,'status',status,'selected',current_proposal_version,'agreed',requester_agreed_version,'decisions',(select count(*) from fmat.scheduling_decisions where request_id=r.id),'proposals',(select count(*) from fmat.proposals where request_id=r.id),'history',(select count(*) from fmat.request_history where request_id=r.id)) from fmat.requests r where id='${requestId}';`);
 const stale=(error:unknown)=>error instanceof ApplicationError&&error.code==='STALE_REVISION';
 const selection=(state:SchedulingState)=>({requestId,revision:state.revision,publicationId:state.publication!.id,candidateId:[...state.publication!.candidates].sort((a,b)=>Date.parse(a.interval.start)-Date.parse(b.interval.start))[0].id,confirmed:true as const,idempotencyKey:randomUUID()});
 const agreement=(state:SchedulingState)=>({requestId,revision:state.revision,proposalVersion:state.proposal!.version,confirmed:true as const,idempotencyKey:randomUUID()});
 const crossStart=(start:string)=>sql.query(`select pg_sleep(greatest(0,extract(epoch from '${start}'::timestamptz-clock_timestamp()))+0.025);`);
 async function publish(minutes:number){
  const start=Date.now()+5000;
  // Avoid the deliberately closed 23:59–00:00 rule boundary in this fixture.
  const timezone=new Date(start).getUTCHours()>=22?'America/New_York':'UTC';
  const details={...saved.details,mode:'online',durationMinutes:30,windows:[{start:new Date(start).toISOString(),end:new Date(start+minutes*60000).toISOString()}]};
  const rules={...saved.rules,timezone,bufferMinutes:0,preferences:'',meetingMode:'online',travelMode:'NONE',availability:[{days:[0,1,2,3,4,5,6],start:'00:00',end:'23:59'}]};
  await sql.query(`update fmat.requests set details=${literal(details)},revision=revision+1 where id='${requestId}';update fmat.hosts set rules=${literal(rules)},rules_version=rules_version+1 where id='${host}';`);
  const state=await publication.evaluate(credential,{requestId,revision:await revision()});
  assert.equal(state.availability,'available');assert.ok(state.publication!.candidates.length>0);
  assert.ok(start>Date.now(),'fixture must finish evaluation before its real start');
  return state;
 }
 async function acrossLock(start:string,run:()=>Promise<unknown>){
  const locker=new LocalSql();let pending:Promise<void>|undefined;
  try{
   const pid=Number(await locker.query(`begin;select id from fmat.requests where id='${requestId}' for update;select pg_backend_pid();`).then(value=>value.split('\n').at(-1)));
   assert.ok(Number.isInteger(pid));assert.ok(Date.parse(start)>Date.now());
   pending=assert.rejects(run(),stale);pending.catch(()=>{});
   let waiting=false;
   for(let i=0;i<100;i++){
    waiting=(await sql.query(`select exists(select 1 from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid)) and wait_event_type='Lock');`))==='t';
    if(waiting)break;await delay(10);
   }
   assert.equal(waiting,true,'observe the actual database decision waiting on the request lock');
   assert.ok(Date.parse(start)>Date.now(),'the wait must begin before the cutoff');
   await crossStart(start);
  }finally{await locker.query('rollback;');locker.close();}
  await pending;
 }
 try{
  const mixed=await publish(60),select=selection(mixed),selected=await publication.select(credential,select),agree=agreement(selected);
  const agreed=await publication.agree(credential,agree),before=await footprint();
  await crossStart(selected.proposal!.start);
  const elapsed=await publication.read(credential,{requestId});
  assert.equal(elapsed.availability,'stale','source expiry is capped at the earliest candidate start');
  assert.equal(elapsed.publication,null);
  assert.equal(elapsed.canAgree,false);assert.equal(elapsed.requesterAgreed,true,'retain the historical explicit agreement');
  assert.deepEqual(await agentRead(),elapsed,'signed MCP and browser service share the elapsed-start projection');
  assert.deepEqual(await publication.agree(credential,agree),elapsed,'exact completed retry is read-only even after start');
  await assert.rejects(publication.agree(credential,{...agree,revision:agreed.revision,idempotencyKey:randomUUID()}),stale);
  await assert.rejects(publication.select(credential,{...select,revision:agreed.revision,idempotencyKey:randomUUID()}),stale);
  assert.equal(await footprint(),before,'elapsed decisions create no state/history/decision effects');

  const single=await publish(30),singleInput=selection(single),singleBefore=await footprint();
  await acrossLock(single.publication!.candidates[0].interval.start,()=>publication.select(credential,singleInput));
  const exhausted=await publication.read(credential,{requestId});
  assert.equal(exhausted.availability,'stale');assert.equal(exhausted.publication,null);assert.equal(exhausted.canAgree,false);
  assert.deepEqual(await agentRead(),exhausted);assert.equal(await footprint(),singleBefore);

  const last=await publish(30),lastInput=selection(last),lastSelected=await publication.select(credential,lastInput),lastBefore=await footprint();
  await acrossLock(lastSelected.proposal!.start,()=>publication.agree(credential,agreement(lastSelected)));
  const final=await publication.read(credential,{requestId});assert.equal(final.canAgree,false);assert.equal(final.requesterAgreed,false);
  assert.deepEqual(await publication.select(credential,lastInput),final,'completed selection retry cannot manufacture another proposal');
  assert.deepEqual(await agentRead(),final);assert.equal(await footprint(),lastBefore);
 }finally{
  await sql.query(`update fmat.requests set details=${literal(saved.details)},revision=revision+1 where id='${requestId}';update fmat.hosts set rules=${literal(saved.rules)},rules_version=rules_version+1 where id='${host}';`);
 }
}
