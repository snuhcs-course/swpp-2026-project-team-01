'use client';
import {useEffect,useRef,useState} from 'react';
import type {ContactShareState} from '../../../lib/contracts/imessage.ts';
import {contactCall} from '../lib/imessage-contact-client.ts';
import {Button} from './ui/button';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';

const messages:Record<ContactShareState['status'],string>={
 queued:'Your contact card request is queued.',
 accepted:'The messaging service accepted the contact card request. Check your iMessage conversation and choose whether to save it. Delivery and saving are not confirmed.',
 uncertain:'The contact card result is uncertain. Check your existing iMessage conversation. We will not send it again automatically.',
 failed:'The contact card could not be sent. You can continue in iMessage or on the web.',
 revoked:'This contact card request is no longer active. You can continue on the web.',
};

// The parent keys this component by link ID, so replacement discards the old
// request identity and aborts reads. A late response cannot update the new card.
export function IMessageContact({linkId,available,disabled}:{linkId:string;available:boolean;disabled:boolean}){
 const [state,setState]=useState<ContactShareState|null|undefined>(undefined),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const controller=useRef<AbortController|null>(null),operating=useRef(false),intent=useRef<string|null>(null);
 async function act(request=false){
  const signal=controller.current?.signal;if(!signal||signal.aborted||operating.current)return;
  operating.current=true;setBusy(true);
  if(request)intent.current??=crypto.randomUUID();
  try{
   const next=await contactCall(linkId,request?intent.current!:undefined,signal);
   if(!signal.aborted){setState(next);setError('');}
  }catch(value){if(!signal.aborted){setState(undefined);setError(value instanceof Error?value.message:'Contact status is unavailable.');}}
  finally{if(controller.current?.signal===signal){operating.current=false;if(!signal.aborted)setBusy(false);}}
 }
 useEffect(()=>{
  const current=new AbortController();controller.current=current;operating.current=false;void act();
  const refresh=()=>{if(document.visibilityState==='visible')void act();};
  const timer=setInterval(refresh,10_000);window.addEventListener('focus',refresh);
  return()=>{current.abort();clearInterval(timer);window.removeEventListener('focus',refresh);};
 },[linkId]);
 return <section aria-label="iMessage contact card" className="flex min-w-0 flex-col gap-3" aria-busy={busy}>
  <p>Optionally request a contact card in your linked iMessage conversation. You choose whether to save it there. Unlinking cannot recall a card already sent.</p>
  <p role="status">{state?messages[state.status]:state===undefined?(error?'Contact status is unavailable.':'Checking contact status…'):'No contact card requested.'}</p>
  {!available?<p>Contact sharing is temporarily unavailable. Web chat remains available.</p>:null}
  <div className="flex flex-wrap gap-2">
   {state===null?<Button type="button" variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={disabled||busy||!available} onClick={()=>void act(true)}>Add to contacts</Button>:null}
   <Button type="button" variant="ghost" className="min-h-11 h-auto whitespace-normal" disabled={disabled||busy} onClick={()=>void act()}>Check contact status</Button>
  </div>
  {error?<Alert variant="destructive"><AlertTitle>Contact sharing needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>:null}
 </section>;
}
