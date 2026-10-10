import type { ConversationEvent } from '../../../lib/contracts/conversations.ts';

export type ChatMessage={id:string;role:'user'|'assistant';text:string;complete:boolean};
export type Transcript={cursor:number;messages:ChatMessage[];working:boolean};
export const emptyTranscript=():Transcript=>({cursor:0,messages:[],working:false});

// Cursor deduplication applies before deltas. Final blocks replace provisional
// text; rendering a reconnect must never append the same assistant text twice.
export function reduceConversation(state:Transcript,event:ConversationEvent):Transcript {
  if(event.type==='error'||event.cursor<=state.cursor)return state;
  const next={...state,cursor:event.cursor};
  if(['turn.started','step.started'].includes(event.type))next.working=true;
  if(['turn.completed','turn.cancelled','session.waiting','session.completed','failed'].includes(event.type))next.working=false;
  if(event.type!=='user'&&event.type!=='text'&&event.type!=='message')return next;
  if(!event.turnId)return next;
  const id=event.type==='user'?`user:${event.turnId}:${event.sequence??0}`:`assistant:${event.turnId}:${event.stepIndex??0}`;
  const index=state.messages.findIndex(m=>m.id===id),previous=state.messages[index];
  const message:ChatMessage={id,role:event.type==='user'?'user':'assistant',
    text:event.type==='text'?(previous?.text??'')+event.text:event.text,complete:event.type!=='text'};
  // Bound rendered history without accepting unbounded provider output.
  if(message.text.length>200_000)throw new Error('Conversation output exceeds its display limit.');
  next.messages=index<0?[...state.messages,message]:state.messages.map((m,i)=>i===index?message:m);
  return next;
}
