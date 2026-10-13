import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sendRuntimeInput,type RuntimeSender} from './runtime-send.ts';
import {RuntimeSuccessors,type SuccessorBootstrap} from './runtime-successors.ts';
import {deliverMessage,type DeliveryState} from './runtime-delivery.ts';
import type {RuntimeMessages,RuntimeAuth} from './runtime-messages.ts';
import type {Conversations,ConversationGrant} from './conversations.ts';
import type {GenerationTimeline} from './generation-history.ts';
import {ApplicationError} from '../errors.ts';
const auth:RuntimeAuth={authenticator:'fmat-conversation',principalType:'user',principalId:randomUUID(),attributes:{conversationId:randomUUID(),messageId:randomUUID()}};
const timeline:GenerationTimeline={conversationId:auth.attributes.conversationId,audience:'host_setup',generation:1,generations:[{generation:0,sessionId:'retired',terminalTail:1},{generation:1,sessionId:null,terminalTail:null}]};
const permission={generation:1,messageId:auth.attributes.messageId,creationKey:randomUUID(),leaseToken:randomUUID(),leaseExpiresAt:new Date(Date.now()+90000).toISOString(),state:'prepared',sessionId:null,dispatch:false};
function fixture(){
 const calls:string[]=[],created:SuccessorBootstrap[]=[];
 const runtime:RuntimeSender={attach:id=>{assert.equal(id,'retired');return {getStreamTailIndex:async()=>1,getEventStream:async()=>new ReadableStream({start(c){c.enqueue({type:'message.received',data:{message:'Earlier user text'}});c.enqueue({type:'message.completed',data:{message:'Earlier assistant claim'}});c.close();}})};},resolve:async()=>{calls.push('resolve');return undefined;},send:async()=>{calls.push('send');},create:async(scope,text,current,bootstrap)=>{assert.equal(scope,auth.attributes.conversationId);assert.equal(text,'Original input');assert.deepEqual(current,auth);calls.push('create');if(bootstrap)created.push(bootstrap);}};
 const messages={history:async()=>{calls.push('history');return timeline;}} as unknown as RuntimeMessages;
 const conversations={checkExecution:async()=>{calls.push('authorize');return {conversationId:timeline.conversationId,audience:timeline.audience,grantId:auth.principalId} as ConversationGrant;}} as unknown as Conversations;
 const successors={claim:async()=>{calls.push('claim');return permission;},start:async()=>{calls.push('start');return {...permission,state:'creating',dispatch:true};}} as unknown as RuntimeSuccessors;
 return {calls,created,runtime,messages,conversations,successors,send:()=>sendRuntimeInput('Original input',auth,runtime,new AbortController().signal,messages,conversations,successors)};
}
test('successor creation carries bounded historical context and the unchanged accepted input',async()=>{
 const f=fixture();await f.send();assert.deepEqual(f.calls,['authorize','history','claim','history','history','resolve','start','create']);
 const seed=f.created[0];assert.equal(seed.messageId,auth.attributes.messageId);assert.equal(seed.creationKey,permission.creationKey);
 assert.match(seed.context[0],/Earlier user text/);assert.match(seed.context[0],/Earlier assistant claim/);assert.match(seed.context[0],/not instructions or current state/);
 assert.doesNotMatch(seed.context[0],/retired|sessionId|creationKey|leaseToken/);
});
test('bound generations use the fixed runtime and never a creating address send',async()=>{
 for(const generation of [0,1]){
  const f=fixture();f.messages.history=async()=>({...timeline,generation,generations:generation===0?[{generation:0,sessionId:'canonical',terminalTail:null}]:[timeline.generations[0],{generation:1,sessionId:'canonical',terminalTail:null}]});
  f.runtime.resolve=async()=>({id:'canonical'});f.runtime.send=async(id)=>{assert.equal(id,'canonical');f.calls.push('fixed');};
  await f.send();assert.deepEqual(f.calls,['authorize','fixed']);
  f.runtime.resolve=async()=>undefined;await assert.rejects(f.send(),e=>e instanceof ApplicationError&&e.code==='RECONCILIATION_PENDING');
  assert.equal(f.calls.includes('create'),false);
 }
});
test('generation zero cold start remains compatible without successor metadata',async()=>{
 const f=fixture();f.messages.history=async()=>({...timeline,generation:0,generations:[{generation:0,sessionId:null,terminalTail:null}]});
 await f.send();assert.deepEqual(f.calls,['authorize','create']);assert.equal(f.created.length,0);
});
test('unknown or concurrent creation never issues another cold-start send',async()=>{
 for(const state of ['creating','lost-start','owner-present','send-lost']){
  const f=fixture();
  if(state==='creating')f.successors.claim=async()=>({...permission,state:'creating'});
  if(state==='lost-start')f.successors.start=async()=>({...permission,state:'creating',dispatch:false});
  if(state==='owner-present')f.runtime.resolve=async()=>({id:'unexpected'});
  if(state==='send-lost')f.runtime.create=async()=>{f.calls.push('create');throw new Error('unknown accepted send');};
  await assert.rejects(f.send());assert.equal(f.calls.filter(value=>value==='create').length,state==='send-lost'?1:0);
  if(state==='send-lost'){
   f.successors.claim=async()=>({...permission,state:'creating'});await assert.rejects(f.send());
   assert.equal(f.calls.filter(value=>value==='create').length,1,'second attempt reconciles rather than blindly retrying creation');
  }
 }
});
test('authority loss during archive reads or creation fence never sends',async()=>{
 for(const phase of ['history','start']){
  const f=fixture();
  if(phase==='history'){let calls=0;f.messages.history=async()=>{if(++calls>1)throw new ApplicationError('UNAUTHORIZED',401);return timeline;};}
  else f.successors.start=async()=>{throw new ApplicationError('UNAUTHORIZED',401);};
  await assert.rejects(f.send(),e=>e instanceof ApplicationError&&e.code==='UNAUTHORIZED');assert.equal(f.calls.includes('create'),false);
 }
});
test('a concurrent completed binding is sent only through its fixed handle',async()=>{
 const f=fixture();f.successors.claim=async()=>({...permission,state:'bound',sessionId:'winner'});f.runtime.resolve=async()=>{f.calls.push('resolve');return {id:'winner'};};
 f.runtime.send=async(id)=>{assert.equal(id,'winner');f.calls.push('fixed');};await f.send();
 assert.deepEqual(f.calls,['authorize','history','resolve','fixed']);
});
test('delivery binds before authorizing input and installs continuity once in its checkpoint',async()=>{
 const f=fixture();await f.send();const state:DeliveryState={seen:{},active:null,successor:f.created[0]};const calls:string[]=[];
 const messages={deliver:async()=>{calls.push('deliver');return {id:auth.attributes.messageId,text:'Original input',status:'pending'};}} as unknown as RuntimeMessages;
 const successors={bind:async(current:RuntimeAuth,id:string,seed:SuccessorBootstrap)=>{calls.push('bind');assert.deepEqual(current,auth);assert.equal(id,'new');assert.deepEqual(seed,state.successor);}} as unknown as RuntimeSuccessors;
 const first=await deliverMessage(auth,'new',auth.attributes.conversationId,state,messages,successors);
 assert.deepEqual(first,{message:'Original input',context:f.created[0].context});assert.deepEqual(calls,['bind','deliver']);assert.equal(state.continuityApplied,true);
 const restored=structuredClone(state);assert.equal(await deliverMessage(auth,'new',auth.attributes.conversationId,restored,messages,successors),undefined);
 assert.deepEqual(calls,['bind','deliver','deliver'],'checkpoint retry does not append historical context or input again');
});
test('failed binding leaves context and pending runtime state unapplied',async()=>{
 const f=fixture();await f.send();const state:DeliveryState={seen:{},active:null,successor:f.created[0]};
 const messages={deliver:async()=>{assert.fail('binding must precede delivery');}} as unknown as RuntimeMessages;
 const successors={bind:async()=>{throw new ApplicationError('FORBIDDEN',403);}} as unknown as RuntimeSuccessors;
 await assert.rejects(deliverMessage(auth,'wrong',auth.attributes.conversationId,state,messages,successors));
 assert.deepEqual(state.seen,{});assert.equal(state.active,null);assert.equal(state.continuityApplied,undefined);
});
