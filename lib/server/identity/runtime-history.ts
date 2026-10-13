import { ApplicationError } from '../errors.ts';
import { projectRuntimeEvent } from './runtime-stream.ts';

/** Only pass a session resolved by the current application authority boundary.
 * Neither session identifiers nor raw runtime events appear in the result. */
export type HistorySession = {
 getStreamTailIndex(): Promise<number>;
 getEventStream(options: {startIndex:number}): Promise<ReadableStream<unknown>>;
};
export async function readRuntimeHistory(session:HistorySession, check:()=>Promise<unknown>, startIndex:number,
 signal:AbortSignal, options:{timeoutMs?:number;maxEvents?:number;maxBytes?:number}={}) {
 const maxEvents=options.maxEvents??100,maxBytes=options.maxBytes??65_536;
 if(!Number.isSafeInteger(startIndex)||startIndex<0||!Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>100
  ||!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>65_536)throw new ApplicationError('INVALID_INPUT',400);
 let reader:ReadableStreamDefaultReader<unknown>|undefined,stopped=false;
 const deadline=AbortSignal.timeout(options.timeoutMs??5000),cancel=AbortSignal.any([signal,deadline]);
 let abort:()=>void=()=>{};
 const interrupted=new Promise<never>((_,reject)=>{
  abort=()=>{stopped=true;void reader?.cancel().catch(()=>{});reject(new ApplicationError('PROVIDER_UNAVAILABLE',503));};
  cancel.addEventListener('abort',abort,{once:true});if(cancel.aborted)abort();
 });
 const bounded=<T>(work:Promise<T>)=>Promise.race([work,interrupted]);
 try{
  await bounded(check());
  const tail=await bounded(session.getStreamTailIndex());
  if(!Number.isSafeInteger(tail)||tail< -1)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  if(startIndex>tail+1)throw new ApplicationError('INVALID_INPUT',400);
  const events:Record<string,unknown>[]=[];let cursor=startIndex,bytes=0;
  if(cursor<=tail){
   const opening=session.getEventStream({startIndex}).then(source=>{
    if(stopped){void source.cancel().catch(()=>{});throw new ApplicationError('PROVIDER_UNAVAILABLE',503);}
    return source.getReader();
   });
   reader=await bounded(opening);
   while(cursor<=tail&&events.length<maxEvents){
    const item=await bounded(reader.read());
    // A premature close is an incomplete read, never a successful empty page.
    if(item.done)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
    const event=projectRuntimeEvent(item.value,cursor+1),size=Buffer.byteLength(JSON.stringify(event),'utf8');
    if(bytes+size>maxBytes){
     if(events.length===0)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
     break; // Do not advance past an event that must be replayed next page.
    }
    events.push(event);bytes+=size;cursor++;
   }
  }
  // Discard the whole buffered page if authority expired or was revoked.
  await bounded(check());
  return {events,nextCursor:cursor,hasMore:cursor<=tail};
 }finally{
  stopped=true;cancel.removeEventListener('abort',abort);void reader?.cancel().catch(()=>{});
 }
}
