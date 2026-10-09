import {test} from 'node:test';
import assert from 'node:assert/strict';
import {agentIntakeTarget,agentIntakeResult,prepareAgentIntake,agentIntakeScopes} from './agent-intake.ts';
import {intakeDetails} from './intake.ts';
import {parseScopes} from '../server/oauth/protocol.ts';

const idempotencyKey='00000000-0000-4000-8000-000000000001';
const details={requesterName:' Requester ',requesterEmail:' REQUESTER@example.test ',purpose:' Discuss scheduling ',timezone:'Asia/Seoul',durationMinutes:30};
const prepare=(patch:Record<string,unknown>)=>prepareAgentIntake({idempotencyKey,details:{...details,...patch}});
test('intake requires actual requester context and gives bounded field-specific clarification',()=>{
 const missing=prepareAgentIntake({idempotencyKey,details:{}});
 assert.equal(missing.status,'clarification');if(missing.status!=='clarification')throw Error();
 assert.deepEqual(missing.fields.map(entry=>[entry.field,entry.reason]),[
  ['requesterName','missing'],['requesterEmail','missing'],['purpose','missing'],['timezone','missing'],['durationMinutes','missing'],
 ]);
 assert.ok(missing.fields.every(entry=>entry.message.length>10));
 const ready=prepare({});assert.equal(ready.status,'ready');if(ready.status!=='ready')throw Error();
 assert.deepEqual(ready.details,intakeDetails.parse(details));
 assert.equal(ready.details.requesterEmail,'requester@example.test');assert.deepEqual(ready.details.windows,[]);
 assert.equal('verified' in ready.details,false);
});
test('intake rejects authority and unknown fields at every accepted object boundary',()=>{
 const secret='do-not-echo-private-value';
 for(const key of ['hostId','handle','requestId','actor','grantId','verified','token','approved']){
  for(const input of [{idempotencyKey,details,[key]:secret},{idempotencyKey,details:{...details,[key]:secret}}]){
   assert.throws(()=>prepareAgentIntake(input),{message:'Invalid intake input.'});
  }
 }
 assert.throws(()=>prepare({windows:[{start:'2026-11-01T10:00:00Z',end:'2026-11-01T11:00:00Z',actor:secret}]}),{message:'Invalid intake input.'});
 for(const input of [null,[],{}, {idempotencyKey,details:[]},{idempotencyKey:'bad',details}])assert.throws(()=>prepareAgentIntake(input),{message:'Invalid intake input.'});
 assert.equal(agentIntakeTarget.safeParse({handle:'someone',hostId:idempotencyKey}).success,false);
 assert.equal(agentIntakeTarget.safeParse({handle:'someone'}).success,true);
 assert.equal(agentIntakeResult.safeParse({status:'created',requestId:idempotencyKey,token:secret}).success,false);
});
test('invalid or ambiguous time input never picks a timezone or UTC offset',()=>{
 for(const patch of [
  {timezone:'+09:00'},{timezone:'not/a-zone'},
  {windows:[{start:'2026-11-01T01:30:00',end:'2026-11-01T02:30:00'}],timezone:'America/New_York'},
  {windows:[{start:'2026-03-08T02:30:00',end:'2026-03-08T03:30:00'}],timezone:'America/New_York'},
  {windows:[{start:'2026-11-01T02:00:00Z',end:'2026-11-01T01:00:00Z'}]},
  {windows:[{start:'2026-11-01T02:00:00Z',end:'2026-11-01T02:00:00Z'}]},
 ])assert.equal(prepare(patch).status,'clarification');
 const result=prepare({timezone:'America/New_York',windows:[{start:'2026-11-01T01:30:00-04:00',end:'2026-11-01T01:30:00-05:00'}]});
 assert.equal(result.status,'ready');
 // Compare instants, not the printed wall time or millisecond-rounded dates.
 assert.equal(prepare({windows:[{start:'2026-11-01T00:00:00.000000001Z',end:'2026-11-01T00:00:00.000000002Z'}]}).status,'ready');
});
test('invalid meeting values return guidance without reflecting raw input',()=>{
 for(const patch of [{requesterName:''},{requesterEmail:'secret-invalid-value'},{purpose:''},{durationMinutes:4},{durationMinutes:30.5},{durationMinutes:241},{mode:'automatic'},{mode:'online',location:'http://secret-invalid-value'}]){
  const result=prepare(patch);assert.equal(result.status,'clarification');
  assert.equal(JSON.stringify(result).includes('secret-invalid-value'),false);
  assert.ok(agentIntakeResult.safeParse(result).success);
 }
 assert.equal(prepare({windows:Array.from({length:31},()=>({start:'2026-11-01T10:00:00Z',end:'2026-11-01T11:00:00Z'}))}).status,'clarification');
});
test('new intake contracts do not change current OAuth scope acceptance',()=>{
 assert.deepEqual(agentIntakeScopes,['request:intake','request:read','request:write','request:decide']);
 assert.deepEqual(parseScopes('request:write request:read'),['request:read','request:write']);
 assert.deepEqual(parseScopes('host:decide host:read'),['host:decide','host:read']);
 assert.throws(()=>parseScopes('request:intake'));
 assert.throws(()=>parseScopes('request:intake host:read'));
});
