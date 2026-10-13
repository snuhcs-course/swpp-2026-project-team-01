import {z} from 'zod';
import {ApplicationError} from '../errors.ts';
import type {HistorySession} from './runtime-history.ts';

const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const bindingSchema=z.strictObject({sessionId:z.string().min(1).max(200),generation:count});
const usageSchema=z.object({inputTokens:count,outputTokens:count,cacheReadTokens:count,cacheWriteTokens:count});
const failureSchema=z.object({
 type:z.literal('session.failed'),
 data:z.object({sessionId:z.string(),usage:usageSchema}),
 meta:z.object({id:z.string().min(1).max(200)}),
});
export type RuntimeBinding=z.infer<typeof bindingSchema>;
export type TerminalEvidence=RuntimeBinding & {tailIndex:number;eventId:string;usage:z.infer<typeof usageSchema>};
export type TerminalInspection={state:'active'|'unavailable'}|{state:'failed';evidence:TerminalEvidence};

/** Server-only inspection of an exact database-bound session. check() must
 * reauthorize the participant and reread that binding. Null address ownership
 * alone is never terminal evidence. No mutation or successor creation occurs. */
export async function inspectTerminalRuntime(expected:RuntimeBinding,session:HistorySession & {id:string},
 check:()=>Promise<RuntimeBinding>,resolveCurrent:()=>Promise<{id:string}|null>,signal:AbortSignal,
 options:{timeoutMs?:number}={}):Promise<TerminalInspection>{
 const parsed=bindingSchema.safeParse(expected),timeoutMs=options.timeoutMs??5000;
 if(!parsed.success||session.id!==parsed.data.sessionId||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)
  throw new ApplicationError('INVALID_INPUT',400);
 const binding=parsed.data,cancel=AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]);
 let stopped=false,reader:ReadableStreamDefaultReader<unknown>|undefined;
 const unavailable=()=>new ApplicationError('PROVIDER_UNAVAILABLE',503);
 let abort:()=>void=()=>{};
 const interrupted=new Promise<never>((_,reject)=>{
  abort=()=>{stopped=true;void reader?.cancel().catch(()=>{});reject(unavailable());};
  cancel.addEventListener('abort',abort,{once:true});if(cancel.aborted)abort();
 });
 const bounded=<T>(operation:()=>Promise<T>)=>{
  // In particular, an already cancelled request must not start provider I/O.
  if(cancel.aborted)return Promise.reject<T>(unavailable());
  return Promise.race([Promise.resolve().then(()=>{if(cancel.aborted)throw unavailable();return operation();}),interrupted]);
 };
 async function authorize(){
  const current=bindingSchema.safeParse(await bounded(check));
  if(!current.success||current.data.sessionId!==binding.sessionId||current.data.generation!==binding.generation)
   throw new ApplicationError('STALE_REVISION',409);
 }
 async function finish(result:TerminalInspection){await authorize();return result;}
 try{
  // Attach a handler even when cancellation precedes the first bounded call.
  void interrupted.catch(()=>{});
  await authorize();
  const owner=await bounded(resolveCurrent);
  if(owner)return await finish({state:owner.id===binding.sessionId?'active':'unavailable'});
  const tail=await bounded(()=>session.getStreamTailIndex());
  if(!Number.isSafeInteger(tail)||tail< -1||tail>=Number.MAX_SAFE_INTEGER)throw unavailable();
  if(tail===-1)return await finish({state:'unavailable'});
  const opening=()=>session.getEventStream({startIndex:tail}).then(source=>{
   if(stopped){void source.cancel().catch(()=>{});throw unavailable();}
   return source.getReader();
  });
  reader=await bounded(opening);
  const item=await bounded(()=>reader!.read());
  if(item.done)throw unavailable();
  const serialized=JSON.stringify(item.value);
  if(!serialized||Buffer.byteLength(serialized,'utf8')>65_536)throw unavailable();
  const terminal=failureSchema.safeParse(item.value);
  if(!terminal.success||terminal.data.data.sessionId!==binding.sessionId)return await finish({state:'unavailable'});
  // Capture one immutable terminal tail; no earlier failure can authorize
  // replacement if the stream or its channel address has subsequently moved.
  if(await bounded(()=>session.getStreamTailIndex())!==tail||await bounded(resolveCurrent)!==null)
   return await finish({state:'unavailable'});
  return await finish({state:'failed',evidence:{...binding,tailIndex:tail,eventId:terminal.data.meta.id,usage:terminal.data.data.usage}});
 }catch(error){
  if(error instanceof ApplicationError)throw error;
  throw unavailable();
 }finally{
  stopped=true;cancel.removeEventListener('abort',abort);void reader?.cancel().catch(()=>{});
 }
}
