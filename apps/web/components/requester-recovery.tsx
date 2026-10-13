'use client';
import {useRef,useState,type FormEvent} from 'react';
import {recoveryAccepted,recoveryRedeem,recoveryResult,recoveryStart} from '../../../lib/contracts/requester-recovery.ts';
import {Card,CardHeader,CardTitle,CardDescription,CardContent} from './ui/card.tsx';
import {Field,FieldGroup,FieldLabel,FieldDescription} from './ui/field.tsx';
import {Input} from './ui/input.tsx';
import {Button} from './ui/button.tsx';
export type RecoveryProof={challengeId:string;proof:string};
export function RequesterRecoveryCard({requestId,proof,onRecovered,onDiscard}:{requestId:string;proof:RecoveryProof|null;onRecovered:()=>void;onDiscard:(message?:string)=>void}){
 const [email,setEmail]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(false);
 const pending=useRef<ReturnType<typeof recoveryStart.parse>|null>(null),inFlight=useRef(false);
 async function send(operation:'start'|'redeem',input:unknown){
  const response=await fetch('/api/browser/recovery/'+operation,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),cache:'no-store',signal:AbortSignal.timeout(35000)});
  if(!response.ok){const error=await response.json();throw Object.assign(new Error('Recovery could not be completed.'),{code:error.error?.code});}
  return response.json();
 }
 async function start(event:FormEvent){
  event.preventDefault();if(inFlight.current)return;
  const parsed=recoveryStart.safeParse(pending.current??{requestId,email:email.trim(),idempotencyKey:crypto.randomUUID()});
  if(!parsed.success){setError('Enter a valid email address.');return;}
  pending.current=parsed.data;inFlight.current=true;setBusy(true);setError('');setNotice('');
  try{recoveryAccepted.parse(await send('start',pending.current));pending.current=null;setUncertain(false);setNotice('If this email was verified for an active request, a recovery link may arrive shortly. Check your inbox and spam folder. If needed, wait a minute before requesting another link.');}
  catch{setUncertain(true);setError('We could not confirm the response. Retry this request to avoid sending a duplicate link.');}
  finally{inFlight.current=false;setBusy(false);}
 }
 async function redeem(){
  if(inFlight.current||!proof)return;inFlight.current=true;setBusy(true);setError('');
  try{recoveryResult.parse(await send('redeem',recoveryRedeem.parse({requestId,...proof})));onRecovered();}
  catch(error){
   if(error instanceof Error&&'code' in error&&error.code==='CHALLENGE_INVALID'){onDiscard('This recovery link is no longer valid. Request a new link for an active request.');}
   else setError('Access could not be confirmed. Try Restore request access again with this same link.');
  }finally{inFlight.current=false;setBusy(false);}
 }
 return <Card role="region" aria-label="Recover request access" aria-busy={busy}>
  <CardHeader><CardTitle>{proof?'Restore this request':'Lost your private link?'}</CardTitle><CardDescription>{proof?'Restoring access replaces the previous private request link. It does not sign you in or approve a meeting.':'Use the email you previously verified for this request. Recovery is available only while the request is active.'}</CardDescription></CardHeader>
  <CardContent className="flex flex-col gap-4">
   {proof?<div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={()=>void redeem()} className="min-h-11 h-auto whitespace-normal">{busy?'Restoring…':'Restore request access'}</Button><Button variant="outline" disabled={busy} onClick={()=>{onDiscard();setError('');}} className="min-h-11">Cancel</Button></div>:<form onSubmit={start}>
    <FieldGroup><Field data-disabled={busy||uncertain}><FieldLabel htmlFor={'recovery-email-'+requestId}>Verified contact email</FieldLabel><Input id={'recovery-email-'+requestId} type="email" autoComplete="email" maxLength={254} required value={email} disabled={busy||uncertain} onChange={event=>setEmail(event.target.value)}/><FieldDescription>For privacy, the response does not confirm whether this request or email is eligible.</FieldDescription></Field>
    <Field><Button type="submit" disabled={busy} className="min-h-11 h-auto whitespace-normal">{busy?'Requesting…':uncertain?'Retry recovery request':'Email a recovery link'}</Button></Field></FieldGroup>
   </form>}
   {notice?<p role="status">{notice}</p>:null}{error?<p role="alert">{error}</p>:null}
  </CardContent>
 </Card>;
}
