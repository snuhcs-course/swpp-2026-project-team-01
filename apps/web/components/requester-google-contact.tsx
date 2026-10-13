'use client';
import {useEffect,useRef,useState} from 'react';
import {requesterIdentityState} from '../../../lib/contracts/requester-identity.ts';
import {z} from 'zod';
import {Button} from './ui/button.tsx';
export function RequesterGoogleContact({requestId,revision,email,disabled,onVerified}:{requestId:string;revision:number;email:string;disabled:boolean;onVerified:()=>void}){
 const [state,setState]=useState<z.infer<typeof requesterIdentityState>>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const active=useRef<AbortController|null>(null),inFlight=useRef(false),pending=useRef<{revision:number;email:string}|null>(null);
 async function call(operation:string,input:Record<string,unknown>={}){
  const response=await fetch('/api/browser/requester-identity/'+operation+(operation==='state'?'?kind=guest&requestId='+requestId:''),{method:operation==='state'?'GET':'POST',headers:operation==='state'?{}:{'content-type':'application/json'},body:operation==='state'?undefined:JSON.stringify({target:{kind:'guest',requestId},...input}),cache:'no-store',signal:AbortSignal.any([active.current!.signal,AbortSignal.timeout(15000)])});
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error?.message??'Google identity could not be checked.'),{status:response.status});return data;
 }
 useEffect(()=>{
  const controller=new AbortController();active.current=controller;inFlight.current=false;
  void call('state').then(value=>{if(!controller.signal.aborted)setState(requesterIdentityState.parse(value));}).catch(()=>{if(!controller.signal.aborted)setError('Google identity is unavailable. You can use an email code instead.');});
  const result=new URLSearchParams(location.search).get('identity');if(result){if(result!=='verified')setNotice('Google identity was not completed. Try again or use an email code.');history.replaceState(null,'','/booking/'+requestId);}
  return()=>controller.abort();
 },[requestId,revision,email]);
 async function action(operation:'start'|'skip'|'apply'){
  if(inFlight.current||disabled)return;inFlight.current=true;setBusy(true);setError('');const controller=active.current!;
  try{
   if(operation==='start'){
    const {url}=await call('start',{draft:{requesterEmail:email},revision});if(!controller.signal.aborted)location.assign(url);return;
   }
   if(operation==='apply'){pending.current??={revision,email};await call('apply',pending.current);if(!controller.signal.aborted){pending.current=null;onVerified();}return;}
   await call('skip');if(!controller.signal.aborted){setState(null);pending.current=null;setNotice('Use the email-code controls to verify your address.');}
  }catch(cause){if(!controller.signal.aborted){setError(cause instanceof Error?cause.message:'Google identity could not be confirmed.');if((cause as {status?:number}).status&&((cause as {status:number}).status<500))pending.current=null;}}
  finally{if(active.current===controller){inFlight.current=false;if(!controller.signal.aborted)setBusy(false);}}
 }
 const identity=state?.identity,matching=identity?.contactVerified&&identity.email===email;
 return <section aria-label="Optional Google contact" className="flex min-w-0 flex-col gap-3">
  <p>Or use Google to verify your contact. Calendar access is a separate choice.</p>
  {identity?<p className="break-all">Google account: {identity.email}. {matching?'Use this address for your current request.':identity.contactVerified?'To use this address, first update the recipient in your request details.':'This address still needs an email code.'}</p>:null}
  <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={disabled||busy} onClick={()=>void action('start')}>{identity?'Use another Google account':'Continue with Google'}</Button>
   {matching?<Button type="button" className="min-h-11 h-auto whitespace-normal" disabled={disabled||busy} onClick={()=>void action('apply')}>{pending.current?'Retry Google contact verification':'Use verified Google email'}</Button>:null}
   <Button type="button" variant="ghost" className="min-h-11 h-auto whitespace-normal" disabled={disabled||busy} onClick={()=>void action('skip')}>Continue without Google</Button></div>
  {notice?<p role="status">{notice}</p>:null}{error?<p role="alert">{error}</p>:null}
 </section>;
}
