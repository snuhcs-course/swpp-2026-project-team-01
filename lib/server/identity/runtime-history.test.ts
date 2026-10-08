import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readRuntimeHistory,type HistorySession} from './runtime-history.ts';
import {ApplicationError} from '../errors.ts';
const signal=()=>new AbortController().signal;
function fixture(events:unknown[],tail=events.length-1):HistorySession{
 return {async getStreamTailIndex(){return tail;},async getEventStream({startIndex}){
  return new ReadableStream({start(c){for(const event of events.slice(startIndex))c.enqueue(event);c.close();}});
 }};
}
const text=(message:string)=>({type:'message.completed',data:{message}});
test('history stops at its captured durable tail and resumes without skipping events',async()=>{
 const session=fixture([text('one'),{type:'reasoning.completed',data:{message:'SECRET'}},text('two'),text('new live event')],2);
 const a=await readRuntimeHistory(session,async()=>{},0,signal(),{maxEvents:2});
 assert.equal(a.nextCursor,2);assert.equal(a.hasMore,true);assert.doesNotMatch(JSON.stringify(a),/SECRET/);
 const b=await readRuntimeHistory(session,async()=>{},a.nextCursor,signal());
 assert.equal(b.events.length,1);assert.equal(b.events[0]?.text,'two');assert.equal(b.hasMore,false);
});
test('byte boundary replays the unreturned event rather than losing text',async()=>{
 const session=fixture([text('a'.repeat(650)),text('b'.repeat(650))]);
 const a=await readRuntimeHistory(session,async()=>{},0,signal(),{maxBytes:1024});
 assert.equal(a.nextCursor,1);assert.equal(a.hasMore,true);
 const b=await readRuntimeHistory(session,async()=>{},a.nextCursor,signal(),{maxBytes:1024});assert.equal(b.events[0]?.text,'b'.repeat(650));
 await assert.rejects(readRuntimeHistory(fixture([text('x'.repeat(2000))]),async()=>{},0,signal(),{maxBytes:1024}),ApplicationError);
});
test('revocation at final check discards every buffered event, including empty pages',async()=>{
 for(const session of [fixture([text('private')]),fixture([])]){
  let checked=0;await assert.rejects(readRuntimeHistory(session,async()=>{if(++checked===2)throw new ApplicationError('FORBIDDEN',403);},0,signal()),e=>e instanceof ApplicationError&&e.status===403);
 }
});
test('invalid cursors and truncated streams fail without returning partial history',async()=>{
 await assert.rejects(readRuntimeHistory(fixture([]),async()=>{},1,signal()),e=>e instanceof ApplicationError&&e.status===400);
 await assert.rejects(readRuntimeHistory(fixture([text('partial')],4),async()=>{},0,signal()),ApplicationError);
});
test('abort bounds idle reads and cancels the source without awaiting provider cleanup',async()=>{
 let cancelled=false;const controller=new AbortController();
 const session:HistorySession={async getStreamTailIndex(){return 1;},async getEventStream(){return new ReadableStream({cancel(){cancelled=true;return new Promise(()=>{});}});}};
 const reading=readRuntimeHistory(session,async()=>{},0,controller.signal);
 setTimeout(()=>controller.abort(),10);
 await assert.rejects(reading,ApplicationError);assert.equal(cancelled,true);
});
test('late stream opening after cancellation is disposed and authority checks are deadline-bounded',async()=>{
 let resolve!:(s:ReadableStream<unknown>)=>void,cancelled=false;
 const controller=new AbortController();
 const session:HistorySession={async getStreamTailIndex(){return 0;},getEventStream(){return new Promise(r=>{resolve=r;});}};
 const reading=readRuntimeHistory(session,async()=>{},0,controller.signal);
 await new Promise(r=>setTimeout(r,1));controller.abort();await assert.rejects(reading,ApplicationError);
 resolve(new ReadableStream({cancel(){cancelled=true;}}));await new Promise(r=>setTimeout(r,1));assert.equal(cancelled,true);
 // Keep the test event loop alive while AbortSignal.timeout's unref timer runs.
 const keepAlive=setTimeout(()=>{},1000);
 try{await assert.rejects(readRuntimeHistory(fixture([]),()=>new Promise(()=>{}),0,signal(),{timeoutMs:10}),ApplicationError);}
 finally{clearTimeout(keepAlive);}
});
