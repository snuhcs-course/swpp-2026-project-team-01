import test from 'node:test';
import assert from 'node:assert/strict';
import {generationStream} from './generation-stream.ts';
import type {GenerationTimeline} from './generation-history.ts';
import type {HistorySession} from './runtime-history.ts';
import {ApplicationError} from '../errors.ts';
import {emptyTranscript,reduceConversation} from '../../../apps/web/lib/conversation-state.ts';
import {conversationCursor,type ConversationEvent} from '../../contracts/conversations.ts';
const scope='94000000-0000-4000-8000-000000000001';
const timeline:GenerationTimeline={conversationId:scope,audience:'host_setup',generation:1,generations:[
 {generation:0,sessionId:'old-private-runtime',terminalTail:2},{generation:1,sessionId:'current-private-runtime',terminalTail:null},
]};
const event=(text:string,type='message.completed')=>({type,meta:{id:'event-'+text},data:{message:text,messageDelta:text,turnId:'turn_0',stepIndex:0,sequence:1,secret:'private-data'}});
const old=[event('First question','message.received'),event('First answer'),{type:'session.failed'}];
const live=[event('Second question','message.received'),event('Second answer')];
const signal=()=>new AbortController().signal;
function session(events:unknown[],tail=events.length-1){
 const starts:number[]=[];let cancels=0;
 const value:HistorySession={async getStreamTailIndex(){return tail;},async getEventStream({startIndex}){
  starts.push(startIndex);return new ReadableStream({start(c){for(const item of events.slice(startIndex))c.enqueue(item);c.close();},cancel(){cancels++;}});
 }};
 return {value,starts,get cancels(){return cancels;}};
}
const lines=(output:string)=>output.trim()?output.trim().split('\n').map(line=>JSON.parse(line) as ConversationEvent):[];

test('archive replay hands off to live appends without missing output or overwriting reused turn numbers',async()=>{
 const a=session(old),b=session(live);let currentOpens=0;
 b.value.getEventStream=async({startIndex})=>{
  b.starts.push(startIndex);currentOpens++;
  return new ReadableStream({start(c){for(const item of [...live,...(currentOpens===2?[{type:'session.waiting'}]:[])].slice(startIndex))c.enqueue(item);c.close();}});
 };
 const attach=(id:string)=>id===timeline.generations[0].sessionId?a.value:b.value;
 const response=await generationStream(timeline,attach,async()=>timeline,0,signal());
 assert.equal(response.headers.get('cache-control'),'no-store');
 const output=await response.text(),events=lines(output);
 assert.deepEqual(events.map(e=>'cursor'in e?e.cursor:null),[1,2,3,4,5,6]);assert.deepEqual(b.starts,[0,2]);
 assert.doesNotMatch(output,/private-runtime|private-data|terminalTail|sessionId/);
 let view=emptyTranscript();for(const row of events)view=reduceConversation(view,row);
 assert.deepEqual(view.messages.map(m=>m.text),['First question','First answer','Second question','Second answer']);
 assert.equal(view.messages[0].id,'user:turn_0:1');assert.equal(view.messages[2].id,'user:g1:turn_0:1');
 const resumed=lines(await(await generationStream(timeline,attach,async()=>timeline,3,signal())).text());
 for(const row of resumed)view=reduceConversation(view,row);
 assert.equal(view.messages.length,4);assert.equal(view.messages[3].text,'Second answer');
});

test('multiple bounded pages retain raw cursor slots before switching to the live source',async()=>{
 const events=Array.from({length:205},(_,i)=>({type:'action.result',data:{secret:'hidden-'+i}}));
 const value={...timeline,generations:[{...timeline.generations[0],terminalTail:204},timeline.generations[1]]};
 const a=session(events),b=session(live),attach=(id:string)=>id===value.generations[0].sessionId?a.value:b.value;
 const output=lines(await(await generationStream(value,attach,async()=>value,0,signal())).text());
 assert.equal(output.length,207);assert.deepEqual(a.starts,[0,100,200]);const last=output.at(-1)!;assert.equal('cursor'in last?last.cursor:0,207);
});

test('an unbound successor streams all retained history and an empty scope returns 204',async()=>{
 const value={...timeline,generations:[timeline.generations[0],{generation:1,sessionId:null,terminalTail:null}]};
 const a=session(old);
 assert.equal(lines(await(await generationStream(value,()=>a.value,async()=>value,0,signal())).text()).length,3);
 assert.equal((await generationStream(value,()=>{throw Error('already consumed');},async()=>value,3,signal())).status,204);
 const empty={...timeline,generation:0,generations:[{generation:0,sessionId:null,terminalTail:null}]};
 assert.equal((await generationStream(empty,()=>{throw Error('empty');},async()=>empty,0,signal())).status,204);
});

