import test from 'node:test';
import assert from 'node:assert/strict';
import {generationTimeline,legacyHistoryPosition,readGenerationHistory,type GenerationTimeline} from './generation-history.ts';
import {ApplicationError} from '../errors.ts';
import type {HistorySession} from './runtime-history.ts';
import {emptyTranscript,reduceConversation} from '../../../apps/web/lib/conversation-state.ts';
const scope='93000000-0000-4000-8000-000000000001';
const signal=()=>new AbortController().signal;
const event=(type:string,text:string,id:string,turnId='turn-1')=>({type,meta:{id},data:{message:text,messageDelta:text,turnId,stepIndex:0,sequence:1,secret:'private-metadata'}});
const old=[event('message.received','Question','u1'),{type:'action.result',data:{secret:'private-tool'}},event('message.appended','Par','a1'),event('message.completed','Complete answer','a2'),{type:'session.failed',data:{message:'private-failure'},meta:{id:'failure'}}];
const current=[event('message.received','Follow-up','u2','turn-2'),event('message.completed','Reply','a3','turn-2'),{type:'session.waiting',meta:{id:'waiting'}}];
const timeline:GenerationTimeline={conversationId:scope,audience:'host_setup',generation:1,generations:[
 {generation:0,sessionId:'private-old-runtime',terminalTail:4},{generation:1,sessionId:'private-current-runtime',terminalTail:null},
]};
function fixture(events:unknown[],tail=events.length-1){
 const starts:number[]=[];let cancelled=0;
 const session:HistorySession={async getStreamTailIndex(){return tail;},async getEventStream({startIndex}){
  starts.push(startIndex);return new ReadableStream({start(c){for(const e of events.slice(startIndex))c.enqueue(e);},cancel(){cancelled++;}});
 }};
 return {session,starts,get cancelled(){return cancelled;}};
}
function environment(value:GenerationTimeline=timeline){
 const a=fixture(old),b=fixture(current),attached:string[]=[];
 const attach=(id:string)=>{attached.push(id);if(id===value.generations[0].sessionId)return a.session;if(id===value.generations[1]?.sessionId)return b.session;throw Error('unknown runtime');};
 return {a,b,attached,attach,check:async()=>value};
}
const code=(value:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===value;

test('logical pages preserve archived/live ordering, event identity and browser replay deduplication',async()=>{
 const env=environment();const all=[];let cursor=0,more=true;
 while(more){const page=await readGenerationHistory(timeline,env.attach,env.check,cursor,signal(),{maxEvents:3});all.push(...page.events);cursor=page.nextCursor;more=page.hasMore;}
 assert.deepEqual(all.map(e=>e.cursor),[1,2,3,4,5,6,7,8]);assert.equal(cursor,8);
 assert.deepEqual(all.filter(e=>e.type==='user'||e.type==='message').map(e=>e.id),['u1','a2','u2','a3']);
 assert.doesNotMatch(JSON.stringify(all),/private-|sessionId|terminalTail|generation/);
 let view=emptyTranscript();for(const row of all)view=reduceConversation(view,row);
 assert.deepEqual(view.messages.map(m=>m.text),['Question','Complete answer','Follow-up','Reply']);
 const replay=await readGenerationHistory(timeline,env.attach,env.check,4,signal());
 for(const row of replay.events)view=reduceConversation(view,row);
 assert.equal(view.messages.length,4);assert.equal(view.cursor,8);
 assert.deepEqual(await readGenerationHistory(timeline,env.attach,env.check,8,signal()),{events:[],nextCursor:8,hasMore:false});
 assert.ok(env.a.cancelled>0&&env.b.cancelled>0);
});

test('legacy session cursors translate only within the authorized ledger and frozen range',async()=>{
 assert.equal(legacyHistoryPosition(timeline,'private-old-runtime',4),4);
 assert.equal(legacyHistoryPosition(timeline,'private-old-runtime',5),5);
 assert.equal(legacyHistoryPosition(timeline,'private-current-runtime',2),7);
 for(const [id,position] of [['foreign',0],['private-old-runtime',6],['private-old-runtime',-1],['private-old-runtime',0.5],['private-current-runtime',Number.MAX_SAFE_INTEGER]] as const)
  assert.throws(()=>legacyHistoryPosition(timeline,id,position),code('INVALID_INPUT'));
 const env=environment(),page=await readGenerationHistory(timeline,env.attach,env.check,legacyHistoryPosition(timeline,'private-old-runtime',4),signal());
 assert.deepEqual(page.events.map(e=>e.cursor),[5,6,7,8]);
});

test('repeated recovery keeps every generation and translates each old cursor exactly once',async()=>{
 const value:GenerationTimeline={...timeline,generation:3,generations:[
  {generation:0,sessionId:'first',terminalTail:1},
  {generation:1,sessionId:'second',terminalTail:0},
  {generation:2,sessionId:'third',terminalTail:2},
  {generation:3,sessionId:'fourth',terminalTail:null},
 ]};
 const records=[
  [event('message.completed','First answer','one','turn-1'),{type:'session.failed'}],
  [{type:'session.failed'}],
  [event('message.received','Next question','two','turn-2'),event('message.completed','Second answer','three','turn-2'),{type:'session.failed'}],
  [event('message.completed','Current answer','four','turn-3')],
 ];
 const sessions=new Map(value.generations.map((row,index)=>[row.sessionId,fixture(records[index]).session]));
 const attach=(id:string)=>sessions.get(id)!;
 const full=await readGenerationHistory(value,attach,async()=>value,0,signal());
 assert.deepEqual(full.events.map(row=>row.cursor),[1,2,3,4,5,6,7]);
 for(const [id,position,logical] of [['first',2,2],['second',1,3],['third',2,5],['fourth',1,7]] as const){
  const translated=legacyHistoryPosition(value,id,position);assert.equal(translated,logical);
  const rest=await readGenerationHistory(value,attach,async()=>value,translated,signal());
  assert.deepEqual(rest.events,full.events.slice(logical));
 }
 let view=emptyTranscript();
 for(const row of full.events)view=reduceConversation(view,row);
 assert.deepEqual(view.messages.map(row=>row.text),['First answer','Next question','Second answer','Current answer']);
});

test('foreign authority is rejected before any runtime can be attached',async()=>{
 for(const changed of [{...timeline,audience:'request_shared' as const},{...timeline,conversationId:'93000000-0000-4000-8000-000000000002'}]){
  let attached=0;
  await assert.rejects(readGenerationHistory(timeline,()=>{attached++;throw Error('unexpected');},async()=>changed,0,signal()),code('RECONNECT_REQUIRED'));
  assert.equal(attached,0);
 }
});

test('unbound successor preserves complete archive, and an empty generation zero never attaches',async()=>{
 const waiting={...timeline,generations:[timeline.generations[0],{generation:1,sessionId:null,terminalTail:null}]};
 const env=environment(waiting),page=await readGenerationHistory(waiting,env.attach,env.check,0,signal());
 assert.equal(page.nextCursor,5);assert.equal(page.hasMore,false);assert.deepEqual(env.attached,['private-old-runtime']);
 const empty={...timeline,generation:0,generations:[{generation:0,sessionId:null,terminalTail:null}]};let checks=0;
 assert.deepEqual(await readGenerationHistory(empty,()=>{throw Error('must not attach');},async()=>{checks++;return empty;},0,signal()),{events:[],nextCursor:0,hasMore:false});assert.equal(checks,2);
});

test('an explicit archive boundary never attaches or waits for the successor',async()=>{
 const env=environment();
 const page=await readGenerationHistory(timeline,env.attach,env.check,1,signal(),{endIndex:3});
 assert.deepEqual(page.events.map(e=>e.cursor),[2,3]);assert.equal(page.hasMore,false);
 assert.deepEqual(env.attached,['private-old-runtime']);
 const atEnd=await readGenerationHistory(timeline,()=>{throw Error('no provider read at boundary');},env.check,5,signal(),{endIndex:5});
 assert.deepEqual(atEnd,{events:[],nextCursor:5,hasMore:false});
 for(const endIndex of [-1,0.5,Number.MAX_SAFE_INTEGER+1,0])
  await assert.rejects(readGenerationHistory(timeline,env.attach,env.check,1,signal(),{endIndex}),code('INVALID_INPUT'));
});

test('byte limit across a generation boundary retains the first unreturned event',async()=>{
 const value={...timeline,generations:[{...timeline.generations[0],terminalTail:0},timeline.generations[1]]};
 const first=fixture([event('message.completed','a'.repeat(650),'first')]),second=fixture([event('message.completed','한'.repeat(220),'second')]);
 const attach=(id:string)=>id===value.generations[0].sessionId?first.session:second.session;
 const a=await readGenerationHistory(value,attach,async()=>value,0,signal(),{maxBytes:1024});
 assert.equal(a.events.length,1);assert.equal(a.nextCursor,1);assert.equal(a.hasMore,true);
 const b=await readGenerationHistory(value,attach,async()=>value,a.nextCursor,signal(),{maxBytes:1024});
 assert.equal(b.events.length,1);assert.equal(b.nextCursor,2);assert.equal(b.hasMore,false);assert.equal('text'in b.events[0]?b.events[0].text:null,'한'.repeat(220));
 const oversized=fixture([event('message.completed','x'.repeat(2000),'large')]);
 await assert.rejects(readGenerationHistory(value,()=>oversized.session,async()=>value,0,signal(),{maxBytes:1024}),code('PROVIDER_UNAVAILABLE'));
});

test('current append growth is read on the next page without extending the captured tail',async()=>{
 const value={...timeline,generation:0,generations:[{generation:0,sessionId:'live',terminalTail:null}]};let grown=false;
 const session={async getStreamTailIndex(){return grown?1:0;},async getEventStream({startIndex}:{startIndex:number}){grown=true;return new ReadableStream({start(c){for(const e of [event('message.completed','one','1'),event('message.completed','two','2')].slice(startIndex))c.enqueue(e);}});}};
 const a=await readGenerationHistory(value,()=>session,async()=>value,0,signal());assert.equal(a.nextCursor,1);assert.equal(a.events.length,1);
 const b=await readGenerationHistory(value,()=>session,async()=>value,a.nextCursor,signal());assert.equal(b.events.length,1);assert.equal(b.events[0].id,'2');
});

test('revocation, audience switches and changed generations discard all buffered output',async()=>{
 for(const mutation of ['revoked','audience','scope','generation']){
  const env=environment();let checks=0;
  await assert.rejects(readGenerationHistory(timeline,env.attach,async()=>{
   if(++checks===1)return timeline;
   if(mutation==='revoked')throw new ApplicationError('FORBIDDEN',403);
   if(mutation==='audience')return {...timeline,audience:'host_private'};
   if(mutation==='scope')return {...timeline,conversationId:'93000000-0000-4000-8000-000000000002'};
   return {...timeline,generation:2,generations:[timeline.generations[0],{...timeline.generations[1],terminalTail:2},{generation:2,sessionId:null,terminalTail:null}]};
  },0,signal()),code(mutation==='revoked'?'FORBIDDEN':'RECONNECT_REQUIRED'));
 }
});

test('invalid ledgers and unsafe logical offsets fail before provider I/O',async()=>{
 for(const value of [
  {...timeline,generations:timeline.generations.slice(1)},
  {...timeline,generations:[{...timeline.generations[0],terminalTail:null},timeline.generations[1]]},
  {...timeline,generations:[timeline.generations[0],{...timeline.generations[1],sessionId:timeline.generations[0].sessionId}]},
  {...timeline,generation:2,generations:[{...timeline.generations[0],terminalTail:Number.MAX_SAFE_INTEGER-1},{generation:1,sessionId:'middle',terminalTail:1},{generation:2,sessionId:null,terminalTail:null}]},
 ]){
  assert.equal(generationTimeline.safeParse(value).success,false);let calls=0;
  await assert.rejects(readGenerationHistory(value,()=>{calls++;throw Error('unexpected');},async()=>value,0,signal()),code('PROVIDER_UNAVAILABLE'));assert.equal(calls,0);
 }
});

test('changed archived tails, truncated streams and malformed metadata never yield partial pages',async()=>{
 for(const mutation of ['initial-tail','final-tail','truncated','metadata','provider']){
  const env=environment();
  if(mutation==='initial-tail')env.a.session.getStreamTailIndex=async()=>5;
  if(mutation==='final-tail'){let reads=0;env.a.session.getStreamTailIndex=async()=>++reads===1?4:5;}
  if(mutation==='truncated')env.a.session.getEventStream=async()=>new ReadableStream({start(c){c.enqueue(old[0]);c.close();}});
  if(mutation==='metadata')env.a.session.getEventStream=async()=>new ReadableStream({start(c){c.enqueue({...old[0],meta:{id:{secret:'private'}}});}});
  if(mutation==='provider')env.a.session.getStreamTailIndex=async()=>{throw Error('private-provider-error');};
  await assert.rejects(readGenerationHistory(timeline,env.attach,env.check,0,signal()),e=>code('PROVIDER_UNAVAILABLE')(e)&&!String(e).includes('private'));
 }
 const env=environment();await assert.rejects(readGenerationHistory(timeline,env.attach,env.check,9,signal()),code('INVALID_INPUT'));
});

test('a single deadline bounds authority, both tails, stream opening and reading',async()=>{
 const pending=()=>new Promise<never>(()=>{}),keepAlive=setTimeout(()=>{},2000);
 try{for(const phase of ['initial-authority','final-authority','current-tail','archived-tail','final-tail','open','read']){
  const env=environment();let checks=0;
  const check=async()=>{checks++;return (phase==='initial-authority'||(phase==='final-authority'&&checks===2))?pending():timeline;};
  if(phase==='current-tail')env.b.session.getStreamTailIndex=pending;
  if(phase==='archived-tail')env.a.session.getStreamTailIndex=pending;
  if(phase==='final-tail'){let calls=0;env.a.session.getStreamTailIndex=async()=>++calls===1?4:pending();}
  if(phase==='open')env.a.session.getEventStream=pending;
  if(phase==='read')env.a.session.getEventStream=async()=>new ReadableStream({cancel:pending});
  await assert.rejects(readGenerationHistory(timeline,env.attach,check,0,signal(),{timeoutMs:10}),code('PROVIDER_UNAVAILABLE'),phase);
 }}finally{clearTimeout(keepAlive);}
});

test('pre-cancelled reads start no I/O and late opened sources are disposed',async()=>{
 const env=environment();let checked=0;
 await assert.rejects(readGenerationHistory(timeline,env.attach,async()=>{checked++;return timeline;},0,AbortSignal.abort()),code('PROVIDER_UNAVAILABLE'));
 assert.equal(checked,0);assert.deepEqual(env.attached,[]);
 let open!:(value:ReadableStream<unknown>)=>void,entered!:()=>void,cancelled=false;
 const ready=new Promise<void>(resolve=>{entered=resolve;}),controller=new AbortController();
 env.a.session.getEventStream=()=>{entered();return new Promise(resolve=>{open=resolve;});};
 const read=readGenerationHistory(timeline,env.attach,env.check,0,controller.signal);
 await ready;controller.abort();await assert.rejects(read,code('PROVIDER_UNAVAILABLE'));
 open(new ReadableStream({cancel(){cancelled=true;}}));await new Promise(resolve=>setTimeout(resolve,1));assert.equal(cancelled,true);
});
