'use client';
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {ChatMessage} from './chat-message';
import {hasSeenMessage,rememberMessage} from '../lib/seen-messages';
export const AuthoredMessageScope=createContext<string|undefined>(undefined);
const seenInMemory=new Set<string>();

/** Authored prose streams once per conversation; generated replies use the server stream. */
export function StreamingChatMessage({text,onComplete,children,continuation=false}:{text:string;onComplete?:()=>void;children?:ReactNode;continuation?:boolean}){
 const scope=useContext(AuthoredMessageScope),[length,setLength]=useState(0),callback=useRef(onComplete);
 callback.current=onComplete;
 useEffect(()=>{
  let active=true,timer:ReturnType<typeof setInterval>|undefined;setLength(0);
  if(!scope)return;
  void (async()=>{
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
   const fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),key=scope+':'+fingerprint;
   if(!active)return;
   let stored=false;try{stored=hasSeenMessage(localStorage,scope,fingerprint);}catch{/* Private browsing may disable storage. */}
   const finish=()=>{seenInMemory.add(key);try{rememberMessage(localStorage,scope,fingerprint);}catch{}setLength(text.length);callback.current?.();};
   if(seenInMemory.has(key)||stored||matchMedia('(prefers-reduced-motion: reduce)').matches){finish();return;}
   let length=0;timer=setInterval(()=>{length=Math.min(text.length,length+3);setLength(length);if(length===text.length){clearInterval(timer);finish();}},24);
  })();
  return()=>{active=false;clearInterval(timer);};
 },[scope,text]);
 const done=length>=text.length;
 return <ChatMessage continuation={continuation} aria-busy={!done} data-streaming={!done}>
  <p aria-hidden={!done}>{text.slice(0,length)||'\u200b'}</p>
  {done?children:null}
 </ChatMessage>;
}
