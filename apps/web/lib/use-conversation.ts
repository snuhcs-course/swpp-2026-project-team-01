'use client';
import { useEffect, useRef, useState } from 'react';
import { conversationEvent, conversationSnapshot, conversationView, incomingMessage, messageReceipt, type ConversationSnapshot } from '../../../lib/contracts/conversations.ts';
import {conversationJson as json,conversationSendFailure} from './conversation-transport.ts';
import { emptyTranscript, reduceConversation } from './conversation-state.ts';

export type ChatTarget={audience:'host_setup'}|{audience:'request_shared'|'host_private';requestId:string;guest?:boolean};
type Failure=Error&{status?:number};
function accessLost(error:unknown){return [401,403,404].includes((error as Failure)?.status??0);}
function wait(ms:number,signal:AbortSignal,wake:{current:()=>void}) {
  return new Promise<void>(resolve=>{const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};const timer=setTimeout(finish,ms);wake.current=finish;signal.addEventListener('abort',finish,{once:true});if(signal.aborted)finish();});
}

export function useConversation(target:ChatTarget,onAccessLost:()=>void) {
  const audience=target.audience,requestId='requestId' in target?target.requestId:undefined,guest='guest' in target&&target.guest;
  const [transcript,setTranscript]=useState(emptyTranscript),[snapshot,setSnapshot]=useState<ConversationSnapshot|null>(null);
  const [error,setError]=useState(''),[sendError,setSendError]=useState(''),[sending,setSending]=useState(false),[denied,setDenied]=useState(false);
  const state=useRef(emptyTranscript()),scope=useRef(''),lifetime=useRef<AbortController|null>(null),wake=useRef(()=>{}),interruptRead=useRef(()=>{});
  const frozen=useRef<{clientId:string;text:string}|null>(null),inFlight=useRef(false),onDenied=useRef(onAccessLost);onDenied.current=onAccessLost;
  const query=guest?'?requestId='+encodeURIComponent(requestId!):'';
  function deny(){lifetime.current?.abort();scope.current='';setSending(false);state.current=emptyTranscript();setTranscript(state.current);setSnapshot(null);setDenied(true);frozen.current=null;setSendError('');setError('Your conversation access has ended.');onDenied.current();}
  useEffect(()=>{
    const controller=new AbortController(),signal=controller.signal;lifetime.current=controller;
    state.current=emptyTranscript();setTranscript(state.current);setSnapshot(null);setDenied(false);setError('');setSendError('');setSending(false);scope.current='';frozen.current=null;
    async function refresh(readSignal:AbortSignal){const data=conversationSnapshot.parse(await json('/api/browser/conversations/'+scope.current+query,readSignal));if(!signal.aborted&&!readSignal.aborted)setSnapshot(data);return data;}
    async function run(){
      while(!signal.aborted){
        const connection=new AbortController(),readSignal=AbortSignal.any([signal,connection.signal]);
        interruptRead.current=()=>{connection.abort();wake.current();};
        try{
          if(!scope.current){const opened=conversationView.parse(await json('/api/browser/conversations'+query,readSignal,{audience,...(requestId?{requestId}:{})}));if(signal.aborted)return;scope.current=opened.conversationId;}
          const latest=await refresh(readSignal);setError('');
          if(latest.messages.length===0){await wait(10_000,signal,wake);continue;}
          const url='/api/browser/conversations/'+scope.current+'/stream'+query+(query?'&':'?')+'cursor='+state.current.cursor;
          const response=await fetch(url,{signal:AbortSignal.any([readSignal,AbortSignal.timeout(60_000)]),cache:'no-store'});
          if(!response.ok){const data=await response.json();throw Object.assign(new Error(data.error?.message??'The connection was interrupted.'),{status:response.status});}
          if(response.status===204){await wait(1000,signal,wake);continue;}
          const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='';
          try{
            for(;;){
              const item=await reader.read();if(signal.aborted)return;if(item.done)break;
              buffer+=decoder.decode(item.value,{stream:true});if(buffer.length>1_000_000)throw new Error('The response could not be displayed.');
              let newline:number;
              while((newline=buffer.indexOf('\n'))>=0){
                const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(!line)continue;
                const event=conversationEvent.parse(JSON.parse(line));
                if(event.type==='error')throw Object.assign(new Error(event.error.message),{status:['UNAUTHORIZED','FORBIDDEN','NOT_FOUND'].includes(event.error.code)?403:503});
                state.current=reduceConversation(state.current,event);if(signal.aborted)return;setTranscript(state.current);
                if(event.type==='failed')setError('The response could not be completed. Your saved changes are preserved.');
                if(['turn.completed','turn.cancelled','session.waiting','session.completed','failed'].includes(event.type))await refresh(readSignal);
              }
            }
          }finally{await reader.cancel().catch(()=>{});}
          // Reconnect with the last fully parsed cursor; partial lines are replayed.
          await wait(500,signal,wake);
        }catch(cause){
          if(signal.aborted)return;
          if(connection.signal.aborted)continue;
          if(accessLost(cause)){deny();return;}
          setError('The connection was interrupted. Reconnecting to your saved conversation…');
          await wait(3000,signal,wake);
        }
      }
    }
    void run();return()=>{controller.abort();scope.current='';interruptRead.current=()=>{};};
  },[audience,requestId,guest]);

  async function send(text:string) {
    const controller=lifetime.current;if(inFlight.current||!scope.current||!controller||controller.signal.aborted||denied)return false;
    frozen.current??=incomingMessage.parse({clientId:crypto.randomUUID(),text});
    inFlight.current=true;setSending(true);setSendError('');
    try{
      const submitted=frozen.current;
      const receipt=messageReceipt.parse(await json('/api/browser/conversations/'+scope.current+'/messages'+query,controller.signal,submitted));
      if(controller.signal.aborted)return false;
      frozen.current=null;
      // The receipt confirms acceptance. A later snapshot/network failure must
      // never turn this into a fresh-ID retry of an already accepted message.
      setSnapshot(previous=>previous?{...previous,messages:previous.messages.some(m=>m.id===receipt.messageId)
        ?previous.messages.map(m=>m.id===receipt.messageId?{...m,status:receipt.status}:m)
        :[...previous.messages,{id:receipt.messageId,text:submitted.text,status:receipt.status,createdAt:new Date().toISOString(),mine:true}]}:previous);
      wake.current();return true;
    }catch(cause){
      if(controller.signal.aborted)return false;
      if(accessLost(cause))deny();
      else setSendError(conversationSendFailure(cause));
      return false;
    }finally{inFlight.current=false;if(!controller.signal.aborted)setSending(false);}
  }
  return {messages:transcript.messages,working:transcript.working||snapshot?.messages.some(m=>m.status==='pending')===true,
    ready:!!snapshot&&!denied,error,sendError,sending,denied,send,reconnect:()=>interruptRead.current()};
}
