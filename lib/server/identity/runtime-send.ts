import {ApplicationError} from '../errors.ts';
import {Conversations} from './conversations.ts';
import {RuntimeMessages,type RuntimeAuth} from './runtime-messages.ts';
import {RuntimeSuccessors,type SuccessorBootstrap} from './runtime-successors.ts';
import {buildContinuityContext} from './continuity-context.ts';
import type {HistorySession} from './runtime-history.ts';
export type RuntimeSender={
 attach:(id:string)=>HistorySession;
 resolve:(scope:string)=>Promise<{id:string}|undefined>;
 send:(sessionId:string,text:string,auth:RuntimeAuth)=>Promise<void>;
 create:(scope:string,text:string,auth:RuntimeAuth,bootstrap?:SuccessorBootstrap)=>Promise<void>;
};

/** Browser and dispatcher use the same creation fence. A bound session always
 * gets an immutable-ID send; address routing must never replace it implicitly. */
export async function sendRuntimeInput(text:string,auth:RuntimeAuth,runtime:RuntimeSender,signal:AbortSignal,
 messages=new RuntimeMessages(),conversations=new Conversations(),successors=new RuntimeSuccessors()){
 const scope=auth.attributes.conversationId;
 const grant=await conversations.checkExecution(auth.principalId,scope);
 const timeline=await messages.history(grant),current=timeline.generations.at(-1)!;
 const sendBound=async(sessionId:string)=>{
  const owner=await runtime.resolve(scope);
  if(owner?.id!==sessionId)throw new ApplicationError('RECONCILIATION_PENDING',409);
  await runtime.send(sessionId,text,auth);
 };
 if(current.sessionId!==null)return sendBound(current.sessionId);
 if(timeline.generation===0)return runtime.create(scope,text,auth);
 const claim=await successors.claim(auth,timeline.generation);
 if(claim.state==='bound')return sendBound(claim.sessionId!);
 if(claim.state==='creating')throw new ApplicationError('RECONCILIATION_PENDING',409);
 const context=await buildContinuityContext(timeline,runtime.attach,()=>messages.history(grant),signal);
 if(await runtime.resolve(scope))throw new ApplicationError('RECONCILIATION_PENDING',409);
 if(signal.aborted)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
 const started=await successors.start(auth,timeline.generation,claim.leaseToken);
 if(!started.dispatch)throw new ApplicationError('RECONCILIATION_PENDING',409);
 if(started.creationKey!==claim.creationKey)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
 // Do not retry this cold-start send after any error/unknown outcome. Only the
 // original delivery may bind; a future sweep reads its retained state.
 await runtime.create(scope,text,auth,{generation:timeline.generation,creationKey:claim.creationKey,
  messageId:auth.attributes.messageId,context:[...context]});
}
