'use client';
import {useCallback,useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {contactState,contactResult,type ContactState} from '../../../lib/contracts/contact-verification.ts';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {Field,FieldGroup,FieldLabel,FieldDescription} from './ui/field';
import {Card,CardHeader,CardTitle,CardDescription,CardContent,CardFooter} from './ui/card';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';
type Command={operation:'start';input:{requestId:string;revision:number;email:string;idempotencyKey:string}}|{operation:'confirm';input:{requestId:string;challengeId:string;code:string;idempotencyKey:string}};
const delivery:Record<NonNullable<ContactState['deliveryStatus']>,string>={pending:'Your code email is queued.',sending:'Your code email is being submitted.',sent:'Your code email was accepted for delivery. Check your inbox and spam folder.',failed:'The code email could not be sent. You can request a new code after the cooldown.',uncertain:'We could not confirm whether the code email was sent. If it arrives, you can use it; otherwise request a new code after the cooldown.',suppressed:'This code email was not sent because the request or code changed. Check the current status before requesting another.'};
async function call(requestId:string,signal:AbortSignal,command?:Command){
 const response=await fetch('/api/browser/contact-verification/'+(command?command.operation:'state?'+new URLSearchParams({requestId})),{method:command?'POST':'GET',cache:'no-store',signal,headers:command?{'content-type':'application/json'}:undefined,body:command?JSON.stringify(command.input):undefined});
 const body=await response.json();signal.throwIfAborted();if(!response.ok)throw Object.assign(new Error(body.error?.message??'Contact verification is unavailable.'),{status:response.status});
 return command?contactResult.parse(body):contactState.parse(body);
}
export function ContactVerificationCard({requestId,refreshKey,disabled,onVerified,onAccessLost}:{requestId:string;refreshKey:string;disabled:boolean;onVerified:()=>void;onAccessLost:()=>void}){
 const [state,setState]=useState<ContactState|null>(null),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(false),[now,setNow]=useState(0);
 const focusCode=useRef(false);
 const id=useId(),input=useRef<HTMLInputElement>(null),heading=useRef<HTMLDivElement>(null),lifetime=useRef<AbortController|null>(null),inFlight=useRef(false),pending=useRef<Command|null>(null),current=useRef<ContactState|null>(null),callbacks=useRef({onVerified,onAccessLost});callbacks.current={onVerified,onAccessLost};
 const signal=()=>AbortSignal.any([lifetime.current!.signal,AbortSignal.timeout(15000)]);
 const accept=useCallback((next:ContactState)=>{
  const previous=current.current;current.current=next;setState(next);
  if(previous?.challengeId!==next.challengeId||previous?.email!==next.email)setCode('');
  const command=pending.current;
  if(command&&(next.status==='verified'||(command.operation==='start'&&(next.email!==command.input.email||next.revision!==command.input.revision))||(command.operation==='confirm'&&(next.challengeId!==command.input.challengeId||['expired','locked','superseded'].includes(next.status))))){pending.current=null;setUncertain(false);setCode('');}
  if(next.status==='verified'&&previous?.status!=='verified')callbacks.current.onVerified();
 },[]);
 const refresh=useCallback(async()=>{
  if(inFlight.current||!lifetime.current)return;const active=lifetime.current;inFlight.current=true;setBusy(true);
  try{const next=contactState.parse(await call(requestId,signal()));if(active.signal.aborted)return;accept(next);if(!pending.current)setError('');}
  catch(cause){if(active.signal.aborted)return;setState(null);current.current=null;setError(cause instanceof Error?cause.message:'Contact verification is unavailable.');if([401,403,404].includes((cause as {status?:number}).status??0)){pending.current=null;setCode('');setUncertain(false);callbacks.current.onAccessLost();}}
  finally{if(lifetime.current===active){inFlight.current=false;if(!active.signal.aborted)setBusy(false);}}
 },[requestId,accept]);
 useEffect(()=>{lifetime.current=new AbortController();inFlight.current=false;void refresh();const wake=()=>{if(document.visibilityState==='visible')void refresh();};const poll=setInterval(wake,15000),clock=setInterval(()=>setNow(Date.now()),1000);setNow(Date.now());addEventListener('focus',wake);document.addEventListener('visibilitychange',wake);return()=>{lifetime.current?.abort();clearInterval(poll);clearInterval(clock);removeEventListener('focus',wake);document.removeEventListener('visibilitychange',wake);};},[refresh]);
 useEffect(()=>{void refresh();},[refreshKey,refresh]);
 useEffect(()=>{if(!busy&&focusCode.current){focusCode.current=false;input.current?.focus();}},[busy,state?.challengeId]);
 async function submit(operation:'start'|'confirm',event?:FormEvent){
  event?.preventDefault();if(inFlight.current||disabled||!state)return;
  const command:Command|null=pending.current??(operation==='start'&&state.email?{operation,input:{requestId,revision:state.revision,email:state.email,idempotencyKey:crypto.randomUUID()}}:operation==='confirm'&&state.challengeId&&/^\d{6}$/u.test(code)?{operation,input:{requestId,challengeId:state.challengeId,code,idempotencyKey:crypto.randomUUID()}}:null);if(!command)return;
  const active=lifetime.current!;pending.current=command;inFlight.current=true;setBusy(true);setError('');setNotice('');
  try{
   const result=contactResult.parse(await call(requestId,signal(),command));if(active.signal.aborted)return;pending.current=null;setUncertain(false);accept(result.state);setCode('');
   if(result.outcome==='invalid_code')setError('That code did not match. '+result.state.attemptsRemaining+' attempts remain.');
   else if(result.outcome==='locked')setError('No attempts remain. Request a new code after the cooldown.');
   else if(['expired','superseded'].includes(result.outcome))setError('That code is no longer current. Request a new code after the cooldown.');
   else if(result.state.status==='verified'){setNotice('Your contact email is verified.');heading.current?.focus();}
   else{setNotice('Code requested. Delivery status is shown below.');focusCode.current=true;}
  }catch(cause){
   if(active.signal.aborted)return;
   const status=(cause as {status?:number}).status;
   if(status&&status<500){pending.current=null;setUncertain(false);}else setUncertain(true);
   setError(status&&cause instanceof Error?cause.message:'The verification result could not be confirmed.');
   // Read before offering a retry. Never infer that a code request was unsent.
   try{const next=contactState.parse(await call(requestId,signal()));if(!active.signal.aborted)accept(next);}catch{if(!active.signal.aborted){setState(null);current.current=null;setCode('');}}
  }finally{if(lifetime.current===active){inFlight.current=false;if(!active.signal.aborted)setBusy(false);}}
 }
 const remaining=state?.nextSendAt?Math.max(0,Math.ceil((Date.parse(state.nextSendAt)-now)/1000)):0;
 const expired=state?.status==='expired'||(state?.status==='pending'&&!!state.expiresAt&&Date.parse(state.expiresAt)<=now),verified=state?.status==='verified',canConfirm=state?.status==='pending'&&!expired;
 return <Card role="region" aria-label="Contact email verification" aria-busy={busy}>
  <CardHeader><CardTitle ref={heading} tabIndex={-1}>Verify your contact email</CardTitle><CardDescription>Use a code from your email before this address is used for your meeting. No account is required.</CardDescription></CardHeader>
  <CardContent className="flex min-w-0 flex-col gap-3 break-words">
   {state?.email?<p className="break-all">{state.email}</p>:state?<p>Add your email to the request details first.</p>:<p>Checking your contact status…</p>}
   {verified?<p role="status">Your contact email is verified.</p>:state?<>
    {state.deliveryStatus?<p role="status">{delivery[state.deliveryStatus]}</p>:null}
    {expired?<p role="status">This code has expired. Request a new code to continue.</p>:state.status==='locked'?<p role="status">No attempts remain. Request a new code to continue.</p>:null}
    {canConfirm?<form onSubmit={event=>void submit('confirm',event)}><FieldGroup><Field data-invalid={!!error&&!uncertain} data-disabled={busy||disabled||uncertain}>
     <FieldLabel htmlFor={id}>Six-digit verification code</FieldLabel><Input ref={input} id={id} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event=>setCode(event.target.value.replace(/[^0-9]/gu,''))} required disabled={busy||disabled||uncertain} aria-invalid={!!error&&!uncertain} aria-describedby={id+'-help'} className="min-h-11"/>
     <FieldDescription id={id+'-help'}>{state.attemptsRemaining} attempts remain. Keep this code out of the conversation.</FieldDescription>
     <Button type="submit" className="min-h-11" disabled={busy||disabled||uncertain||code.length!==6}>Verify email</Button>
    </Field></FieldGroup></form>:null}
    {remaining>0?<p>New code available in {remaining} seconds.</p>:null}
   </>:null}
   {notice&&!verified?<p role="status">{notice}</p>:null}
   {error?<Alert variant="destructive"><AlertTitle>Contact verification needs attention</AlertTitle><AlertDescription>{error}{uncertain?' The result may have been saved. Retry the same action to recover it.':''}</AlertDescription></Alert>:null}
  </CardContent>
  <CardFooter className="flex flex-wrap gap-2">
   {state?.email&&!verified&&!uncertain?<Button variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={busy||disabled||remaining>0} onClick={()=>void submit('start')}>{state.challengeId?'Request a new code':'Send verification code'}</Button>:null}
   {uncertain&&pending.current&&state?<Button variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={busy||disabled} onClick={()=>void submit(pending.current!.operation)}>Retry same verification action</Button>:null}
   <Button variant="ghost" className="min-h-11" disabled={busy} onClick={()=>void refresh()}>Check verification status</Button>
  </CardFooter>
 </Card>;
}
