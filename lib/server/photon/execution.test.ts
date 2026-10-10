import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ApplicationError} from '../errors.ts';
import {dispatchPhotonInputs} from './execution.ts';

test('private inbox dispatch is bounded, project scoped and stops on contention',async()=>{
 const project=randomUUID();let calls=0;
 const database={async rpc(name:string,input:unknown){calls++;assert.equal(name,'fmat_photon_dispatch');assert.deepEqual(input,{p_project_id:project});return {outcome:'accepted'};}};
 assert.deepEqual(await dispatchPhotonInputs(database,{PHOTON_PROJECT_ID:project}),{accepted:5,revoked:0,limited:0});assert.equal(calls,5);
 calls=0;
 const outcomes=['revoked','limited','busy','accepted'];
 assert.deepEqual(await dispatchPhotonInputs({async rpc(){calls++;return {outcome:outcomes.shift()};}},{PHOTON_PROJECT_ID:project}),{accepted:0,revoked:1,limited:1});assert.equal(calls,3);
 await assert.rejects(()=>dispatchPhotonInputs(database,{}),(error:unknown)=>error instanceof ApplicationError&&error.code==='CONFIGURATION_UNAVAILABLE');
 await assert.rejects(()=>dispatchPhotonInputs({async rpc(){throw new Error('database unavailable');}},{PHOTON_PROJECT_ID:project}),/database unavailable/);
 await assert.rejects(()=>dispatchPhotonInputs({async rpc(){return {outcome:'accepted',text:'private'};}},{PHOTON_PROJECT_ID:project}));
});

test('setup dispatch uses only its frozen lease and stops after one external continuation',async()=>{
 const project=randomUUID(),inboxId=randomUUID(),leaseToken=randomUUID(),reviewId=randomUUID();let claims=0;
 const operations:string[]=[];
 const database={async rpc(name:string,input:Record<string,unknown>){
  if(name==='fmat_photon_dispatch'){claims++;return {outcome:'setup',inboxId,leaseToken,text:'confirm setup '+reviewId};}
  assert.equal(name,'fmat_photon_setup_dispatch');assert.equal(input.p_project_id,project);
  const payload=input.p_input as Record<string,unknown>;assert.equal(payload.inboxId,inboxId);assert.equal(payload.leaseToken,leaseToken);
  operations.push(String(input.p_operation));
  if(input.p_operation==='operate'){
   assert.equal(payload.operation,'begin_confirmation');assert.deepEqual(payload.input,{reviewId});
   return {status:'confirmed',receipt:{confirmed:true,reviewId,revision:2,rulesVersion:1,savedAt:new Date().toISOString()}};
  }
  assert.equal(payload.result,'confirmed');return {outcome:'accepted'};
 }};
 assert.deepEqual(await dispatchPhotonInputs(database,{PHOTON_PROJECT_ID:project}),{accepted:1,revoked:0,limited:0});
 assert.equal(claims,1);assert.deepEqual(operations,['operate','settle']);
});

test('malformed setup commands never invoke confirmation and transient failures retain the input for retry',async()=>{
 const project=randomUUID(),inboxId=randomUUID(),leaseToken=randomUUID();
 for(const scenario of ['malformed','outage','lease'] as const){
  const operations:string[]=[];
  const database={async rpc(name:string,input:Record<string,unknown>){
   if(name==='fmat_photon_dispatch')return {outcome:'setup',inboxId,leaseToken,text:scenario==='malformed'?'confirm setup please':'review setup'};
   operations.push(String(input.p_operation));
   if(input.p_operation==='operate')throw new ApplicationError(scenario==='lease'?'BOOKING_LEASE_LOST':'PROVIDER_UNAVAILABLE',scenario==='lease'?409:503);
   if(input.p_operation==='settle'){assert.equal((input.p_input as {result:string}).result,'invalid');return {outcome:'accepted'};}
   assert.equal(input.p_operation,'retry');return {outcome:'busy'};
  }};
  if(scenario==='lease')await assert.rejects(dispatchPhotonInputs(database,{PHOTON_PROJECT_ID:project}),(error:unknown)=>error instanceof ApplicationError&&error.code==='BOOKING_LEASE_LOST');
  else assert.equal((await dispatchPhotonInputs(database,{PHOTON_PROJECT_ID:project})).accepted,scenario==='malformed'?1:0);
  assert.deepEqual(operations,scenario==='malformed'?['settle']:scenario==='lease'?['operate']:['operate','retry']);
 }
});
