import {z} from 'zod';
import {conversationAudience,conversationEvent,type ConversationEvent} from '../../contracts/conversations.ts';
import {ApplicationError} from '../errors.ts';
import type {HistorySession} from './runtime-history.ts';
import {projectRuntimeEvent} from './runtime-stream.ts';

const integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const generation=z.strictObject({generation:integer,sessionId:z.string().min(1).max(200).nullable(),
 terminalTail:integer.max(Number.MAX_SAFE_INTEGER-1).nullable()});
// Internal only. The resolver must authorize the conversation/audience and read
// this complete ledger from SQL; never build it from browser or model input.
export const generationTimeline=z.strictObject({conversationId:z.uuid(),audience:conversationAudience,
 generation:integer,generations:z.array(generation).min(1)}).superRefine((value,ctx)=>{
 const ids=new Set<string>();let offset=0;
 if(value.generations.length!==value.generation+1)ctx.addIssue({code:'custom',message:'Incomplete generation history'});
 for(const [index,row] of value.generations.entries()){
  const current=index===value.generation;
  if(row.generation!==index||(!current&&(row.sessionId===null||row.terminalTail===null))||(current&&row.terminalTail!==null))
   ctx.addIssue({code:'custom',message:'Invalid generation position'});
  if(row.sessionId!==null){if(ids.has(row.sessionId))ctx.addIssue({code:'custom',message:'Reused runtime identity'});ids.add(row.sessionId);}
  if(!current){offset+=(row.terminalTail??0)+1;if(!Number.isSafeInteger(offset))ctx.addIssue({code:'custom',message:'Unsafe logical cursor'});}
 }
});
export type GenerationTimeline=z.infer<typeof generationTimeline>;
export type HistoryPage={events:Exclude<ConversationEvent,{type:'error'}>[];nextCursor:number;hasMore:boolean};
const unavailable=()=>new ApplicationError('PROVIDER_UNAVAILABLE',503);
/** Eve turn IDs are session-local. Keep generation zero compatible and give
 * successor turns stable logical identities without exposing runtime IDs. */
export function projectGenerationEvent(value:unknown,cursor:number,generation:number):HistoryPage['events'][number]{
 const projected=projectRuntimeEvent(value,cursor);
 if(generation>0&&typeof projected.turnId==='string')projected.turnId=`g${generation}:${projected.turnId}`;
 const parsed=conversationEvent.safeParse(projected);
 if(!parsed.success||parsed.data.type==='error')throw unavailable();
 return parsed.data;
}
function timeline(value:unknown):GenerationTimeline{
 const parsed=generationTimeline.safeParse(value);if(!parsed.success)throw unavailable();return parsed.data;
}
function positions(value:GenerationTimeline){
 let offset=0;
 return value.generations.map(row=>{const start=offset;if(row.terminalTail!==null)offset+=row.terminalTail+1;return {...row,offset:start};});
}

/** Translate an already decrypted old session-local cursor. Its encryption
 * context must still bind grant, audience and target, and expiry must be checked
 * by the caller. Generation-zero cursors retain their exact numeric position. */
export function legacyHistoryPosition(value:GenerationTimeline,sessionId:string,position:number):number{
 const rows=positions(timeline(value)),row=rows.find(item=>item.sessionId===sessionId);
 if(!Number.isSafeInteger(position)||position<0||!row
  ||(row.terminalTail!==null&&position>row.terminalTail+1)||!Number.isSafeInteger(row.offset+position))
  throw new ApplicationError('INVALID_INPUT',400);
 return row.offset+position;
}

/** One bounded logical history page across immutable retired tails and one
 * captured current tail. check() reauthorizes and rereads the same scoped ledger.
 * Identity changes discard the page; ordinary append-only current growth does
 * not. Returned events preserve original IDs and use logical cursor positions. */
