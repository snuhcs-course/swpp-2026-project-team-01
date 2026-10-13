import {z} from 'zod';
import {conversationModelContext} from '../../contracts/conversation-tools.ts';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {runtimeAuth} from './runtime-messages.ts';
import {generationTimeline,type GenerationTimeline} from './generation-history.ts';
import {readContinuityPage,continuityNotice} from './continuity-context.ts';
import type {HistorySession} from './runtime-history.ts';

export const modelHistoryInput=z.strictObject({cursor:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0)});
export type ArchiveStream=(sessionId:string,options:{startIndex:number;follow:false;signal:AbortSignal})=>AsyncIterable<unknown>;
const unavailable=()=>new ApplicationError('PROVIDER_UNAVAILABLE',503);

/** Adapt the public eve/server iterator, using only server-resolved retired
 * identities. A bounded terminal probe proves the saved tail is still exact. */
export function retiredHistorySessions(timeline:GenerationTimeline,stream:ArchiveStream,signal:AbortSignal):(id:string)=>HistorySession {
 return id=>{
  const row=timeline.generations.find(row=>row.sessionId===id&&row.terminalTail!==null);
  if(!row)throw new ApplicationError('FORBIDDEN',403);
  const open=(startIndex:number)=>{
   const stop=new AbortController(),cancel=AbortSignal.any([signal,stop.signal]);
   const iterator=stream(id,{startIndex,follow:false,signal:cancel})[Symbol.asyncIterator]();
   const close=()=>{cancel.removeEventListener('abort',close);stop.abort();void iterator.return?.().catch(()=>{});};
   cancel.addEventListener('abort',close,{once:true});if(cancel.aborted)close();
   return {iterator,close};
  };
  return {
   async getStreamTailIndex(){
    const {iterator,close}=open(row.terminalTail!);
    try{
     const last=await iterator.next(),extra=await iterator.next();
     const terminal=z.object({type:z.literal('session.failed'),data:z.object({sessionId:z.literal(id)})}).safeParse(last.value);
     if(last.done||!extra.done||!terminal.success)throw unavailable();
     return row.terminalTail!;
    }finally{close();}
   },
   async getEventStream({startIndex}){
    const {iterator,close}=open(startIndex);
    return new ReadableStream<unknown>({
     async pull(controller){try{const part=await iterator.next();if(part.done){controller.close();close();}else controller.enqueue(part.value);}catch(error){controller.error(error);close();}},
     cancel:close,
    });
   },
  };
 };
}

export class ModelHistory {
 constructor(private readonly database=new Database()){}
 async read(currentAuth:unknown,sessionId:string,input:unknown,stream:ArchiveStream,signal:AbortSignal){
  const auth=runtimeAuth.safeParse(currentAuth),query=modelHistoryInput.safeParse(input);
  if(!auth.success)throw new ApplicationError('UNAUTHORIZED',401);
  if(!query.success||!sessionId||sessionId.length>200)throw new ApplicationError('INVALID_INPUT',400);
  const cancel=AbortSignal.any([signal,AbortSignal.timeout(5000)]);
  let abort=()=>{};
  const interrupted=new Promise<never>((_,reject)=>{abort=()=>reject(unavailable());cancel.addEventListener('abort',abort,{once:true});if(cancel.aborted)abort();});
  void interrupted.catch(()=>{});
  const bounded=<T>(work:()=>Promise<T>)=>cancel.aborted?Promise.reject<T>(unavailable()):Promise.race([Promise.resolve().then(()=>{if(cancel.aborted)throw unavailable();return work();}),interrupted]);
  const parameters={p_grant_id:auth.data.principalId,p_conversation_id:auth.data.attributes.conversationId};
  const check=async()=>{
   const context=conversationModelContext.parse(await bounded(()=>this.database.rpc('fmat_conversation_tool',{
    ...parameters,p_session_id:sessionId,p_operation:'context_read',p_input:{},
   })));
   const value=generationTimeline.parse(await bounded(()=>this.database.rpc('fmat_runtime_message',{
    ...parameters,p_operation:'history',p_input:{},
   })));
   if(value.conversationId!==parameters.p_conversation_id||value.audience!==context.audience)throw unavailable();
   if(value.generations.at(-1)!.sessionId!==sessionId)throw new ApplicationError('FORBIDDEN',403);
   return value;
  };
  try{
   const timeline=await check();
   const page=await readContinuityPage(timeline,retiredHistorySessions(timeline,stream,cancel),check,query.data.cursor,cancel);
   const result={notice:continuityNotice,...page};
   if(Buffer.byteLength(JSON.stringify(result),'utf8')>65_536)throw unavailable();
   return result;
  }catch(error){if(error instanceof ApplicationError)throw error;throw unavailable();}
  finally{cancel.removeEventListener('abort',abort);}
 }
}
