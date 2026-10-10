import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {contactShareInput,contactShareReadInput,contactShareState} from './imessage.ts';

test('contact sharing accepts only a current link and retry identity, never client routing or authority',()=>{
 const input={linkId:randomUUID(),idempotencyKey:randomUUID()};
 assert.deepEqual(contactShareInput.parse(input),input);
 for(const extra of [{phone:'+15550100001'},{line:'shared'},{spaceId:'any;+;group'},{hostId:randomUUID()},{credential:{}},{status:'accepted'}])assert.equal(contactShareInput.safeParse({...input,...extra}).success,false);
 for(const invalid of [{linkId:input.linkId},{...input,linkId:'invalid'},{...input,idempotencyKey:null}])assert.equal(contactShareInput.safeParse(invalid).success,false);
 assert.deepEqual(contactShareReadInput.parse({linkId:input.linkId}),{linkId:input.linkId});
 assert.equal(contactShareReadInput.safeParse(input).success,false);
});
test('contact sharing status exposes no device-delivery claim, route or provider reference',()=>{
 const state={id:randomUUID(),linkId:randomUUID(),requestedAt:new Date().toISOString(),status:'queued'};
 for(const status of ['queued','accepted','failed','revoked','uncertain'])assert.equal(contactShareState.safeParse({...state,status}).success,true);
 for(const status of ['dispatching','delivered','saved'])assert.equal(contactShareState.safeParse({...state,status}).success,false);
 for(const extra of [{phone:'+15550100001'},{credential:{}},{providerReference:'private'}])assert.equal(contactShareState.safeParse({...state,...extra}).success,false);
});
