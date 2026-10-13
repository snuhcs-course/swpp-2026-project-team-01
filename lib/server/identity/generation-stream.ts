import {conversationEvent} from '../../contracts/conversations.ts';
import {ApplicationError} from '../errors.ts';
import {generationTimeline,projectGenerationEvent,readGenerationHistory,type GenerationTimeline} from './generation-history.ts';
import type {HistorySession} from './runtime-history.ts';
import {authorizedStream} from './runtime-stream.ts';
import {privateHeaders} from './request-credential.ts';
const unavailable=()=>new ApplicationError('PROVIDER_UNAVAILABLE',503);

/** Bounded archive pages followed by the current fixed session's live stream.
 * The live start is the first unread local position, so appends during the
 * handoff are replayed once. A changed ledger closes the response for reconnect. */
export async function generationStream(expected:GenerationTimeline,attach:(id:string)=>HistorySession,
 check:()=>Promise<GenerationTimeline>,startIndex:number,signal:AbortSignal,
 options:{pollMs?:number;leaseMs?:number;openTimeoutMs?:number}={}):Promise<Response>{
 const saved=generationTimeline.parse(expected),signature=JSON.stringify(saved),current=saved.generations.at(-1)!;
 const offset=saved.generations.slice(0,-1).reduce((sum,row)=>sum+row.terminalTail!+1,0);
 const cancelled=new AbortController(),abort=AbortSignal.any([signal,cancelled.signal]);
 const authorize=async()=>{
  const value=await check();
  if(JSON.stringify(generationTimeline.parse(value))!==signature)throw new ApplicationError('RECONNECT_REQUIRED',409);
  return value;
 };
 let page=await readGenerationHistory(saved,attach,authorize,startIndex,abort);
 if(!current.sessionId&&page.events.length===0)return new Response(null,{status:204,headers:privateHeaders});
 let index=0,cursor=startIndex,reader:ReadableStreamDefaultReader<unknown>|undefined,stopped=false;
 const close=()=>{stopped=true;cancelled.abort();void reader?.cancel().catch(()=>{});};
 const source=new ReadableStream<unknown>({
  async pull(controller){
   try{
    if(index===page.events.length&&page.hasMore){
     page=await readGenerationHistory(saved,attach,authorize,cursor,abort);index=0;
    }
    if(stopped)return;
    if(index<page.events.length){const event=page.events[index++];cursor=event.cursor;controller.enqueue(event);return;}
    if(!current.sessionId){controller.close();return;}
    if(!reader){
     // Opening a provider stream is bounded separately from its idle read. The
     // enclosing authorized stream owns idle checks and its 45-second lease.
     const openingAbort=AbortSignal.any([abort,AbortSignal.timeout(options.openTimeoutMs??5000)]);
     let active=true,stopOpening=()=>{};
     const interrupted=new Promise<never>((_,reject)=>{
      stopOpening=()=>{active=false;void reader?.cancel().catch(()=>{});reject(unavailable());};
      openingAbort.addEventListener('abort',stopOpening,{once:true});if(openingAbort.aborted)stopOpening();
     });
     const opening=Promise.resolve().then(()=>{
      if(openingAbort.aborted)throw unavailable();
      return attach(current.sessionId!).getEventStream({startIndex:cursor-offset});
     }).then(stream=>{
      if(!active||stopped){void stream.cancel().catch(()=>{});throw unavailable();}
      reader=stream.getReader();return reader;
     });
     try{reader=await Promise.race([opening,interrupted]);}
     finally{active=false;openingAbort.removeEventListener('abort',stopOpening);}
    }
    if(stopped)return;
    const item=await reader.read();if(stopped)return;
    if(item.done){controller.close();return;}
    if(!Number.isSafeInteger(cursor+1))throw unavailable();
    const event=projectGenerationEvent(item.value,cursor+1,current.generation);
    if(Buffer.byteLength(JSON.stringify(event),'utf8')>65_536)throw unavailable();
    cursor++;controller.enqueue(event);
   }catch(error){if(!stopped)controller.error(error instanceof ApplicationError?error:unavailable());close();}
  },
  cancel(){close();},
 },{highWaterMark:0});
 return authorizedStream(source,authorize,startIndex,signal,{...options,project(value,position){
  const parsed=conversationEvent.safeParse(value);
  if(!parsed.success||parsed.data.type==='error'||parsed.data.cursor!==position)throw unavailable();
  return parsed.data;
 }});
}
