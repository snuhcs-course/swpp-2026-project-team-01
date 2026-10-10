import test from 'node:test';
import assert from 'node:assert/strict';
import {invitationDispatch} from './invitation-dispatch.ts';
const env={RUNTIME_DISPATCH_SECRET:'a'.repeat(64)};
const request=(authorization:string)=>new Request('https://fixture.example/api/internal/invitations/delivery',{method:'POST',headers:{authorization},body:'{}'});
test('invitation dispatcher rejects public credentials before claiming a job',async()=>{
 let calls=0;const worker={run:async()=>{calls++;return {claimed:0,outcome:'idle'};}};
 for(const credential of ['', 'Bearer host-token','Bearer '+'b'.repeat(64),'Request '+'a'.repeat(64)]){const response=await invitationDispatch(request(credential),worker,env);assert.equal(response.status,401);assert.match(response.headers.get('cache-control')??'',/no-store/);}
 assert.equal(calls,0);
 const missing=await invitationDispatch(request('Bearer '+env.RUNTIME_DISPATCH_SECRET),worker,{});assert.equal(missing.status,503);assert.equal(calls,0);
});
test('invitation dispatcher claims once and redacts worker exceptions',async()=>{
 let calls=0;const worker={run:async()=>{calls++;return {claimed:0,outcome:'idle'};}};
 const response=await invitationDispatch(request('Bearer '+env.RUNTIME_DISPATCH_SECRET),worker,env);assert.equal(response.status,200);assert.equal(calls,1);assert.deepEqual(await response.json(),{claimed:0,outcome:'idle'});assert.match(response.headers.get('cache-control')??'',/no-store/);
 const failure=await invitationDispatch(request('Bearer '+env.RUNTIME_DISPATCH_SECRET),{run:async()=>{throw new Error('private-provider-details');}},env);assert.equal(failure.status,500);assert.equal((await failure.text()).includes('private-provider-details'),false);
});
