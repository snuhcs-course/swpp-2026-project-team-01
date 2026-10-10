import type {ModelUsageState} from '../models/session-usage.ts';
import {RuntimeSuccessors,successorBootstrap,type SuccessorBootstrap} from './runtime-successors.ts';
import { ApplicationError } from '../errors.ts';
import { RuntimeMessages, runtimeAuth, type RuntimeAuth } from './runtime-messages.ts';

export type DeliveryState = { modelUsage?:ModelUsageState; seen: Record<string, 'running' | 'completed' | 'failed'>; active: RuntimeAuth | null; successor?:SuccessorBootstrap; continuityApplied?:boolean; replyParts?: Record<string, Record<string,string>> };

// State is checkpointed with eve's turn. A database receipt alone never causes
// an input to be skipped: the runtime may have crashed before its checkpoint.
export async function deliverMessage(currentAuth: unknown, sessionId: string, address: string | undefined,
  state: DeliveryState, messages = new RuntimeMessages(), successors = new RuntimeSuccessors()) {
  const parsed = runtimeAuth.safeParse(currentAuth);
  if (!parsed.success || address !== parsed.data.attributes.conversationId) throw new ApplicationError('UNAUTHORIZED', 401);
  const auth = parsed.data;
  let context:readonly string[]|undefined;
  if(state.successor&&!state.continuityApplied){
    const parsed=successorBootstrap.safeParse(state.successor);
    if(!parsed.success)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
    await successors.bind(auth,sessionId,parsed.data);
    context=parsed.data.context;
  }
  const message = await messages.deliver(auth, sessionId);
  const seen = state.seen[message.id];
  if (seen) {
    if (seen !== 'running') await messages.settle(auth, sessionId, seen, replyText(state,message.id));
    return; // Installed eve 0.71.3 treats an explicit deliver hook's void as ignored.
  }
  state.seen[message.id] = 'running'; state.active = auth;
  if(context)state.continuityApplied=true;
  return { message: message.text, ...(context?{context}:{}) };
}

export async function settleMessage(state: DeliveryState, sessionId: string, status: 'completed' | 'failed', messages = new RuntimeMessages()) {
  if (!state.active) return;
  const id=state.active.attributes.messageId;
  // A later session-failure notification cannot replace a successful result
  // whose database acknowledgment was lost. Replay settles the saved output.
  const result=state.seen[id]==='completed'?'completed':status;
  state.seen[id] = result;
  await messages.settle(state.active, sessionId, result, replyText(state,id));
}

// Captured synchronously in the same checkpoint as the model turn. Only final
// text is eligible; reasoning, tools and interim narration never enter replies.
export function captureReply(state:DeliveryState,text:string,finishReason:string,stepIndex:number,sequence:number){
 if(!state.active||finishReason!=='stop'||!text.trim())return;
 const parts=(state.replyParts??={})[state.active.attributes.messageId]??={};
 parts[`${stepIndex}:${sequence}`]=text;
}

function replyText(state:DeliveryState,id:string){
 const parts=state.replyParts?.[id];return parts?Object.values(parts).join('\n\n'):undefined;
}
