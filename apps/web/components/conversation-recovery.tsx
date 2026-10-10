'use client';
import type {useConversationRecovery} from '../lib/use-conversation-recovery.ts';
import {useRef} from 'react';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';
import {Button} from './ui/button';

export function ConversationRecoveryCard({recovery,pendingMessages,onContinue}:{recovery:ReturnType<typeof useConversationRecovery>;pendingMessages:{id:string;text:string}[];onContinue:()=>void}){
 const check=useRef<HTMLButtonElement>(null);
 const state=recovery.status?.state;
 if(!recovery.error&&!recovery.retry&&(!state||state==='active'))return null;
 const title=state==='recovery_required'?'Conversation needs recovery':state==='recovering'?'Conversation recovery is ready':state==='limit_reached'?'Conversation limit reached':'Conversation recovery';
 const description=recovery.error||(state==='recovery_required'?'The assistant stopped before it could continue. Recover this conversation to keep the same discussion and saved changes.':state==='recovering'?(pendingMessages.length?'Your saved input is waiting to continue with its original access. Recovery does not approve or book a meeting.':'You can continue with a new message. Your earlier discussion and saved changes are preserved.'):state==='limit_reached'?'This conversation has reached its model allowance. Your history and meeting controls remain available.':'The assistant’s state cannot be confirmed yet. Check again; your history and meeting controls remain available.');
 return <Alert aria-label="Conversation recovery">
  <AlertTitle>{title}</AlertTitle><AlertDescription>
   <p>{description}</p>
   {pendingMessages.length?<details><summary>Saved pending messages</summary>{pendingMessages.map(message=><p key={message.id} className="chat-text">{message.text}</p>)}</details>:null}
  </AlertDescription>
  <div className="flex flex-wrap gap-2">
   {state==='recovery_required'||recovery.retry?<Button className="min-h-11" disabled={recovery.busy} onClick={async()=>{await recovery.recover();onContinue();if(document.activeElement===document.body)check.current?.focus();}}>{recovery.retry?'Retry same recovery':'Recover conversation'}</Button>:null}
   <Button ref={check} className="min-h-11" variant="outline" disabled={recovery.busy} onClick={()=>void recovery.check()}>Check recovery status</Button>
  </div>
 </Alert>;
}
