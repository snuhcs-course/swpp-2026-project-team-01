import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ConversationRecoveryClient,recoveryStorageKey,type RecoveryView} from './conversation-recovery-client.ts';

function fixture(){
 const scope=randomUUID(),values=new Map<string,string>();let view:RecoveryView|undefined,denied=0;
 const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
 const changed=(next:RecoveryView)=>{view=next;},deny=()=>{denied++;};
 return {scope,values,storage,changed,deny,get view(){return view!;},get denied(){return denied;}};
}
test('lost response and reload retain exact recovery intent; authoritative successor resolves it without another POST',async()=>{
 const f=fixture(),bodies:unknown[]=[];let generation=0;
 const transport=async(_path:string,_signal:AbortSignal,body?:unknown)=>{if(body){bodies.push(body);throw new Error('lost');}return {conversationId:f.scope,generation,state:generation?'recovering':'recovery_required',...(generation?{recoveryId:randomUUID()}:{})};};
 const first=new ConversationRecoveryClient(f.scope,'',()=>f.storage,f.changed,f.deny,transport);
 await first.inspect();assert.equal(bodies.length,0);await first.recover();assert.equal(f.view.retry,true);
 const saved=JSON.parse(f.values.get(recoveryStorageKey(f.scope))!);assert.deepEqual(Object.keys(saved).sort(),['expectedGeneration','idempotencyKey']);first.stop();
 const reload=new ConversationRecoveryClient(f.scope,'',()=>f.storage,f.changed,f.deny,transport);
 await reload.inspect();assert.equal(bodies.length,1);await reload.recover();assert.deepEqual(bodies,[saved,saved]);
 generation=1;await reload.inspect();assert.equal(f.view.status?.generation,1);assert.equal(f.view.retry,false);assert.equal(f.values.size,0);
 await reload.recover();assert.equal(bodies.length,2);reload.stop();
});
test('only explicit recovery of confirmed failure posts; active, uncertain and exhausted states do not',async()=>{
 for(const state of ['active','unavailable','limit_reached'] as const){
  const f=fixture();let posts=0;
  const client=new ConversationRecoveryClient(f.scope,'?requestId='+randomUUID(),()=>f.storage,f.changed,f.deny,async(path,_signal,body)=>{assert.match(path,/\/recovery\?requestId=/);if(body)posts++;return {conversationId:f.scope,generation:0,state};});
  await client.recover();await client.inspect();await client.recover();assert.equal(posts,0);client.stop();
 }
});
test('an in-flight request excludes concurrent actions and stopped clients discard late responses',async()=>{
 const f=fixture();let release!:(value:unknown)=>void,calls=0;
 const client=new ConversationRecoveryClient(f.scope,'',()=>f.storage,f.changed,f.deny,async()=>{calls++;return new Promise(resolve=>{release=resolve;});});
 const pending=client.inspect();await client.inspect();await client.recover();assert.equal(calls,1);assert.equal(f.view.busy,true);
 client.stop();release({conversationId:f.scope,generation:0,state:'recovery_required'});await pending;assert.equal(f.view.status,null);
});
test('malformed stored intent and unavailable browser storage do not authorize or prevent an explicit action',async()=>{
 for(const raw of ['{',JSON.stringify({expectedGeneration:0,idempotencyKey:randomUUID(),sessionId:'forged'}),'x'.repeat(257)]){
  const f=fixture();f.values.set(recoveryStorageKey(f.scope),raw);let body:unknown;
  const client=new ConversationRecoveryClient(f.scope,'',()=>f.storage,f.changed,f.deny,async(_path,_signal,input)=>{body=input;return {conversationId:f.scope,generation:0,state:'active'};});
  await client.inspect();assert.equal(f.view.retry,false);await client.recover();assert.equal(body,undefined);client.stop();
 }
 const f=fixture(),bodies:unknown[]=[];
 const client=new ConversationRecoveryClient(f.scope,'',()=>{throw new Error('storage denied');},f.changed,f.deny,async(_p,_s,body)=>{if(body){bodies.push(body);throw new Error('lost');}return {conversationId:f.scope,generation:0,state:'recovery_required'};});
 await client.inspect();await client.recover();await client.recover();assert.deepEqual(bodies[0],bodies[1]);client.stop();
});
test('foreign or older status cannot replace observed state; stale retry remains until authoritative reconciliation',async()=>{
 const f=fixture();let response:unknown={conversationId:f.scope,generation:2,state:'recovery_required'},failure=false;
 const client=new ConversationRecoveryClient(f.scope,'',()=>f.storage,f.changed,f.deny,async(_p,_s,body)=>{if(body&&failure)throw Object.assign(new Error('stale'),{status:409});return response;});
 await client.inspect();response={conversationId:randomUUID(),generation:3,state:'active'};await client.inspect();assert.equal(f.view.status?.generation,2);assert.ok(f.view.error);
 response={conversationId:f.scope,generation:1,state:'active'};await client.inspect();assert.equal(f.view.status?.generation,2);
 failure=true;await client.recover();assert.equal(f.view.retry,true);
 response={conversationId:f.scope,generation:3,state:'active'};await client.inspect();assert.equal(f.view.retry,false);assert.equal(f.view.error,'');client.stop();
});
test('current access denial removes the local retry and stops further status or recovery calls',async()=>{
 for(const status of [401,403,404]){
  const f=fixture();f.values.set(recoveryStorageKey(f.scope),JSON.stringify({expectedGeneration:0,idempotencyKey:randomUUID()}));let calls=0;
  const client=new ConversationRecoveryClient(f.scope,'',()=>f.storage,f.changed,f.deny,async()=>{calls++;throw Object.assign(new Error('denied'),{status});});
  await client.inspect();await client.recover();assert.equal(calls,1);assert.equal(f.denied,1);assert.equal(f.values.size,0);
 }
});
test('an exhausted generation counter reports unavailable without throwing or posting an invalid intent',async()=>{
 const f=fixture();let calls=0;
 const client=new ConversationRecoveryClient(f.scope,'',()=>f.storage,f.changed,f.deny,async()=>{calls++;return {conversationId:f.scope,generation:Number.MAX_SAFE_INTEGER,state:'recovery_required'};});
 await client.inspect();await client.recover();assert.equal(calls,1);assert.match(f.view.error,/Recovery is unavailable/);assert.equal(f.values.size,0);client.stop();
});
