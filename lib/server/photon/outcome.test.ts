import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordPhotonOutcome} from './outcome.ts';
import {ApplicationError} from '../errors.ts';

test('known receipt retry is bounded and does not hide failure or lost lease',async()=>{
 for(const next of [new ApplicationError('PROVIDER_UNAVAILABLE',503),new ApplicationError('STALE_REVISION',409)]){
  let attempts=0;
  await assert.rejects(recordPhotonOutcome(async()=>{if(++attempts===1)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);throw next;},'known-reference'),error=>error===next);
  assert.equal(attempts,2);
 }
});
test('no receipt retry for unknown provider identity, authority rejection, conflicts or configuration errors',async()=>{
 for(const [reference,error]of [
  [null,new ApplicationError('PROVIDER_UNAVAILABLE',503)],
  ['known-reference',new ApplicationError('UNAUTHORIZED',401)],
  ['known-reference',new ApplicationError('FORBIDDEN',403)],
  ['known-reference',new ApplicationError('STALE_REVISION',409)],
  ['known-reference',new ApplicationError('IDEMPOTENCY_CONFLICT',409)],
  ['known-reference',new ApplicationError('CONFIGURATION_UNAVAILABLE',503)],
  ['known-reference',new Error('Unknown failure')],
 ] as const){
  let attempts=0;await assert.rejects(recordPhotonOutcome(async()=>{attempts++;throw error;},reference),actual=>actual===error);assert.equal(attempts,1);
 }
});
