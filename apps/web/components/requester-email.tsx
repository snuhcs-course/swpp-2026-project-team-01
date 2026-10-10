'use client';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {emailLinkState,type EmailLinkState} from '../../../lib/contracts/requester-email.ts';
import {Button} from './ui/button';
import {Textarea} from './ui/textarea';
import {Field,FieldGroup,FieldLabel,FieldDescription} from './ui/field';
import {Card,CardHeader,CardTitle,CardDescription,CardContent,CardFooter} from './ui/card';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';
type Command={operation:'start';input:{requestId:string;revision:number;idempotencyKey:string}}|{operation:'revoke';input:{requestId:string;linkId:string}};
async function call(requestId:string,signal:AbortSignal,command?:Command){
 const response=await fetch('/api/browser/requester-email/'+(command?command.operation:'state?'+new URLSearchParams({requestId})),{method:command?'POST':'GET',cache:'no-store',signal,headers:command?{'content-type':'application/json'}:undefined,body:command?JSON.stringify(command.input):undefined});
 const body=await response.json();signal.throwIfAborted();if(!response.ok)throw Object.assign(new Error(body.error?.message??'Email linking is unavailable.'),{status:response.status});return emailLinkState.parse(body);
}
export function RequesterEmailCard({requestId,refreshKey,disabled,onAccessLost}:{requestId:string;refreshKey:string;disabled:boolean;onAccessLost:()=>void}){
 const [state,setState]=useState<EmailLinkState|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false),[now,setNow]=useState(0);
 const id=useId(),lifetime=useRef<AbortController|null>(null),inFlight=useRef(false),pending=useRef<Command|null>(null),callback=useRef(onAccessLost);callback.current=onAccessLost;
 const signal=()=>AbortSignal.any([lifetime.current!.signal,AbortSignal.timeout(15000)]);
 const accept=useCallback((next:EmailLinkState)=>{
  // Do not reveal the proof while an unlink result is uncertain.
  if(pending.current?.operation==='revoke'&&next.status==='revoked'){pending.current=null;setUncertain(false);setError('');}
  setState(pending.current?.operation==='revoke'?{...next,linkingText:null}:next);
 },[]);
 const refresh=useCallback(async()=>{
  if(inFlight.current||!lifetime.current)return;const active=lifetime.current;inFlight.current=true;setBusy(true);
  try{const next=await call(requestId,signal());if(active.signal.aborted)return;accept(next);if(!pending.current)setError('');}
  catch(cause){if(active.signal.aborted)return;setState(null);setError(cause instanceof Error?cause.message:'Email linking is unavailable.');if([401,403,404].includes((cause as {status?:number}).status??0)){pending.current=null;setUncertain(false);callback.current();}}
  finally{if(lifetime.current===active){inFlight.current=false;if(!active.signal.aborted)setBusy(false);}}
 },[requestId,accept]);
 useEffect(()=>{const active=new AbortController();lifetime.current=active;inFlight.current=false;void refresh();const wake=()=>{if(document.visibilityState==='visible')void refresh();};const poll=setInterval(wake,15000),clock=setInterval(()=>setNow(Date.now()),1000);setNow(Date.now());addEventListener('focus',wake);document.addEventListener('visibilitychange',wake);return()=>{active.abort();clearInterval(poll);clearInterval(clock);removeEventListener('focus',wake);document.removeEventListener('visibilitychange',wake);};},[refresh]);
 useEffect(()=>{void refresh();},[refreshKey,refresh]);
 async function submit(operation:'start'|'revoke'){
  if(inFlight.current||disabled)return;
  const command=pending.current??(state?(operation==='start'?{operation,input:{requestId,revision:state.revision,idempotencyKey:crypto.randomUUID()}}:state.linkId?{operation,input:{requestId,linkId:state.linkId}}:null):null);if(!command)return;
  const active=lifetime.current!;pending.current=command;inFlight.current=true;setBusy(true);setError('');
  if(command.operation==='revoke')setState(previous=>previous?{...previous,linkingText:null}:null);
  try{const next=await call(requestId,signal(),command);if(active.signal.aborted)return;pending.current=null;setUncertain(false);accept(next);}
  catch(cause){
   if(active.signal.aborted)return;const status=(cause as {status?:number}).status;
   if(status&&status<500){pending.current=null;setUncertain(false);}else setUncertain(true);
   setError(status&&cause instanceof Error?cause.message:'The result could not be confirmed. Retry the same action to recover it.');
   try{const next=await call(requestId,signal());if(!active.signal.aborted)accept(next);}catch{if(!active.signal.aborted)setState(null);}
   if([401,403,404].includes(status??0)){setState(null);callback.current();}
  }finally{if(lifetime.current===active){inFlight.current=false;if(!active.signal.aborted)setBusy(false);}}
 }
 const expired=state?.status==='expired'||!!(state?.expiresAt&&now&&Date.parse(state.expiresAt)<=now);
 const proof=!expired&&state?.status==='pending'?state.linkingText:null;
 return <Card role="region" aria-label="Requester email linking" aria-busy={busy}>
  <CardHeader><CardTitle>Continue by email</CardTitle><CardDescription>Link this meeting to a new email thread. You can always continue in this private web conversation.</CardDescription></CardHeader>
  <CardContent className="flex min-w-0 flex-col gap-3 break-words">
   {!state?<p>Checking email linking…</p>:state.status==='unavailable'?<p role="status">Email linking is unavailable. Continue here on the web.</p>:state.status==='linked'&&!expired?<p role="status">Your email thread is linked. Reply in that same thread to continue this meeting.</p>:expired?<p role="status">This email link has expired. Create a new linking message to continue.</p>:state.status==='revoked'?<p role="status">Email is unlinked. Messages in the old thread cannot access this meeting.</p>:!state.email?<p>Verify your current contact email above before linking.</p>:state.status==='pending'?<p role="status">Waiting for your linking email. This thread is not linked yet.</p>:<p>Your email is not linked to this meeting.</p>}
   {proof?<FieldGroup><Field><FieldLabel htmlFor={id}>Private linking message</FieldLabel><Textarea id={id} readOnly value={proof} autoComplete="off" spellCheck={false} aria-describedby={id+'-help'} onFocus={event=>event.currentTarget.select()}/><FieldDescription id={id+'-help'}>Send exactly this message in a new thread from <span className="break-all">{state?.email}</span> to <span className="break-all">{state?.inboxId}</span>. Do not forward it or paste it into chat. Expires {state?.expiresAt?new Date(state.expiresAt).toLocaleTimeString():''}.</FieldDescription></Field></FieldGroup>:null}
   {error?<Alert variant="destructive"><AlertTitle>Email linking needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>:null}
  </CardContent>
  <CardFooter className="flex flex-wrap gap-2">
   {state&&state.status!=='unavailable'&&state.email&&!uncertain&&(expired||['unlinked','revoked'].includes(state.status))?<Button variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={busy||disabled} onClick={()=>void submit('start')}>Create linking message</Button>:null}
   {state?.linkId&&!uncertain&&['pending','linked','unavailable'].includes(state.status)?<Button variant="outline" className="min-h-11" disabled={busy||disabled} onClick={()=>void submit('revoke')}>Unlink email</Button>:null}
   {uncertain&&pending.current?<Button variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={busy||disabled} onClick={()=>void submit(pending.current!.operation)}>Retry same linking action</Button>:null}
   <Button variant="ghost" className="min-h-11 h-auto whitespace-normal" disabled={busy} onClick={()=>void refresh()}>Check email link</Button>
  </CardFooter>
 </Card>;
}
