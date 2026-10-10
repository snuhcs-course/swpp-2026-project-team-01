import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RuntimeSuccessors,successorBootstrap} from './runtime-successors.ts';
import type {RuntimeAuth} from './runtime-messages.ts';
import type {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
const auth:RuntimeAuth={authenticator:'fmat-conversation',principalType:'user',principalId:randomUUID(),attributes:{conversationId:randomUUID(),messageId:randomUUID()}};
const result={generation:1,messageId:auth.attributes.messageId,creationKey:randomUUID(),leaseToken:randomUUID(),leaseExpiresAt:new Date().toISOString(),state:'prepared',sessionId:null,dispatch:false};
test('successor adapter carries only captured authority and immutable creation identity',async()=>{
 const calls:unknown[]=[];
 const db={rpc:async(name:string,parameters:Record<string,unknown>)=>{assert.equal(name,'fmat_runtime_successor');calls.push(parameters);return parameters.p_operation==='bind'?{...result,state:'bound',sessionId:'fixed'}:parameters.p_operation==='start'?{...result,state:'creating',dispatch:true}:result;}} as Database;
 const service=new RuntimeSuccessors(db);
 await service.claim(auth,1);await service.start(auth,1,result.leaseToken);
 await service.bind(auth,'fixed',{generation:1,creationKey:result.creationKey,messageId:auth.attributes.messageId,context:['historical data']});
 assert.deepEqual(calls,[
  {p_operation:'claim',p_grant_id:auth.principalId,p_conversation_id:auth.attributes.conversationId,p_input:{generation:1,messageId:auth.attributes.messageId}},
  {p_operation:'start',p_grant_id:auth.principalId,p_conversation_id:auth.attributes.conversationId,p_input:{generation:1,leaseToken:result.leaseToken,messageId:auth.attributes.messageId}},
  {p_operation:'bind',p_grant_id:auth.principalId,p_conversation_id:auth.attributes.conversationId,p_input:{generation:1,creationKey:result.creationKey,sessionId:'fixed',messageId:auth.attributes.messageId}},
 ]);assert.doesNotMatch(JSON.stringify(calls),/historical data/,'context stays out of SQL parameters');
});
test('malformed or mismatched successor receipts never authorize runtime creation',async()=>{
 for(const changed of [{generation:2},{messageId:randomUUID()},{dispatch:true},{state:'bound'},{sessionId:'unbound-runtime'},{leaseExpiresAt:'bad'},{extra:'private'}]){
  const service=new RuntimeSuccessors({rpc:async()=>({...result,...changed})} as unknown as Database);
  await assert.rejects(service.claim(auth,1),e=>e instanceof ApplicationError&&e.code==='PROVIDER_UNAVAILABLE');
 }
});
test('binding rejects a foreign original input or inconsistent binding response',async()=>{
 let calls=0;
 const service=new RuntimeSuccessors({rpc:async()=>{calls++;return {...result,state:'bound',sessionId:'another'};}} as unknown as Database);
 const seed={generation:1,creationKey:result.creationKey,messageId:auth.attributes.messageId,context:['historical data']};
 await assert.rejects(service.bind(auth,'fixed',{...seed,messageId:randomUUID()}),e=>e instanceof ApplicationError&&e.code==='FORBIDDEN');assert.equal(calls,0);
 await assert.rejects(service.bind(auth,'fixed',seed),e=>e instanceof ApplicationError&&e.code==='PROVIDER_UNAVAILABLE');assert.equal(calls,2);
});
test('bootstrap uses one bounded UTF-8 context and no arbitrary extra execution fields',()=>{
 const seed={generation:1,creationKey:result.creationKey,messageId:auth.attributes.messageId,context:['한'.repeat(5461)]};
 assert.equal(successorBootstrap.safeParse(seed).success,true);
 for(const changed of [{context:['한'.repeat(5462)]},{context:[]},{context:['one','two']},{sessionId:'chosen'},{generation:0},{generation:1.5}])
  assert.equal(successorBootstrap.safeParse({...seed,...changed}).success,false);
});

test('binding retries only an uncertain response and never retries an authority denial',async()=>{
 const seed={generation:1,creationKey:result.creationKey,messageId:auth.attributes.messageId,context:['historical data']};
 for(const code of ['PROVIDER_UNAVAILABLE','UNAUTHORIZED'] as const){
  const inputs:unknown[]=[];
  const service=new RuntimeSuccessors({rpc:async(_name:unknown,input:unknown)=>{
   inputs.push(input);if(inputs.length===1)throw new ApplicationError(code,code==='UNAUTHORIZED'?401:503);
   return {...result,state:'bound',sessionId:'fixed'};
  }} as unknown as Database);
  if(code==='UNAUTHORIZED'){await assert.rejects(service.bind(auth,'fixed',seed));assert.equal(inputs.length,1);}
  else {await service.bind(auth,'fixed',seed);assert.equal(inputs.length,2);assert.deepEqual(inputs[0],inputs[1]);}
 }
});
