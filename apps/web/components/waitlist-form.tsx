'use client';
import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {Alert,AlertDescription} from './ui/alert.tsx';
import {Button} from './ui/button.tsx';
import {Field,FieldDescription,FieldGroup,FieldLabel} from './ui/field.tsx';
import {Input} from './ui/input.tsx';

export function WaitlistForm(){
 const id=useId(),errorRef=useRef<HTMLDivElement>(null);
 const retry=useRef<{email:string;name:string;idempotencyKey:string}|null>(null);
 const pending=useRef(false);
 const [email,setEmail]=useState(''),[name,setName]=useState(''),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[joined,setJoined]=useState(false);
 useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(pending.current)return;
  pending.current=true;setBusy(true);setError('');setJoined(false);
  const details={email:email.trim().toLowerCase(),name:name.trim()};
  if(!retry.current||retry.current.email!==details.email||retry.current.name!==details.name)
   retry.current={...details,idempotencyKey:crypto.randomUUID()};
  try{
   const response=await fetch('/api/browser/waitlist',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(retry.current),cache:'no-store',signal:AbortSignal.timeout(15000)});
   if(!response.ok||(await response.json()).status!=='pending')throw new Error('Waitlist unavailable');
   // Do not render provider/server details or infer host admission from joining.
   setJoined(true);
  }catch{setError('We couldn’t confirm your waitlist entry. Please try again. Your details are still here.');}
  finally{pending.current=false;setBusy(false);}
 }
 return <form onSubmit={submit} aria-label="Join the waitlist" className="w-full max-w-[420px]" aria-busy={busy}>
  <FieldGroup>
   <Field data-disabled={busy}><FieldLabel htmlFor={id+'-name'}>Name (optional)</FieldLabel><Input id={id+'-name'} className="min-h-12" autoComplete="name" maxLength={200} value={name} onChange={event=>{setName(event.target.value);setJoined(false);}} disabled={busy}/></Field>
   <Field data-disabled={busy}><FieldLabel htmlFor={id+'-email'}>Email address</FieldLabel><Input id={id+'-email'} className="min-h-12" type="email" autoComplete="email" maxLength={254} required value={email} onChange={event=>{setEmail(event.target.value);setJoined(false);}} aria-describedby={id+'-hint'} disabled={busy}/><FieldDescription id={id+'-hint'}>Use your Google account email for your host invitation. Joining the waitlist does not create an account or grant hosting access.</FieldDescription></Field>
   <Button type="submit" className="min-h-12" size="lg" disabled={busy}>{busy?'Joining…':'Join the waitlist'}</Button>
   {joined?<Alert role="status"><AlertDescription>You’re on the list. We’ll be in touch when an invitation is available.</AlertDescription></Alert>:null}
   {error?<Alert variant="destructive" ref={errorRef} tabIndex={-1}><AlertDescription>{error}</AlertDescription></Alert>:null}
  </FieldGroup>
 </form>;
}
