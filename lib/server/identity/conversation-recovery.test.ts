import test from 'node:test';
import assert from 'node:assert/strict';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {ConversationRecovery,type RecoveryRuntime} from './conversation-recovery.ts';
import type {ConversationGrant} from './conversations.ts';
const scope='97000000-0000-4000-8000-000000000001',key='97000000-0000-4000-8000-000000000002',recoveryId='97000000-0000-4000-8000-000000000003';
const grant:ConversationGrant={conversationId:scope,grantId:key,hostId:key,requestId:null,audience:'host_setup',actorKind:'host',readOnly:false,expiresAt:'2099-01-01T00:00:00Z'};
const input={expectedGeneration:0,idempotencyKey:key};
const zero={inputTokens:0,outputTokens:0};
const initial={generation:0,sessionId:'private-runtime' as string|null,recoveryId:null as string|null,receipt:null as null|{recoveryId:string;sourceGeneration:number;generation:number},retiredUsage:zero,liveUsage:zero,usagePending:false};
const usage={inputTokens:40,outputTokens:4,cacheReadTokens:0,cacheWriteTokens:0};
const event={type:'session.failed',data:{sessionId:'private-runtime',usage},meta:{id:'private-event'}};
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'};
const signal=()=>new AbortController().signal;
const code=(code:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===code;
function fixture(){
 let state=structuredClone(initial),owner:{id:string}|undefined,terminal:unknown=event,loss=false,malformed=false,denied=false,reads=0,begins=0;
 const requests:Record<string,any>[]=[];
 const database=new Database(env,async(_url,init)=>{
  const body=JSON.parse(String(init?.body));requests.push(body);assert.equal(body.p_conversation_id,scope);assert.equal(body.p_grant_id,key);
  if(denied)return Response.json({message:'UNAUTHORIZED'},{status:400});
  if(body.p_operation==='read')return Response.json(state);
  begins++;assert.deepEqual(body.p_input,{...input,evidence:{sessionId:'private-runtime',generation:0,tailIndex:0,eventId:'private-event',usage}});
  state={...state,generation:1,sessionId:null,recoveryId,receipt:{recoveryId,sourceGeneration:0,generation:1}};
  return loss?Response.json({message:'lost response'},{status:503}):Response.json(malformed?{private:'upstream-sentinel'}:state.receipt);
 });
 const runtime:RecoveryRuntime={resolve:async()=>owner,attach:id=>({id,getStreamTailIndex:async()=>0,getEventStream:async()=>{reads++;return new ReadableStream({start(c){c.enqueue(terminal);c.close();}});}})};
 return {service:new ConversationRecovery(database),runtime,requests,get reads(){return reads;},get begins(){return begins;},get state(){return state;},set state(v){state=v;},set owner(v:{id:string}|undefined){owner=v;},set terminal(v:unknown){terminal=v;},set loss(v:boolean){loss=v;},set malformed(v:boolean){malformed=v;},deny(){denied=true;}};
}
test('recovery exposes only safe logical state and transitions once from trusted terminal evidence',async()=>{
 const f=fixture();assert.deepEqual(await f.service.status(grant,f.runtime,signal()),{conversationId:scope,generation:0,state:'recovery_required'});assert.equal(f.begins,0);
 const result=await f.service.recover(grant,input,f.runtime,signal());assert.deepEqual(result,{conversationId:scope,generation:1,state:'recovering',recoveryId});
 assert.doesNotMatch(JSON.stringify(result),/private-|sessionId|eventId|usage|grantId/);
 const reads=f.reads;assert.deepEqual(await f.service.recover(grant,input,f.runtime,signal()),result);assert.equal(f.begins,1);assert.equal(f.reads,reads,'exact replay needs no old provider evidence');
});
test('lost committed transition acknowledgment reconciles the same identity without another begin',async()=>{
 const f=fixture();f.loss=true;await assert.rejects(f.service.recover(grant,input,f.runtime,signal()),code('PROVIDER_UNAVAILABLE'));
 assert.equal((await f.service.recover(grant,input,f.runtime,signal())).state,'recovering');assert.equal(f.begins,1);
});
test('malformed committed acknowledgment fails safely and retains its exact retry',async()=>{
 const f=fixture();f.malformed=true;await assert.rejects(f.service.recover(grant,input,f.runtime,signal()),code('PROVIDER_UNAVAILABLE'));
 assert.equal((await f.service.recover(grant,input,f.runtime,signal())).state,'recovering');assert.equal(f.begins,1);
});
test('active, missing, foreign-owned and incomplete terminal evidence never starts recovery',async()=>{
 for(const kind of ['active','missing','foreign','incomplete']){
  const f=fixture();if(kind==='active')f.owner={id:'private-runtime'};if(kind==='foreign')f.owner={id:'other'};
  if(kind==='missing')f.state={...f.state,sessionId:null};if(kind==='incomplete')f.terminal={type:'session.failed',data:{sessionId:'private-runtime'}};
  const result=await f.service.recover(grant,input,f.runtime,signal());assert.equal(result.state,['active','missing'].includes(kind)?'active':'unavailable');assert.equal(f.begins,0);
 }
});
test('retired plus terminal or persisted live usage and unresolved receipts cannot reset limits',async()=>{
 for(const mode of ['terminal','floor','retired','pending']){
  const f=fixture();
  if(mode==='terminal')f.terminal={...event,data:{...event.data,usage:{...usage,inputTokens:100000}}};
  if(mode==='floor')f.state={...f.state,liveUsage:{inputTokens:0,outputTokens:8000}};
  if(mode==='retired')f.state={...f.state,retiredUsage:{inputTokens:99960,outputTokens:0}};
  if(mode==='pending')f.state={...f.state,usagePending:true};
  assert.equal((await f.service.recover(grant,input,f.runtime,signal())).state,mode==='pending'?'unavailable':'limit_reached');assert.equal(f.begins,0);
 }
});
test('invalid client evidence, aborted requests and stale observations cannot write recovery',async()=>{
 const f=fixture();await assert.rejects(f.service.recover(grant,{...input,evidence:event},f.runtime,signal()),code('INVALID_INPUT'));assert.equal(f.requests.length,0);
 await assert.rejects(f.service.recover(grant,input,f.runtime,AbortSignal.abort()),code('PROVIDER_UNAVAILABLE'));assert.equal(f.reads,0);assert.equal(f.requests.length,0);
 f.state={...f.state,generation:1,recoveryId,sessionId:'successor'};await assert.rejects(f.service.recover(grant,input,f.runtime,signal()),code('STALE_REVISION'));assert.equal(f.begins,0);
});
test('revocation during provider inspection cannot return a usable result or transition',async()=>{
 const f=fixture(),attach=f.runtime.attach;f.runtime.attach=id=>({...attach(id),getStreamTailIndex:async()=>{f.deny();return 0;}});
 await assert.rejects(f.service.recover(grant,input,f.runtime,signal()),code('UNAUTHORIZED'));assert.equal(f.begins,0);
});
