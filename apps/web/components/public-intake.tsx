'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {intakeDetails,intakeContinuation,publicProfile,type PublicProfile,type IntakeContinuation} from '../../../lib/contracts/intake.ts';
import {Button} from './ui/button.tsx';
import {Input} from './ui/input.tsx';
import {Textarea} from './ui/textarea.tsx';
import {Field,FieldDescription,FieldGroup,FieldLabel} from './ui/field.tsx';
import {Alert,AlertDescription} from './ui/alert.tsx';

async function api(operation:string,body?:unknown){
 const response=await fetch('/api/browser/intake/'+operation,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
 const data=await response.json();
 if(!response.ok)throw new Error(response.status===404?'This host is not accepting new requests right now.':data.error?.message??'We couldn’t check your request. Please try again.');
 return data;
}
export function PublicIntakeWorkspace({handle}:{handle:string}){
 const [profile,setProfile]=useState<PublicProfile|null>(null),[continuation,setContinuation]=useState<IntakeContinuation|null>(null),[attempt,setAttempt]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [timezone,setTimezone]=useState(''),[zones,setZones]=useState<string[]>([]),[uncertain,setUncertain]=useState(false);
 const init=useRef<Promise<{attemptId:string;continuation:IntakeContinuation|null;profile:PublicProfile|null}>|null>(null);
 const pending=useRef<ReturnType<typeof intakeDetails.parse>|null>(null);
 const form=useRef<HTMLFormElement>(null);
 async function load(){
  const binding=await api('bind',{handle});
  const saved=intakeContinuation.nullable().parse(await api('resume',{handle,attemptId:binding.attemptId}));
  return {attemptId:binding.attemptId,continuation:saved,profile:saved?null:publicProfile.parse(await api('profile?handle='+encodeURIComponent(handle)))};
 }
 function apply(state:Awaited<ReturnType<typeof load>>){setAttempt(state.attemptId);setContinuation(state.continuation);setProfile(state.profile);}
 useEffect(()=>{
  let active=true;
  setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC');setZones(['UTC',...Intl.supportedValuesOf('timeZone')]);
  init.current??=load();
  init.current.then(state=>{if(active)apply(state);}).catch(()=>{if(active)setError('We couldn’t open this booking link. The host may be unavailable, or the connection may need a retry.');}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 // The server keys this component by handle; keep the binding promise across Strict Mode replay.
 },[handle]);
 async function retry(){setBusy(true);setError('');try{apply(await load());}catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}}
 async function startAnother(){
  setBusy(true);setError('');
  try{const binding=await api('new',{handle,attemptId:attempt});setAttempt(binding.attemptId);setContinuation(null);setProfile(publicProfile.parse(await api('profile?handle='+encodeURIComponent(handle))));}
  catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}
 }
 async function submit(event:FormEvent){
  event.preventDefault();if(busy)return;setError('');
  if(!pending.current){
   const data=new FormData(form.current!);
   const parsed=intakeDetails.safeParse({requesterName:data.get('name'),requesterEmail:data.get('email'),purpose:data.get('purpose'),durationMinutes:Number(data.get('duration')),timezone});
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
    <form ref={form} onSubmit={submit}><FieldGroup>
     <Field data-disabled={busy||uncertain}><FieldLabel htmlFor="intake-name">Your name</FieldLabel><Input id="intake-name" name="name" autoComplete="name" maxLength={200} required disabled={busy||uncertain}/></Field>
     <Field data-disabled={busy||uncertain}><FieldLabel htmlFor="intake-email">Email address</FieldLabel><Input id="intake-email" name="email" type="email" autoComplete="email" maxLength={254} required disabled={busy||uncertain}/><FieldDescription>Use the address where you’d like to receive meeting details. You’ll need to verify it before it can be used for recovery or invitations.</FieldDescription></Field>
     <Field data-disabled={busy||uncertain}><FieldLabel htmlFor="intake-purpose">What would you like to discuss?</FieldLabel><Textarea id="intake-purpose" name="purpose" rows={3} maxLength={5000} required disabled={busy||uncertain}/></Field>
     <Field data-disabled={busy||uncertain}><FieldLabel htmlFor="intake-duration">Meeting length (minutes)</FieldLabel><Input id="intake-duration" name="duration" type="number" min={5} max={240} step={1} defaultValue={profile.durationMinutes} required disabled={busy||uncertain}/></Field>
     <Field data-disabled={busy||uncertain}><FieldLabel htmlFor="intake-timezone">Your timezone</FieldLabel><Input id="intake-timezone" name="timezone" list="intake-timezones" value={timezone} onChange={e=>setTimezone(e.target.value)} maxLength={100} required disabled={busy||uncertain}/><datalist id="intake-timezones">{zones.map(zone=><option key={zone} value={zone}/>)}</datalist><FieldDescription>Detected from your browser. Choose another IANA timezone if you’ll be elsewhere.</FieldDescription></Field>
     <Button disabled={busy||!attempt} type="submit">{busy?'Opening your conversation…':uncertain?'Retry this request':'Continue to my conversation'}</Button>
    </FieldGroup></form></>:null}
   {error?<Alert variant="destructive" className="mt-6"><AlertDescription>{error}</AlertDescription></Alert>:null}
   {!loading&&!profile&&!continuation?<Button variant="outline" className="mt-4" onClick={retry} disabled={busy}>Check booking link again</Button>:null}
  </section><footer>Your meeting. Your host’s final say.</footer></main>;
}
