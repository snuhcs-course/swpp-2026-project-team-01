'use client';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowUpIcon, RefreshCwIcon } from 'lucide-react';
import { useConversation, type ChatTarget } from '../lib/use-conversation.ts';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Field, FieldGroup, FieldLabel, FieldDescription } from './ui/field';
import { Alert, AlertTitle, AlertDescription } from './ui/alert';
import { Message, MessageContent, MessageHeader } from './ui/message';
import { Bubble, BubbleContent } from './ui/bubble';
import { MessageScrollerProvider, MessageScroller, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem, MessageScrollerButton } from './ui/message-scroller';
import { Suggestion, Suggestions } from './ai-elements/suggestion';

export function ConversationWorkspace({target,onAccessLost}:{target:ChatTarget;onAccessLost:()=>void}) {
  const chat=useConversation(target,onAccessLost),[draft,setDraft]=useState(''),id=useId(),input=useRef<HTMLTextAreaElement>(null);
  const host=target.audience==='host_setup';
  useEffect(()=>{if(chat.denied)setDraft('');},[chat.denied]);
  async function submit(event?:FormEvent){event?.preventDefault();if(!draft.trim()||draft.length>10_000)return;if(await chat.send(draft)){setDraft('');input.current?.focus();}}
  return <div className="conversation-workspace">
    <MessageScrollerProvider autoScroll>
      <MessageScroller>
        <MessageScrollerViewport aria-label="Conversation">
          <MessageScrollerContent className="p-2 md:p-4">
            <MessageScrollerItem messageId="welcome">
              <Alert><AlertTitle>{host?'A place to plan your meetings':'Let’s work out the details'}</AlertTitle><AlertDescription>{host?'Tell me about the meetings you want to make room for. Calendar connection and settings review are the next steps being added.':'Share your purpose, availability and meeting preferences. Details can be saved here; proposal and booking controls are still being added.'}</AlertDescription></Alert>
            </MessageScrollerItem>
            {chat.messages.map(message=><MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={message.role==='user'}>
              <Message align={message.role==='user'?'end':'start'}><MessageContent><MessageHeader>{message.role==='user'?(target.audience==='request_shared'?'Meeting participant':'You'):'Find Me a Time'}</MessageHeader><Bubble variant={message.role==='user'?'secondary':'ghost'} align={message.role==='user'?'end':'start'}><BubbleContent><span className="chat-text">{message.text}</span></BubbleContent></Bubble></MessageContent></Message>
            </MessageScrollerItem>)}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton aria-label="Jump to latest message"/>
      </MessageScroller>
    </MessageScrollerProvider>
    <div className="conversation-controls">
      {chat.error?<Alert><AlertTitle>Conversation connection</AlertTitle><AlertDescription>{chat.error}</AlertDescription>{!chat.denied?<Button variant="ghost" onClick={chat.reconnect}><RefreshCwIcon data-icon="inline-start"/>Reconnect now</Button>:null}</Alert>:null}
      {chat.sendError?<Alert variant="destructive"><AlertTitle>Message needs a retry</AlertTitle><AlertDescription>{chat.sendError}</AlertDescription><Button variant="outline" disabled={chat.sending||chat.denied} onClick={()=>void submit()}>Retry same message</Button></Alert>:null}
      {!chat.messages.length&&!draft&&!chat.denied?<Suggestions>{(host?['Help me set up my meetings','What can you help me with?']:['I’d like to share my availability','What details do you need?']).map(suggestion=><Suggestion key={suggestion} suggestion={suggestion} onClick={text=>{setDraft(text);input.current?.focus();}}/>)}</Suggestions>:null}
      <form onSubmit={submit}>
        <FieldGroup><Field data-disabled={!chat.ready||chat.sending||!!chat.sendError}>
          <FieldLabel htmlFor={id}>Message your scheduling assistant</FieldLabel>
          <Textarea id={id} ref={input} value={draft} maxLength={10_000} placeholder={host?'Tell me what a good meeting week looks like…':'Share what you have in mind…'}
            disabled={!chat.ready||chat.sending||!!chat.sendError} onChange={e=>setDraft(e.target.value)}
            onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!chat.working&&!chat.sending&&!chat.sendError)void submit();}}}/>
          <div className="composer-actions"><FieldDescription>Enter to send · Shift + Enter for a new line</FieldDescription><Button type="submit" size="lg" disabled={!chat.ready||chat.working||chat.sending||!!chat.sendError||!draft.trim()}>Send<ArrowUpIcon data-icon="inline-end"/></Button></div>
        </Field></FieldGroup>
      </form>
      <p className="conversation-status" role="status">{chat.denied?'Access ended.':chat.sending?'Sending your message…':chat.working?'Your message is saved. The assistant is responding…':chat.ready?'Your conversation is saved. Approval and booking always need confirmed actions.':'Opening your private conversation…'}</p>
    </div>
  </div>;
}