test('authority changes discard buffered pages before output and stop each subsequent event',async()=>{
 const a=session(old),b=session(live),attach=(id:string)=>id===timeline.generations[0].sessionId?a.value:b.value;
 let checks=0;
 const response=await generationStream(timeline,attach,async()=>{if(++checks>=4)throw new ApplicationError('UNAUTHORIZED',401);return timeline;},0,signal());
 const output=lines(await response.text());
 assert.equal(output.length,2);assert.equal(output[0].type,'user');assert.equal(output[1].type,'error');
 assert.doesNotMatch(JSON.stringify(output),/First answer|Second question|Second answer/);
 let postRead=0;
 await assert.rejects(generationStream(timeline,attach,async()=>{if(++postRead===2)throw new ApplicationError('FORBIDDEN',403);return timeline;},0,signal()),e=>e instanceof ApplicationError&&e.code==='FORBIDDEN');
});

test('idle live streams reauthorize and cancel on revocation or generation changes',async()=>{
 for(const change of ['revoked','generation','audience']){
  let changed=false,cancelled=false,opened!:()=>void;
  const ready=new Promise<void>(resolve=>{opened=resolve;});
  const value={...timeline,generation:0,generations:[{generation:0,sessionId:'live',terminalTail:null}]};
  const current:HistorySession={getStreamTailIndex:async()=>-1,getEventStream:async()=>{opened();return new ReadableStream({cancel(){cancelled=true;}});}};
  const response=await generationStream(value,()=>current,async()=>{
   if(!changed)return value;
   if(change==='revoked')throw new ApplicationError('UNAUTHORIZED',401);
   if(change==='audience')return {...value,audience:'host_private'};
   return {...value,generation:1,generations:[{...value.generations[0],terminalTail:0},{generation:1,sessionId:null,terminalTail:null}]};
  },0,signal(),{pollMs:5,leaseMs:1000});
  const output=response.text();await ready;changed=true;
  assert.match(await output,new RegExp(change==='revoked'?'UNAUTHORIZED':'RECONNECT_REQUIRED'));assert.equal(cancelled,true);
 }
});

test('stream lease and consumer cancellation release idle sources without waiting for cleanup',async()=>{
 for(const consumer of [false,true]){
  let cancelled=false,opened!:()=>void;const ready=new Promise<void>(resolve=>{opened=resolve;});
  const value={...timeline,generation:0,generations:[{generation:0,sessionId:'live',terminalTail:null}]};
  const source:HistorySession={getStreamTailIndex:async()=>-1,getEventStream:async()=>{opened();return new ReadableStream({cancel(){cancelled=true;return new Promise(()=>{});}});}};
  const response=await generationStream(value,()=>source,async()=>value,0,signal(),{leaseMs:20});
  if(consumer){const reader=response.body!.getReader();const read=reader.read();await ready;await reader.cancel();await read;}
  else assert.equal(await response.text(),'');
  assert.equal(cancelled,true);
 }
});

test('late opening streams are cancelled after the bounded open deadline',async()=>{
 let open!:(stream:ReadableStream<unknown>)=>void,cancelled=false;
 const value={...timeline,generation:0,generations:[{generation:0,sessionId:'live',terminalTail:null}]};
 const source:HistorySession={getStreamTailIndex:async()=>-1,getEventStream:()=>new Promise(resolve=>{open=resolve;})};
 const response=await generationStream(value,()=>source,async()=>value,0,signal(),{openTimeoutMs:10,leaseMs:1000});
 assert.match(await response.text(),/PROVIDER_UNAVAILABLE/);
 open(new ReadableStream({cancel(){cancelled=true;}}));await new Promise(resolve=>setTimeout(resolve,1));assert.equal(cancelled,true);
});

test('oversized live output fails safely without consuming its public cursor',async()=>{
 const value={...timeline,generation:0,generations:[{generation:0,sessionId:'live',terminalTail:null}]};
 const source=session([event('x'.repeat(70_000))],-1);
 const events=lines(await(await generationStream(value,()=>source.value,async()=>value,0,signal())).text());
 assert.equal(events.length,1);assert.equal(events[0].type,'error');assert.doesNotMatch(JSON.stringify(events),/xxxx/);
});

test('logical cursor validation preserves old cursors and supports safe multi-generation offsets',()=>{
 for(const [input,expected] of [['0',0],['0007',7],['1000000000',1000000000],[String(Number.MAX_SAFE_INTEGER),Number.MAX_SAFE_INTEGER]] as const)
  assert.equal(conversationCursor.parse(input),expected);
 for(const input of ['-1','1.5','1e3','9007199254740992','00000000000000000','Infinity'])assert.equal(conversationCursor.safeParse(input).success,false);
});

test('archived and live failures preserve fixed safe feedback without forwarding upstream details',async()=>{
 const value={...timeline,generation:0,generations:[{generation:0,sessionId:'live',terminalTail:null}]};
 const source=session(['step.failed','turn.failed','session.failed'].map(type=>({type,data:{message:'secret-upstream-error',details:'private-body'}})),0);
 const output=await(await generationStream(value,()=>source.value,async()=>value,0,signal())).text();
 const events=lines(output);assert.equal(events.length,3);
 for(const row of events){assert.equal(row.type,'failed');assert.equal('message'in row?row.message:null,'The response could not be completed. Your saved changes are preserved.');}
 assert.doesNotMatch(output,/secret-upstream|private-body/);
});
