import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationRecoveryInput,conversationRecoveryStatus} from './conversation-recovery.ts';

const conversationId='91000000-0000-4000-8000-000000000001';
const idempotencyKey='92000000-0000-4000-8000-000000000001';

test('recovery requests preserve observed generation and retry identity without accepting authority claims',()=>{
 for(const expectedGeneration of [0,1,Number.MAX_SAFE_INTEGER]){
  const input={expectedGeneration,idempotencyKey};
  assert.deepEqual(conversationRecoveryInput.parse(input),input);
 }
 for(const expectedGeneration of [-1,0.5,Infinity,NaN,Number.MAX_SAFE_INTEGER+1,'0',null])
  assert.equal(conversationRecoveryInput.safeParse({expectedGeneration,idempotencyKey}).success,false);
 for(const key of ['conversationId','sessionId','grantId','actor','terminal','confirmed','usage','nextSessionId','force'])
  assert.equal(conversationRecoveryInput.safeParse({expectedGeneration:0,idempotencyKey,[key]:true}).success,false,key);
 for(const input of [{expectedGeneration:0},{idempotencyKey},{expectedGeneration:0,idempotencyKey:'new'},null,[]])
  assert.equal(conversationRecoveryInput.safeParse(input).success,false);
});

test('recovery statuses expose only logical scope and explicit bounded states',()=>{
 for(const state of ['active','recovery_required','unavailable','limit_reached']){
  const status={conversationId,generation:0,state};
  assert.deepEqual(conversationRecoveryStatus.parse(status),status);
  assert.equal(conversationRecoveryStatus.safeParse({...status,recoveryId:idempotencyKey}).success,false);
 }
 const recovering={conversationId,generation:1,state:'recovering',recoveryId:idempotencyKey};
 assert.deepEqual(conversationRecoveryStatus.parse(recovering),recovering);
 for(const status of [{...recovering,recoveryId:undefined},{...recovering,recoveryId:'runtime-id'},
  {...recovering,generation:-1},{...recovering,conversationId:'runtime-id'},
  {...recovering,state:'completed'},{...recovering,sessionId:'private-runtime'},
  {...recovering,error:{message:'upstream detail'}},{...recovering,credential:'private-token'}])
  assert.equal(conversationRecoveryStatus.safeParse(status).success,false);
});
