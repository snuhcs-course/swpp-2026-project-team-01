'use client';
import {useEffect,useState} from 'react';
import {setupReadiness,type SetupReadiness} from '../../../lib/contracts/setup.ts';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';
import {Button} from './ui/button';

export function SetupReadyLinks(){
 const [state,setState]=useState<SetupReadiness|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{
  let controller:AbortController;
  async function refresh(){
   controller?.abort();const current=new AbortController();controller=current;setState(null);setError('');
   try{
    const response=await fetch('/api/browser/setup/readiness',{cache:'no-store',signal:AbortSignal.any([current.signal,AbortSignal.timeout(20_000)])});
    const body=await response.json();if(!response.ok)throw new Error(body.error?.message??'Your booking link could not be checked.');
    const next=setupReadiness.parse(body);if(!current.signal.aborted)setState(next);
   }catch(e){if(!current.signal.aborted)setError(e instanceof Error?e.message:'Your booking link could not be checked.');}
  }
  void refresh();const focus=()=>void refresh();window.addEventListener('focus',focus);
  return()=>{controller?.abort();window.removeEventListener('focus',focus);};
 },[reload]);
 return <section aria-label="Share your booking link" className="flex min-w-0 flex-col gap-3">
  {!state&&!error?<p role="status">Checking your booking link and Calendar access…</p>:null}
  {state?.ready?<Alert role="status"><AlertTitle>Your booking link is ready</AlertTitle><AlertDescription>
   <p>Share this link to let someone request a meeting. Availability is checked again for each request, and every booking needs your approval.</p>
   <p className="break-all">{new URL('/'+state.handle,window.location.origin).href}</p>
  </AlertDescription><div className="flex flex-wrap gap-2">
   <Button asChild className="h-auto min-h-11 whitespace-normal"><a href={'/'+state.handle} target="_blank" rel="noreferrer">Open booking page</a></Button>
   <Button asChild variant="outline" className="h-auto min-h-11 whitespace-normal"><a href={'/'+state.handle+'/SKILL.md'} target="_blank" rel="noreferrer">Open agent instructions</a></Button>
  </div></Alert>:null}
  {error||state?.ready===false?<Alert variant="destructive"><AlertTitle>Booking link needs a check</AlertTitle><AlertDescription>{error||(state?.ready===false&&state.reason==='calendar'?'Review your Calendar connection and choose available calendars with a writable booking destination.':'Finish and confirm the current setup before sharing your link.')}</AlertDescription><Button variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={()=>setReload(n=>n+1)}>Check booking link again</Button></Alert>:null}
 </section>;
}
