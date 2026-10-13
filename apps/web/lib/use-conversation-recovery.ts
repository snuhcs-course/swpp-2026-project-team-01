'use client';
import {useEffect,useRef,useState} from 'react';
import {ConversationRecoveryClient,type RecoveryView} from './conversation-recovery-client.ts';

const initial:RecoveryView={status:null,retry:false,busy:false,error:''};
export function useConversationRecovery(scope:string|undefined,query:string,onDenied:()=>void,onChanged:()=>void){
 const [view,setView]=useState(initial),client=useRef<ConversationRecoveryClient|null>(null);
 const callbacks=useRef({onDenied,onChanged});callbacks.current={onDenied,onChanged};
 useEffect(()=>{
  setView(initial);if(!scope)return;
  let generation:number|undefined;
  const current=new ConversationRecoveryClient(scope,query,()=>window.sessionStorage,next=>{
   setView(next);
   if(next.status&&generation!==undefined&&next.status.generation>generation)callbacks.current.onChanged();
   if(next.status)generation=next.status.generation;
  },()=>callbacks.current.onDenied());client.current=current;
  void current.inspect();
  const timer=setInterval(()=>void current.inspect(),10_000),focus=()=>void current.inspect();
  window.addEventListener('focus',focus);
  return()=>{current.stop();clearInterval(timer);window.removeEventListener('focus',focus);if(client.current===current)client.current=null;};
 },[scope,query]);
 return {...view,check:()=>client.current?.inspect(),recover:()=>client.current?.recover()};
}
