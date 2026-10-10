'use client';
import {useEffect,useRef,useState} from 'react';
import {handoffProof,handoffState} from '../../../lib/contracts/imessage.ts';
import {Button} from './ui/button';

async function entryCall(action:string,input?:unknown){
 let response:Response;try{response=await fetch('/api/browser/imessage-entry/'+action,{method:input===undefined?'GET':'POST',cache:'no-store',
  headers:{'content-type':'application/json'},body:input===undefined?undefined:JSON.stringify(input),signal:AbortSignal.timeout(20_000)});}catch{throw new Error('Open a fresh private link from your iMessage conversation to try again.');}
 if(!response.ok)throw new Error('Open a fresh private link from your iMessage conversation to try again.');
 return response.json();
}
export function IMessageEntry({admitted}:{admitted:boolean}){
 const [message,setMessage]=useState(''),[failed,setFailed]=useState(false);
 const pending=useRef<Promise<unknown>|null>(null);
 useEffect(()=>{
  let active=true,sequence=0;
  function load(){
   const version=++sequence,fragment=new URLSearchParams(location.hash.slice(1)),value=fragment.get('imessage');
   if(value!==null){
    // Clear before any request, state update, sign-in or model activity.
    history.replaceState(history.state,'',location.pathname+location.search);
    const [handoffId,token,...rest]=value.split('.'),proof=handoffProof.safeParse({handoffId,token});
    pending.current=rest.length===0&&proof.success
     ?entryCall('bind',{}).then(()=>entryCall('exchange',proof.data))
     :Promise.reject(new Error('Open a fresh private link from your iMessage conversation to try again.'));
   }else pending.current??=entryCall('read');
   pending.current.then(data=>{
    if(!active||version!==sequence)return;
    const state=data===null?null:handoffState.parse(data);setFailed(false);
    setMessage(state?`Continue linking iMessage ${state.maskedPhone}. Sign in with the Google account your invitation was sent to, then request a fresh code in the original conversation.`:'');
    window.dispatchEvent(new Event('fmat-imessage-entry'));
   }).catch(error=>{if(active&&version===sequence){setFailed(true);setMessage(error instanceof Error?error.message:'Your private link could not be verified.');}});
  }
  load();window.addEventListener('hashchange',load);
  return()=>{active=false;window.removeEventListener('hashchange',load);};
 },[]);
 async function dismiss(){try{await entryCall('clear',{});setMessage('');setFailed(false);pending.current=null;window.dispatchEvent(new Event('fmat-imessage-entry'));}catch{setFailed(true);setMessage('Your continuation could not be cleared. Try again.');}}
 if(!message||admitted&&!failed)return null;
 return <section aria-label="Private iMessage continuation" className="mb-6 flex flex-col gap-3"><p role={failed?'alert':'status'}>{message}</p><Button className="min-h-11" variant="outline" onClick={()=>void dismiss()}>Continue on the web</Button></section>;
}
