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
