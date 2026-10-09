import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {SchedulingPublication} from './publication.ts';
import {CandidateRanking,type RankingProvider} from './ranking.ts';
import {AvailabilityEvaluation} from './availability.ts';
import {EvaluationBudget,type BudgetClock} from './budget.ts';
import {Database} from '../database/client.ts';
import {guestCredential} from '../identity/credentials.ts';
import {ApplicationError} from '../errors.ts';
const unavailable=(e:unknown)=>e instanceof ApplicationError&&e.code==='PROVIDER_UNAVAILABLE';
function fixture(block?:string){
 let now=0,timer:(()=>void)|undefined,release!:()=>void,started!:()=>void;
 const ready=new Promise<void>(r=>{started=r;});
 const clock:BudgetClock={now:()=>now,schedule(callback){timer=callback;return ()=>{timer=undefined;};}},budget=new EvaluationBudget(clock);
 const expire=()=>{now=18000;timer?.();};
 const requestId=randomUUID(),checkId=randomUUID(),candidateId=randomUUID(),rankingId=randomUUID(),credential=guestCredential(requestId,'a'.repeat(43));
 const operations:string[]=[],signals:AbortSignal[]=[];let reservations=0,saves=0,published=0;
 const context={requestId,revision:1,checkId,basis:'a'.repeat(64)},candidates=[{id:candidateId,interval:{start:'2030-01-02T10:00:00Z',end:'2030-01-02T10:30:00Z'}}];
 const receipt={rankingId,requestId,revision:1,checkId,orderedIds:[candidateId],expiresAt:'2030-01-02T09:59:00Z',complete:false};
 const state={requestId,revision:1,status:'pending',detailsComplete:true,meeting:{timezone:'UTC',durationMinutes:30,mode:'online',location:'Meeting'},availability:'not_evaluated',publication:null,proposal:null,requesterAgreed:false,canAgree:false};
 async function stage(name:string){operations.push(name);if(name===block){started();await new Promise<void>(r=>{release=r;});}}
 const database=new Database({SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_SECRET_KEY:'fixture'},async(url,init)=>{
  const {p_operation:op}=JSON.parse(String(init?.body)),ranking=String(url).endsWith('fmat_candidate_ranking');
  if(ranking&&op==='reserve')reservations++;if(ranking&&op==='save')saves++;if(!ranking&&op==='publish')published++;
  await stage((ranking?'rank:':'publication:')+op);
  return Response.json(ranking?(op==='read'?{fingerprint:'b'.repeat(64),input:{timezone:'UTC',candidates},saved:saves?receipt:null}:op==='reserve'?{reserved:true}:receipt):state);
 });
 const evaluation=new AvailabilityEvaluation(database);
 evaluation.batch=async(_credential,_input,shared)=>{
  assert.equal(shared,budget);await stage('evaluation');now=17000;shared.assertActive();
  return {receipt:{checked:true,revision:1,checkedAt:new Date().toISOString(),complete:false},evaluation:{status:'ready',windows:[],durationMinutes:30,requesterTimezone:'UTC'},candidateEvaluation:null,persisted:null,context,rulesVersion:1,results:[],truncated:false};
 };
 const provider:RankingProvider={async rank(_input,reserve,signal){assert.equal(signal,budget.signal);signals.push(signal!);await reserve();await stage('model');return {orderedIds:[candidateId]};}};
 const ranking=new CandidateRanking(database,provider),publication=new SchedulingPublication(database,evaluation,ranking);
 return {budget,ranking,publication,credential,context,operations,signals,ready,release:()=>release?.(),expire,
  counts:()=>({reservations,saves,published}),run:()=>publication.evaluate(credential,{requestId,revision:1},budget)};
}
test('Publication keeps the evaluation budget through ranking, reservation, save and publish',async()=>{
 const f=fixture();try{assert.equal((await f.run()).requestId,f.context.requestId);assert.deepEqual(f.operations,['publication:read','evaluation','rank:read','rank:reserve','model','rank:save','publication:publish']);assert.deepEqual(f.counts(),{reservations:1,saves:1,published:1});f.budget.assertActive();}finally{f.budget.dispose();}
});
test('Expiry during ranking stops the whole chain, retaining allowance without a partial result',async()=>{
 for(const point of ['rank:read','rank:reserve','model']){
  const f=fixture(point);try{
   const rejected=assert.rejects(f.run(),unavailable);await f.ready;f.expire();await rejected;const before=[...f.operations];
   f.release();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.operations,before);assert.equal(f.counts().saves,0);assert.equal(f.counts().published,0);
   assert.equal(f.counts().reservations,point==='rank:read'?0:1);assert.ok(f.signals.every(s=>s.aborted));
  }finally{f.release();f.budget.dispose();}
 }
});
test('Lost ranking save reply retains its identity and a fresh read avoids another model reservation',async()=>{
 const f=fixture('rank:save');try{
  const rejected=assert.rejects(f.run(),unavailable);await f.ready;f.expire();await rejected;f.release();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.counts(),{reservations:1,saves:1,published:0});
  const recovered=await f.ranking.rank(f.credential,f.context);assert.ok(recovered.rankingId);assert.deepEqual(f.counts(),{reservations:1,saves:1,published:0});
 }finally{f.release();f.budget.dispose();}
});
test('A late publication reply never claims rollback or initiates another publication',async()=>{
 const f=fixture('publication:publish');try{
  const rejected=assert.rejects(f.run(),unavailable);await f.ready;f.expire();await rejected;assert.equal(f.counts().published,1);
  const before=[...f.operations];f.release();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.operations,before);assert.equal(f.counts().published,1);
 }finally{f.release();f.budget.dispose();}
});
