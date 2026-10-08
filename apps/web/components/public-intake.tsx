'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {intakeDetails,intakeContinuation,publicProfile,type PublicProfile,type IntakeContinuation} from '../../../lib/contracts/intake.ts';
import {identityDraft,requesterIdentityState,type identityProfile} from '../../../lib/contracts/requester-identity.ts';
import {z} from 'zod';
import {Button} from './ui/button.tsx';
import {Input} from './ui/input.tsx';
import {Textarea} from './ui/textarea.tsx';
import {Field,FieldDescription,FieldGroup,FieldLabel} from './ui/field.tsx';
import {Alert,AlertDescription} from './ui/alert.tsx';

async function api(operation:string,body?:unknown){
 const response=await fetch('/api/browser/intake/'+operation,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(15000)});
 const data=await response.json();
 if(!response.ok)throw new Error(response.status===404?'This host is not accepting new requests right now.':data.error?.message??'We couldn’t check your request. Please try again.');
 return data;
}
export function PublicIntakeWorkspace({handle}:{handle:string}){
 const [profile,setProfile]=useState<PublicProfile|null>(null),[continuation,setContinuation]=useState<IntakeContinuation|null>(null),[attempt,setAttempt]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [timezone,setTimezone]=useState(''),[zones,setZones]=useState<string[]>([]),[uncertain,setUncertain]=useState(false);
 const [draft,setDraft]=useState({requesterName:'',requesterEmail:'',purpose:'',durationMinutes:30}),[identity,setIdentity]=useState<z.infer<typeof identityProfile>|null>(null),[notice,setNotice]=useState('');
 const init=useRef<ReturnType<typeof load>|null>(null),identityBusy=useRef(false),focusManual=useRef(false);
 const pending=useRef<ReturnType<typeof intakeDetails.parse>|null>(null);
 const form=useRef<HTMLFormElement>(null);
 async function load(){
  const binding=await api('bind',{handle});
  const saved=intakeContinuation.nullable().parse(await api('resume',{handle,attemptId:binding.attemptId}));
  const [profile,identity]=saved?[null,null]:await Promise.all([api('profile?handle='+encodeURIComponent(handle)).then(publicProfile.parse),identityApi('state',binding.attemptId).then(requesterIdentityState.parse).catch(()=>{setNotice('Saved Google details could not be restored. Try again, or enter your contact details manually.');return null;})]);
  return {attemptId:binding.attemptId,continuation:saved,profile,identity};
 }
 async function identityApi(operation:string,currentAttempt=attempt,extra:Record<string,unknown>={}){
  const target={kind:'intake',handle},query=new URLSearchParams({kind:'intake',handle,attemptId:currentAttempt});
  const response=await fetch('/api/browser/requester-identity/'+operation+(operation==='state'?'?'+query:''),{method:operation==='state'?'GET':'POST',headers:operation==='state'?{}:{'content-type':'application/json'},body:operation==='state'?undefined:JSON.stringify({target,attemptId:currentAttempt,...extra}),cache:'no-store',signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error?.message??'Google identity could not be checked. Try again.');return data;
 }
 function apply(state:Awaited<ReturnType<typeof load>>){
  setAttempt(state.attemptId);setContinuation(state.continuation);setProfile(state.profile);setIdentity(state.identity?.identity??null);
  if(state.identity){const saved=state.identity;setDraft({requesterName:saved.identity?.name??saved.draft.requesterName,requesterEmail:saved.identity?.email??saved.draft.requesterEmail,purpose:saved.draft.purpose,durationMinutes:saved.draft.durationMinutes??state.profile?.durationMinutes??30});if(saved.draft.timezone)setTimezone(saved.draft.timezone);}
  else if(state.profile)setDraft(value=>({...value,durationMinutes:state.profile!.durationMinutes}));
 }
 async function chooseIdentity(google:boolean){
  if(identityBusy.current||busy||uncertain)return;identityBusy.current=true;setBusy(true);setError('');setNotice('');
  try{
   if(google){const result=await identityApi('start',attempt,{draft:identityDraft.parse({...draft,timezone})});location.assign(result.url);return;}
   await identityApi('skip');setIdentity(null);setNotice('Continue with your name and email. You can verify the address in your private conversation.');focusManual.current=true;
  }catch(e){setError(e instanceof Error?e.message:'Google identity could not be confirmed. Try again or continue without Google.');}
  finally{identityBusy.current=false;setBusy(false);}
 }
 useEffect(()=>{
  let active=true;
  setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone||'');
  const result=new URLSearchParams(location.search).get('identity');if(result){if(result!=='verified')setNotice('Google identity was not completed. Try again or continue without Google.');history.replaceState(null,'','/'+handle);}setZones(['UTC',...Intl.supportedValuesOf('timeZone')]);
  init.current??=load();
  init.current.then(state=>{if(active)apply(state);}).catch(()=>{if(active)setError('We couldn’t open this booking link. The host may be unavailable, or the connection may need a retry.');}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 // The server keys this component by handle; keep the binding promise across Strict Mode replay.
 },[handle]);
 useEffect(()=>{if(!busy&&focusManual.current){focusManual.current=false;document.getElementById('intake-name')?.focus();}},[busy]);
 async function retry(){setBusy(true);setError('');try{apply(await load());}catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}}
 async function startAnother(){
  setBusy(true);setError('');
  try{const binding=await api('new',{handle,attemptId:attempt});setAttempt(binding.attemptId);setContinuation(null);setDraft({requesterName:'',requesterEmail:'',purpose:'',durationMinutes:30});setIdentity(null);setNotice('');setProfile(publicProfile.parse(await api('profile?handle='+encodeURIComponent(handle))));}
  catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}
 }
 async function submit(event:FormEvent){
  event.preventDefault();if(busy)return;setError('');
  if(!pending.current){
   const parsed=intakeDetails.safeParse({...draft,timezone});
   if(!parsed.success){setError(parsed.error.issues[0]?.message??'Check your details.');return;}
   pending.current=parsed.data;
  }
  setBusy(true);
  try{
   const saved=intakeContinuation.parse(await api('create',{handle,attemptId:attempt,details:pending.current}));
   location.assign('/booking/'+saved.requestId);
  }catch{
   // Never silently replace an uncertain submission with edited details or a new token.
   setUncertain(true);setError('We couldn’t confirm the response. Retry this same request, or reload to recover it if it was saved.');setBusy(false);
  }
 }
 return <main className="workspace"><header className="workspace-header"><a className="wordmark" href="/">Find Me a Time<span aria-hidden="true">↗</span></a><span className="header-note">No account needed</span></header>
  <section className="workspace-content intake-workspace">
   <p className="eyebrow">One meeting at a time</p><h1>{continuation?'Pick up your conversation.':profile?<>Meet with<br/>{profile.displayName}.</>:'Let’s find a time.'}</h1>
   {loading?<p role="status">Checking this booking link…</p>:null}
   {continuation?<div className="flex flex-col gap-4"><p className="workspace-description">{continuation.closed?'Your previous request is closed. You can view its status or start a separate request.':'You already started a request in this browser. Continue where you left off, or start a separate request.'}</p>
    <Button asChild><a href={'/booking/'+continuation.requestId}>{continuation.closed?'View request status':'Continue my request'}</a></Button><Button variant="outline" disabled={busy} onClick={startAnother}>Start another request</Button></div>:null}
   {profile&&!continuation?<><p className="workspace-description">Tell us a little about your meeting. We’ll work through the time and place in your private conversation. Nothing is booked until you and your host agree.</p>
    <div className="flex flex-wrap gap-3 mb-6"><Button className="min-h-11 h-auto whitespace-normal" disabled={busy||uncertain||!attempt} onClick={()=>void chooseIdentity(true)}>{identity?'Use another Google account':'Continue with Google'}</Button><Button variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={busy||uncertain||!attempt} onClick={()=>void chooseIdentity(false)}>Continue without Google</Button></div>
    <p className="mb-4">Google only supplies your name and email here. Calendar connection is a separate choice.</p>
    {notice?<p role="status" className="mb-4">{notice}</p>:null}
    <form ref={form} onSubmit={submit}><FieldGroup>
     <Field data-disabled={busy||uncertain}><FieldLabel htmlFor="intake-name">Your name</FieldLabel><Input id="intake-name" name="name" value={draft.requesterName} onChange={e=>setDraft({...draft,requesterName:e.target.value})} autoComplete="name" maxLength={200} required disabled={busy||uncertain}/></Field>
     <Field data-disabled={busy||uncertain}><FieldLabel htmlFor="intake-email">Email address</FieldLabel><Input id="intake-email" name="email" value={draft.requesterEmail} onChange={e=>setDraft({...draft,requesterEmail:e.target.value})} type="email" autoComplete="email" maxLength={254} required disabled={busy||uncertain}/><FieldDescription>{identity?.contactVerified&&identity.email===draft.requesterEmail.trim().toLowerCase()?'Google verified this address. Review it before continuing.':'Use the address where you’d like to receive meeting details. This address needs an email code before recovery or invitations.'}</FieldDescription></Field>
     <Field data-disabled={busy||uncertain}><FieldLabel htmlFor="intake-purpose">What would you like to discuss?</FieldLabel><Textarea id="intake-purpose" name="purpose" value={draft.purpose} onChange={e=>setDraft({...draft,purpose:e.target.value})} rows={3} maxLength={5000} required disabled={busy||uncertain}/></Field>
     <Field data-disabled={busy||uncertain}><FieldLabel htmlFor="intake-duration">Meeting length (minutes)</FieldLabel><Input id="intake-duration" name="duration" type="number" min={5} max={240} step={1} value={draft.durationMinutes} onChange={e=>setDraft({...draft,durationMinutes:Number(e.target.value)})} required disabled={busy||uncertain}/></Field>
     <Field data-disabled={busy||uncertain}><FieldLabel htmlFor="intake-timezone">Your timezone</FieldLabel><Input id="intake-timezone" name="timezone" list="intake-timezones" value={timezone} onChange={e=>setTimezone(e.target.value)} maxLength={100} required disabled={busy||uncertain}/><datalist id="intake-timezones">{zones.map(zone=><option key={zone} value={zone}/>)}</datalist><FieldDescription>Initially suggested from your browser. Choose the IANA timezone for your meeting details.</FieldDescription></Field>
     <Button disabled={busy||!attempt} type="submit">{busy?'Opening your conversation…':uncertain?'Retry this request':'Continue to my conversation'}</Button>
    </FieldGroup></form></>:null}
   {error?<Alert variant="destructive" className="mt-6"><AlertDescription>{error}</AlertDescription></Alert>:null}
   {!loading&&!profile&&!continuation?<Button variant="outline" className="mt-4" onClick={retry} disabled={busy}>Check booking link again</Button>:null}
  </section><footer>Your meeting. Your host’s final say.</footer></main>;
}
