import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectTerminalRuntime,type RuntimeBinding} from './runtime-terminal.ts';
import {ApplicationError} from '../errors.ts';

const binding:RuntimeBinding={sessionId:'wrun_fixture',generation:0};
const usage={inputTokens:120,outputTokens:25,cacheReadTokens:10,cacheWriteTokens:0};
const failed=()=>({type:'session.failed',data:{sessionId:binding.sessionId,usage:{...usage,costUsd:1},message:'private failure',details:{credential:'private secret'}},meta:{id:'event_1'}});
const signal=()=>new AbortController().signal;
function fixture(event:unknown=failed()){
 let cancelled=0;
 const starts:number[]=[];
 return {id:binding.sessionId,starts,get cancelled(){return cancelled;},
  async getStreamTailIndex(){return 19;},
  async getEventStream({startIndex}:{startIndex:number}){starts.push(startIndex);return new ReadableStream({start(c){c.enqueue(event);},cancel(){cancelled++;}});},
 };
}
const check=async()=>binding,none=async()=>null;
const unavailable=(error:unknown)=>error instanceof ApplicationError&&error.code==='PROVIDER_UNAVAILABLE';

test('terminal inspection reads only the exact last event and returns minimized usage evidence',async()=>{
 const session=fixture();let checked=0,resolved=0;
 const result=await inspectTerminalRuntime(binding,session,async()=>{checked++;return binding;},async()=>{resolved++;return null;},signal());
 assert.deepEqual(result,{state:'failed',evidence:{...binding,tailIndex:19,eventId:'event_1',usage}});
 assert.deepEqual(session.starts,[19]);assert.equal(session.cancelled,1);assert.equal(checked,2);assert.equal(resolved,2);
 assert.doesNotMatch(JSON.stringify(result),/private|costUsd|credential|message/);
});

test('active or differently owned addresses cannot supply terminal evidence',async()=>{
 for(const id of [binding.sessionId,'another-runtime']){
  const session=fixture();let checked=0;
  const result=await inspectTerminalRuntime(binding,session,async()=>{checked++;return binding;},async()=>({id}),signal());
  assert.deepEqual(result,{state:id===binding.sessionId?'active':'unavailable'});assert.equal(checked,2);assert.deepEqual(session.starts,[]);
 }
});

test('missing, completed, nonterminal and malformed usage evidence cannot authorize recovery',async()=>{
 const events=[undefined,{type:'session.completed',data:{usage}},
  {type:'turn.failed',data:{sessionId:binding.sessionId,usage}},
  {...failed(),data:{sessionId:'another-runtime',usage}},
  {...failed(),meta:{id:''}},
  ...[undefined,{...usage,inputTokens:-1},{...usage,outputTokens:0.5},{...usage,cacheReadTokens:Infinity},
   {...usage,cacheWriteTokens:Number.MAX_SAFE_INTEGER+1}].map(value=>({...failed(),data:{sessionId:binding.sessionId,usage:value}}))];
 for(const event of events){
  // undefined is deliberately sent as an invalid event, not fixture default.
  const session=fixture(event??null);
  assert.deepEqual(await inspectTerminalRuntime(binding,session,check,none,signal()),{state:'unavailable'});
 }
 const session=fixture();session.getStreamTailIndex=async()=>-1;
 assert.deepEqual(await inspectTerminalRuntime(binding,session,check,none,signal()),{state:'unavailable'});assert.deepEqual(session.starts,[]);
});

test('changed tail or newly owned address invalidates a previously observed failure',async()=>{
 const session=fixture();let reads=0;
 session.getStreamTailIndex=async()=>++reads===1?19:20;
 assert.deepEqual(await inspectTerminalRuntime(binding,session,check,none,signal()),{state:'unavailable'});
 let owners=0;
 assert.deepEqual(await inspectTerminalRuntime(binding,fixture(),check,async()=>++owners===1?null:{id:'successor'},signal()),{state:'unavailable'});
});

test('post-read revocation or generation change discards terminal evidence',async()=>{
 for(const changed of ['revoked','generation','session']){
  let checks=0;
  await assert.rejects(inspectTerminalRuntime(binding,fixture(),async()=>{
   if(++checks===1)return binding;
   if(changed==='revoked')throw new ApplicationError('FORBIDDEN',403);
   return {...binding,...(changed==='generation'?{generation:1}:{sessionId:'different'})};
  },none,signal()),e=>e instanceof ApplicationError&&e.code===(changed==='revoked'?'FORBIDDEN':'STALE_REVISION'));
 }
});

test('provider failures, truncated events and oversized bodies return only safe unavailable errors',async()=>{
 for(const session of [
  {...fixture(),getStreamTailIndex:async()=>{throw new Error('private upstream details');}},
  {...fixture(),getStreamTailIndex:async()=>NaN},
  {...fixture(),getEventStream:async()=>new ReadableStream({start(c){c.close();}})},
  fixture({...failed(),data:{...failed().data,message:'private'.repeat(20_000)}}),
 ])await assert.rejects(inspectTerminalRuntime(binding,session,check,none,signal()),e=>unavailable(e)&&!JSON.stringify(e).includes('private'));
});

test('cancelled and stalled inspection bounds every awaited authority/provider operation',async()=>{
 let called=0;
 await assert.rejects(inspectTerminalRuntime(binding,fixture(),async()=>{called++;return binding;},none,AbortSignal.abort()),unavailable);
 assert.equal(called,0);
 const pending=()=>new Promise<never>(()=>{}),keepAlive=setTimeout(()=>{},2000);
 try{
  for(const phase of ['authority','owner','tail','open','read']){
   const session=fixture();
   if(phase==='tail')session.getStreamTailIndex=pending;
   if(phase==='open')session.getEventStream=pending;
   if(phase==='read')session.getEventStream=async()=>new ReadableStream({cancel(){return pending();}});
   await assert.rejects(inspectTerminalRuntime(binding,session,phase==='authority'?pending:check,phase==='owner'?pending:none,signal(),{timeoutMs:10}),unavailable,phase);
  }
 }finally{clearTimeout(keepAlive);}
});

test('late opened streams are cancelled and mismatched handles fail before I/O',async()=>{
 let open!:(value:ReadableStream<unknown>)=>void,cancelled=false,entered!:()=>void;
 const ready=new Promise<void>(resolve=>{entered=resolve;}),controller=new AbortController();
 const session={...fixture(),getEventStream:()=>{entered();return new Promise<ReadableStream<unknown>>(resolve=>{open=resolve;});}};
 const result=inspectTerminalRuntime(binding,session,check,none,controller.signal);
 await ready;controller.abort();await assert.rejects(result,unavailable);
 open(new ReadableStream({cancel(){cancelled=true;}}));await new Promise(resolve=>setTimeout(resolve,1));assert.equal(cancelled,true);
 let checked=false;
 await assert.rejects(inspectTerminalRuntime(binding,{...fixture(),id:'foreign'},async()=>{checked=true;return binding;},none,signal()),e=>e instanceof ApplicationError&&e.code==='INVALID_INPUT');
 assert.equal(checked,false);
});
