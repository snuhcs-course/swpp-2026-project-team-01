'use client';
import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {REGEXP_ONLY_DIGITS} from 'input-otp';
import {phoneNumber,type IMessageState} from '../../../lib/contracts/imessage.ts';
import {imessageCall,IMessageRequestError,challengeStatus,codeFingerprint} from '../lib/imessage-client.ts';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {InputOTP,InputOTPGroup,InputOTPSlot} from './ui/input-otp';
import {Field,FieldGroup,FieldLabel,FieldDescription} from './ui/field';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';

export function IMessageLink({beforeSettings=false}:{beforeSettings?:boolean}){
 const [state,setState]=useState<IMessageState|null>(null),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [now,setNow]=useState(()=>Date.now()),[notBefore,setNotBefore]=useState(0),[confirmUnlink,setConfirmUnlink]=useState(false);
 const sequence=useRef(0),mounted=useRef(false),operating=useRef(false),startIntent=useRef<{phone:string;idempotencyKey:string}|null>(null);
 // Keep only an attempt ID and digest for uncertain retries. Never retain the
 // submitted code in card state, storage, a transcript or model input.
 const verifyIntent=useRef<{challengeId:string;idempotencyKey:string;fingerprint:string}|null>(null);
 const continuation=useRef<string|null>(null);
 const connected=useRef<HTMLParagraphElement>(null);
 function fail(value:unknown){
  if(value instanceof IMessageRequestError&&['UNAUTHORIZED','HOST_NOT_ADMITTED','FORBIDDEN'].includes(value.code??'')){
   setState(null);setEditing(false);startIntent.current=null;verifyIntent.current=null;continuation.current=null;
  }
  setError(value instanceof Error?value.message:'iMessage connection could not be confirmed.');
 }
 async function read(signal?:AbortSignal){
  if(operating.current)return;
  const version=++sequence.current;
  try{const next=await imessageCall('read',undefined,signal);if(mounted.current&&!signal?.aborted&&version===sequence.current){setState(next);}}
  catch(e){if(mounted.current&&!signal?.aborted&&version===sequence.current)fail(e);}
 }
 useEffect(()=>{
  mounted.current=true;const controller=new AbortController();void read(controller.signal);
  const timer=setInterval(()=>{if(document.visibilityState==='visible')void read(controller.signal);},10_000);
  const focus=()=>{if(document.visibilityState==='visible')void read(controller.signal);};window.addEventListener('focus',focus);window.addEventListener('fmat-imessage-entry',focus);
  return()=>{mounted.current=false;sequence.current++;controller.abort();clearInterval(timer);window.removeEventListener('focus',focus);window.removeEventListener('fmat-imessage-entry',focus);startIntent.current=null;verifyIntent.current=null;continuation.current=null;};
 },[]);
 useEffect(()=>{
  const until=Math.max(notBefore,Date.parse(state?.challenge?.expiresAt??'')||0);
  if(until<=Date.now())return;
  const timer=setInterval(()=>{const time=Date.now();setNow(time);if(time>=until)clearInterval(timer);},1000);
  return()=>clearInterval(timer);
 },[state?.challenge?.expiresAt,notBefore]);
 useEffect(()=>{if(state?.link)connected.current?.focus();},[state?.link?.id]);
 const challenge=state?.challenge,status=challengeStatus(challenge??null,now),locked=busy;
 const waitSeconds=Math.max(0,Math.ceil((Math.max(notBefore,challenge?Date.parse(challenge.retryAfter):0)-now)/1000));
 async function run(action:()=>Promise<IMessageState|null>){
  if(operating.current)return;operating.current=true;sequence.current++;setBusy(true);setError('');setNotice('');
  try{const next=await action();if(mounted.current&&next){setState(next);setNow(Date.now());return next;}}
  catch(e){if(mounted.current)fail(e);}
  finally{operating.current=false;if(mounted.current)setBusy(false);}
 }
 async function start(phone:string){
  if(startIntent.current&&startIntent.current.phone!==phone){setError('Retry the same number or check the current status before changing it.');return;}
  startIntent.current??={phone,idempotencyKey:crypto.randomUUID()};
  const next=await run(async()=>{await imessageCall('bind',{});return imessageCall('start',startIntent.current);});
  if(next){startIntent.current=null;verifyIntent.current=null;continuation.current=null;setEditing(false);}
 }
 async function continueEntry(){
  continuation.current??=crypto.randomUUID();
  const next=await run(()=>imessageCall('continue',{idempotencyKey:continuation.current}));
  if(next){continuation.current=null;verifyIntent.current=null;setEditing(false);}
 }
 async function verify(code:string){
  if(!challenge)return;
  const fingerprint=await codeFingerprint(code);
  if(verifyIntent.current&&(verifyIntent.current.challengeId!==challenge.id||verifyIntent.current.fingerprint!==fingerprint)){
   setError('Enter the same code to retry the uncertain attempt, or check the current status first.');return;
  }
  verifyIntent.current??={challengeId:challenge.id,idempotencyKey:crypto.randomUUID(),fingerprint};
  const next=await run(()=>imessageCall('verify',{challengeId:challenge.id,idempotencyKey:verifyIntent.current!.idempotencyKey,code}));
  if(next){verifyIntent.current=null;if(next.outcome==='invalid_code')setError(`That code did not match. ${next.challenge?.remainingAttempts??0} attempts remain.`);}
 }
 async function changeNumber(){
  if(!challenge)return;
  const next=await run(()=>imessageCall('cancel',{challengeId:challenge.id}));
  if(next){setNotBefore(Date.parse(challenge.retryAfter));startIntent.current=null;verifyIntent.current=null;continuation.current=null;setEditing(true);}
 }
 async function reload(){
  const next=await run(()=>imessageCall('read'));
  if(next){startIntent.current=null;verifyIntent.current=null;continuation.current=null;if(next.challenge||next.link)setEditing(false);setNotice('Current iMessage status checked.');}
 }
 async function skip(){const next=await run(()=>imessageCall('skip',{}));if(next){startIntent.current=null;verifyIntent.current=null;continuation.current=null;setEditing(false);setNotice('You can continue here on the web. Connect iMessage whenever you’re ready.');}}
 const canVerify=challenge?.sameBrowser&&['uncertain','accepted','delivered'].includes(status??'')&&state?.available;
 const messages={prepared:'Your code request is saved and waiting to send.',uncertain:'Delivery is not confirmed. If you received the code, enter it below.',accepted:'The messaging service accepted your code. Delivery is not confirmed yet.',delivered:'Your verification code was delivered.',failed:'The code could not be delivered. You can request a new code or continue on the web.',revoked:'This verification is no longer active.',expired:'This code has expired. Request a new code when you’re ready.',locked:'This code has reached its attempt limit. Request a new code or continue on the web.'};
 if(beforeSettings&&!editing&&!state?.handoff&&!state?.challenge&&!state?.link)return null;
 return <section role="region" aria-label="Connect iMessage" className="flex min-w-0 flex-col gap-3" aria-busy={busy}>
  <h3 className="text-base font-medium">Continue in iMessage</h3>
  {!state?<p role="status">{error?'iMessage status is unavailable.':'Checking your iMessage connection…'}</p>:state.link?<>
   <p tabIndex={-1} ref={connected}>iMessage connected · {state.link.maskedPhone}</p><p>Your private number is linked. Web chat remains available.</p>
   {confirmUnlink?<><p>Unlink {state.link.maskedPhone}? It will no longer have access to your private host conversation.</p><div className="flex flex-wrap gap-2"><Button variant="destructive" disabled={locked} onClick={()=>void run(()=>imessageCall('unlink',{linkId:state.link!.id})).then(next=>{if(next)setConfirmUnlink(false);})}>Confirm unlink</Button><Button variant="outline" disabled={locked} onClick={()=>setConfirmUnlink(false)}>Keep connected</Button></div></>:<Button variant="outline" disabled={locked} onClick={()=>setConfirmUnlink(true)}>Unlink iMessage</Button>}
  </>:challenge?<>
   <p>Verification for {challenge.maskedPhone}</p><p role="status">{status?messages[status]:null}</p>
   {!challenge.sameBrowser?<p>Return to the browser and sign-in session that requested this code, or change the number to start a new verification here.</p>:null}
   {!state.available?<p>iMessage connection is temporarily unavailable. You can continue here on the web.</p>:null}
   {canVerify?<CodeForm key={challenge.id} disabled={locked} invalid={state.outcome==='invalid_code'&&!!error} onSubmit={verify} attempts={challenge.remainingAttempts}/>:null}
   {!['expired','locked','failed','revoked'].includes(status??'')?<p className="text-sm text-muted-foreground">Expires at {new Date(challenge.expiresAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}. {challenge.remainingAttempts} attempts remain.</p>:null}
   <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={locked||waitSeconds>0||!state.available} onClick={()=>void changeNumber()}>Request a new code</Button><Button variant="ghost" disabled={locked} onClick={()=>void changeNumber()}>Change number</Button><Button variant="ghost" disabled={locked} onClick={()=>void skip()}>Maybe later</Button></div>
  </>:state.handoff?<>
   <p>Link the private iMessage number {state.handoff.maskedPhone} that sent you here.</p><p>We’ll send a fresh six-digit code to that original conversation. Enter it here to confirm the link.</p>
   <div className="flex flex-wrap gap-2"><Button disabled={locked||!state.available} onClick={()=>void continueEntry()}>Send verification code</Button><Button variant="outline" disabled={locked} onClick={()=>void skip()}>Maybe later</Button></div>
  </>:editing?<>
   <PhoneForm disabled={locked||!state.available||waitSeconds>0} initialPhone={startIntent.current?.phone??''} onSubmit={start}/>
   <Button variant="ghost" disabled={locked} onClick={()=>void skip()}>Maybe later</Button>
  </>:<>
   <p>{state.skipped?'You chose to continue on the web. You can connect your private iMessage number whenever you’re ready.':'Connect your private iMessage number to continue with your scheduling assistant there. This step is optional.'}</p>
   {!state.available?<p>iMessage connection isn’t available yet. You can continue here on the web.</p>:null}
   <div className="flex flex-wrap gap-2"><Button disabled={locked||!state.available} onClick={()=>{setEditing(true);setError('');setNotice('');}}>Connect iMessage</Button>{!state.skipped?<Button variant="outline" disabled={locked} onClick={()=>void skip()}>Maybe later</Button>:null}</div>
  </>}
  {waitSeconds>0&&!state?.link?<p className="text-sm text-muted-foreground">You can request another code in {waitSeconds} seconds.</p>:null}
  {notice?<p role="status">{notice}</p>:null}
  {error?<Alert variant="destructive"><AlertTitle>iMessage needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>:null}
  <Button variant="ghost" disabled={locked} onClick={()=>void reload()}>Check iMessage status</Button>
 </section>;
}

function PhoneForm({disabled,initialPhone,onSubmit}:{disabled:boolean;initialPhone:string;onSubmit:(phone:string)=>Promise<void>}){
 const [phone,setPhone]=useState(initialPhone),[invalid,setInvalid]=useState(false),id=useId();
 function submit(event:FormEvent){event.preventDefault();const parsed=phoneNumber.safeParse(phone.trim());setInvalid(!parsed.success);if(parsed.success)void onSubmit(parsed.data);}
 return <form onSubmit={submit}><FieldGroup><Field data-invalid={invalid} data-disabled={disabled}><FieldLabel htmlFor={id}>Private iMessage number</FieldLabel><Input id={id} type="tel" autoComplete="tel" autoFocus inputMode="tel" value={phone} maxLength={16} disabled={disabled} aria-invalid={invalid} aria-describedby={id+'help'} onChange={event=>{setPhone(event.target.value);setInvalid(false);}} required/><FieldDescription id={id+'help'}>Include the country code, for example +821012345678. We’ll send a six-digit verification code.</FieldDescription>{invalid?<p role="alert">Enter a number starting with + and its country code, using digits only.</p>:null}</Field><Button type="submit" disabled={disabled}>Send code</Button></FieldGroup></form>;
}
function CodeForm({disabled,invalid,onSubmit,attempts}:{disabled:boolean;invalid:boolean;onSubmit:(code:string)=>Promise<void>;attempts:number}){
 const [code,setCode]=useState(''),id=useId(),input=useRef<HTMLInputElement>(null),showInvalid=invalid&&code.length===0;
 useEffect(()=>{if(invalid&&!disabled)input.current?.focus();},[invalid,disabled]);
 function submit(event:FormEvent){event.preventDefault();if(code.length!==6||disabled)return;const value=code;setCode('');void onSubmit(value);}
 return <form onSubmit={submit} autoComplete="off"><FieldGroup><Field data-disabled={disabled} data-invalid={showInvalid}><FieldLabel htmlFor={id}>Six-digit iMessage code</FieldLabel><InputOTP ref={input} id={id} maxLength={6} pattern={REGEXP_ONLY_DIGITS} value={code} onChange={setCode} autoComplete="off" autoFocus disabled={disabled} aria-invalid={showInvalid} aria-describedby={id+'help'} pushPasswordManagerStrategy="none"><InputOTPGroup className="min-h-11">{Array.from({length:6},(_,index)=><InputOTPSlot aria-invalid={showInvalid} className="h-11" index={index} key={index}/>)}</InputOTPGroup></InputOTP><FieldDescription id={id+'help'}>Enter the code here, not in chat. It is cleared when you submit.</FieldDescription></Field><Button type="submit" disabled={disabled||code.length!==6||attempts===0}>Confirm and link</Button></FieldGroup></form>;
}
