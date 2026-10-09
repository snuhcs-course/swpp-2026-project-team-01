import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AvailabilityEvaluation} from './availability.ts';
import {EvaluationBudget,type BudgetClock} from './budget.ts';
import {Database} from '../database/client.ts';
import {TokenCipher} from '../calendar/encryption.ts';
import {calendarScopes} from '../calendar/google.ts';
import {guestCredential} from '../identity/credentials.ts';
import {ApplicationError} from '../errors.ts';
const unavailable=(e:unknown)=>e instanceof ApplicationError&&e.code==='PROVIDER_UNAVAILABLE';
function fixture(expireAt?:string,occurrence=1,stall=false){
 let now=0,timer:(()=>void)|undefined,seen=0,release:(()=>void)|undefined,ready!:()=>void;
 const started=new Promise<void>(r=>{ready=r;});
 const timing:BudgetClock={now:()=>now,schedule(callback){timer=callback;return ()=>{timer=undefined;};}};
 const budget=new EvaluationBudget(timing),operations:string[]=[],signals:AbortSignal[]=[];
 const expire=()=>{now=18000;timer?.();};
 async function stage<T>(name:string,value:T,signal?:AbortSignal):Promise<T>{
  operations.push(name);if(signal)signals.push(signal);
  if(name==='host'&&expireAt==='failure')throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  if(name===expireAt&&++seen===occurrence){
   if(stall){const pending=new Promise<void>(r=>{release=r;});ready();await pending;}
   else expire();
  }
  return value;
 }
 const requestId=randomUUID(),hostId=randomUUID(),env={SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_SECRET_KEY:'fixture',TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')},cipher=new TokenCipher(env);
 const grant=(kind:'host'|'guest',id:string)=>({principalId:id,providerSubject:kind,calendarIds:[kind],encryptedCredential:cipher.seal({subject:kind,accessToken:kind,refreshToken:'refresh',expiresAt:expireAt==='refresh'?1:Date.now()+3600000,scopes:[...calendarScopes[kind]]},'google:'+kind+':'+id)});
 const candidate={start:'2030-01-02T10:00:00Z',end:'2030-01-02T10:30:00Z'};
 const state={bookingCalendarId:'booking',checkId:randomUUID(),basis:'a'.repeat(64),travelBasis:'b'.repeat(64),revision:1,rulesVersion:1,preferenceDecisions:[],allowances:[],localBookings:[],localCommitments:[],mode:'calendar',host:grant('host',hostId),guest:grant('guest',requestId),
  details:{windows:[{start:'2030-01-02T10:00:00Z',end:'2030-01-02T12:00:00Z'}],timezone:'UTC',durationMinutes:30,mode:'in_person',location:'Meeting venue'},
  rules:{timezone:'UTC',durationMinutes:30,availability:[{days:[0,1,2,3,4,5,6],start:'08:00',end:'18:00'}],focusBlocks:[],bufferMinutes:0,travelMode:'DRIVE',preferences:'',meetingMode:'either',locationPolicy:'per_meeting',locations:[],travelBufferMinutes:0},
 };
 const database=new Database(env,async(_url,init)=>{
  const {p_operation:op}=JSON.parse(String(init?.body));
  const value=op==='start'?state:op==='success'?{checked:true,revision:1,checkedAt:new Date().toISOString()}:op==='evidence_save'?{evaluationId:randomUUID(),requestId,revision:1,rulesVersion:1,status:'clarification',expiresAt:'2030-01-02T09:59:00Z',complete:false}:{};
  return Response.json(await stage(op,value));
 });
 const evaluation=new AvailabilityEvaluation(database,env,
  {refresh:async(b,_kind,s)=>stage('refresh',{...b,expiresAt:Date.now()+3600000},s),list:async(_token,s)=>stage('list',[{id:'booking',name:'Booking',accessRole:'owner',primary:false,timeZone:'UTC',color:null}],s)},
  {read:async(token,_ids,_windows,s)=>stage(token,[],s)},
  {read:async(_token,_ids,_candidate,_current,s)=>stage('events',[
   {id:'prior',calendarId:'host',eventId:'prior',version:'1',interval:{start:'2030-01-02T08:00:00Z',end:'2030-01-02T09:00:00Z'},location:{address:'Prior venue'}},
   {id:'next',calendarId:'host',eventId:'next',version:'1',interval:{start:'2030-01-02T15:00:00Z',end:'2030-01-02T16:00:00Z'},location:{address:'Next venue'}},
  ],s)},
  {estimate:async(_request,s)=>stage('routes',{status:'failure',reason:'unavailable',fingerprint:null,checkedAt:new Date().toISOString()},s)},
 );
 const credential=guestCredential(requestId,'a'.repeat(43)),target={requestId,revision:1,candidate};
 return {evaluation,budget,operations,signals,target,credential,expire,started,release:()=>release?.(),
  run:(kind:'direct'|'batch'|'booking'='direct',shared=true)=>kind==='batch'?evaluation.batch(credential,{requestId,revision:1,sampling:{stepMinutes:30,limit:3}},shared?budget:undefined):kind==='booking'?evaluation.readForBooking({workerId:'fixture',jobId:randomUUID(),leaseToken:randomUUID()},target,shared?budget:undefined):evaluation.read(credential,target,shared?budget:undefined)};
}

test('Evaluation fences every acquisition and persistence boundary with the same budget',async()=>{
 for(const point of ['start','check','refresh','list','host','guest','events','routes','success','evidence_save']){
  const f=fixture(point);try{
   await assert.rejects(f.run(),unavailable);const boundary=f.operations.indexOf(point);assert.ok(boundary>=0,point+' was exercised');
   assert.equal(f.operations.length,boundary+1,'no new work after '+point);
   assert.ok(f.signals.every(s=>s===f.budget.signal));assert.equal(f.budget.signal.aborted,true);
  }finally{f.budget.dispose();}
 }
});
test('Late provider responses cannot resume evaluation, write evidence or call the guest',async()=>{
 for(const kind of ['direct','batch','booking'] as const){
  const f=fixture('host',1,true);try{
   const rejected=assert.rejects(f.run(kind),unavailable);await f.started;f.expire();await rejected;
   const before=[...f.operations];f.release();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.operations,before);
   assert.ok(!f.operations.includes('guest'));assert.ok(!f.operations.includes('success'));
  }finally{f.release();f.budget.dispose();}
 }
});
test('Batch expiry in a later candidate rejects the complete batch before evidence persistence',async()=>{
 const f=fixture('events',2);try{await assert.rejects(f.run('batch'),unavailable);assert.equal(f.operations.filter(op=>op==='events').length,2);assert.ok(!f.operations.includes('success'));assert.ok(!f.operations.includes('evidence_save'));}finally{f.budget.dispose();}
});
test('Successful evaluation preserves checks and evidence; owned budgets dispose while borrowed budgets survive',async()=>{
 for(const shared of [true,false]){
  const f=fixture();try{const result=await f.run('direct',shared);assert.equal(result.receipt.checked,true);assert.ok(f.operations.includes('success'));assert.ok(f.operations.includes('evidence_save'));assert.equal(f.operations.at(-1),'check');assert.equal(f.signals[0].aborted,!shared);if(shared)f.budget.assertActive();}finally{f.budget.dispose();}
 }
});

test('Failure recording cannot extend the evaluation deadline or resume after its late reply',async()=>{
 const f=fixture('failure',1,true);try{
  const rejected=assert.rejects(f.run(),unavailable);await f.started;f.expire();await rejected;
  assert.equal(f.operations.at(-1),'failure');const before=[...f.operations];f.release();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.operations,before);
 }finally{f.release();f.budget.dispose();}
});