export async function readGenerationHistory(expected:GenerationTimeline,attach:(id:string)=>HistorySession,
 check:()=>Promise<GenerationTimeline>,startIndex:number,signal:AbortSignal,
 options:{timeoutMs?:number;maxEvents?:number;maxBytes?:number;endIndex?:number}={}):Promise<HistoryPage>{
 const saved=timeline(expected),rows=positions(saved),signature=JSON.stringify(saved);
 const timeout=options.timeoutMs??5000,maxEvents=options.maxEvents??100,maxBytes=options.maxBytes??65_536;
 if(!Number.isSafeInteger(startIndex)||startIndex<0||!Number.isInteger(timeout)||timeout<1||timeout>5000
  ||!Number.isInteger(maxEvents)||maxEvents<1||maxEvents>100||!Number.isInteger(maxBytes)||maxBytes<1024||maxBytes>65_536
  ||(options.endIndex!==undefined&&(!Number.isSafeInteger(options.endIndex)||options.endIndex<startIndex)))
  throw new ApplicationError('INVALID_INPUT',400);
 const cancel=AbortSignal.any([signal,AbortSignal.timeout(timeout)]);
 let reader:ReadableStreamDefaultReader<unknown>|undefined,stopped=false,abort=()=>{};
 const interrupted=new Promise<never>((_,reject)=>{
  abort=()=>{stopped=true;void reader?.cancel().catch(()=>{});reject(unavailable());};
  cancel.addEventListener('abort',abort,{once:true});if(cancel.aborted)abort();
 });
 void interrupted.catch(()=>{});
 const bounded=<T>(work:()=>Promise<T>)=>{
  if(cancel.aborted)return Promise.reject<T>(unavailable());
  return Promise.race([Promise.resolve().then(()=>{if(cancel.aborted)throw unavailable();return work();}),interrupted]);
 };
 const authorize=async()=>{
  if(JSON.stringify(timeline(await bounded(check)))!==signature)throw new ApplicationError('RECONNECT_REQUIRED',409);
 };
 const validTail=(value:number)=>{if(!Number.isSafeInteger(value)||value< -1||value>=Number.MAX_SAFE_INTEGER)throw unavailable();return value;};
 try{
  await authorize();
  const current=rows.at(-1)!;
  const live=current.sessionId===null||(options.endIndex!==undefined&&options.endIndex<=current.offset)?undefined:attach(current.sessionId);
  const liveTail=live?validTail(await bounded(()=>live.getStreamTailIndex())):-1;
  const end=Math.min(current.offset+liveTail+1,options.endIndex??Number.MAX_SAFE_INTEGER);
  if(!Number.isSafeInteger(end))throw unavailable();
  if(startIndex>end)throw new ApplicationError('INVALID_INPUT',400);
  const events:HistoryPage['events']=[];let cursor=startIndex,bytes=0,full=false;
  for(const row of rows){
   const tail=row.terminalTail??liveTail,limit=Math.min(row.offset+tail+1,end);
   if(cursor>=limit||cursor<row.offset||row.sessionId===null)continue;
   if(events.length>=maxEvents||full)break;
   const session=row.terminalTail===null?live!:attach(row.sessionId);
   if(row.terminalTail!==null&&validTail(await bounded(()=>session.getStreamTailIndex()))!==tail)throw unavailable();
   const opening=()=>session.getEventStream({startIndex:cursor-row.offset}).then(source=>{
    if(stopped){void source.cancel().catch(()=>{});throw unavailable();}return source.getReader();
   });
   reader=await bounded(opening);
   while(cursor<limit&&events.length<maxEvents){
    const item=await bounded(()=>reader!.read());if(item.done)throw unavailable();
    const event=projectGenerationEvent(item.value,cursor+1,row.generation),size=Buffer.byteLength(JSON.stringify(event),'utf8');
    if(bytes+size>maxBytes){if(events.length===0)throw unavailable();full=true;break;}
    events.push(event);bytes+=size;cursor++;
   }
   void reader.cancel().catch(()=>{});reader=undefined;
   // Retired streams must retain the finalized tail, even across a read.
   if(row.terminalTail!==null&&validTail(await bounded(()=>session.getStreamTailIndex()))!==tail)throw unavailable();
  }
  await authorize();
  return {events,nextCursor:cursor,hasMore:cursor<end};
 }catch(error){
  if(error instanceof ApplicationError)throw error;
  throw unavailable();
 }finally{stopped=true;cancel.removeEventListener('abort',abort);void reader?.cancel().catch(()=>{});}
}
