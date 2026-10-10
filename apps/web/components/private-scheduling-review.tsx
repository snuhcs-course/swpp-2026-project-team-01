'use client';
import {useCallback,useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {privateReviewState,type PrivateReviewState,type PrivateReviewCandidate,type PrivateTravelLeg} from '../../../lib/contracts/private-review.ts';
import {preferenceReceipt,confirmPreference} from '../../../lib/contracts/preference-decision.ts';
import {travelAllowanceReceipt,confirmTravelAllowance} from '../../../lib/contracts/travel-allowance.ts';
import {localTimeToInstant} from '../../../lib/contracts/time.ts';
import type {RouteLocation} from '../../../lib/contracts/travel.ts';
import {Button} from './ui/button';
import {Card,CardHeader,CardTitle,CardDescription,CardContent,CardFooter} from './ui/card';
import {Field,FieldGroup,FieldLabel,FieldDescription,FieldSet,FieldLegend} from './ui/field';
import {Input} from './ui/input';
import {Textarea} from './ui/textarea';
import {Checkbox} from './ui/checkbox';
import {RadioGroup,RadioGroupItem} from './ui/radio-group';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';

type Interval=PrivateReviewCandidate['interval'];
type Action={path:string;input:Record<string,unknown>&{revision:number};candidate?:Interval};
class ReviewError extends Error{constructor(message:string,readonly status:number){super(message);}}
async function call(path:string,input?:unknown,signal?:AbortSignal){
 const response=await fetch('/api/browser/scheduling/'+path,{method:input?'POST':'GET',cache:'no-store',signal:signal??AbortSignal.timeout(120_000),headers:input?{'content-type':'application/json'}:undefined,body:input?JSON.stringify(input):undefined}),body=await response.json();
 if(!response.ok)throw new ReviewError(body.error?.message??'Private review could not be loaded.',response.status);return body;
}
function privateInstant(value:string,timezone:string){return new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'shortOffset',timeZone:timezone}).format(new Date(value));}
export function privateTime(interval:Interval,timezone:string){return privateInstant(interval.start,timezone)+' – '+privateInstant(interval.end,timezone);}
function place(location:RouteLocation|null){return !location?'Not known':'address' in location?location.address:'placeId' in location?'Place ID: '+location.placeId:location.latitude+', '+location.longitude;}
const preferenceLabels={meeting_mode:'Meeting mode',location:'Meeting location',additional:'Additional preferences'} as const;
const legReasons:Record<string,string>={unknown_neighbor:'The adjacent commitment or your available starting point is unknown.',location:'A required location is missing.',mode:'Choose a transportation mode for this trip.',overlap:'The adjacent commitment overlaps this time.',estimate:'A reliable route estimate is unavailable.',insufficient_gap:'The trip and buffers do not fit.',stale_estimate:'The previous estimate is no longer current.',departure_context:'Confirm your current starting point and a future available time.'};

export function PrivateSchedulingReview({requestId,refreshKey,disabled,onAccessLost,onChanged}:{requestId:string;refreshKey:string;disabled:boolean;onAccessLost:()=>void;onChanged:()=>void}){
 const [state,setState]=useState<PrivateReviewState|null>(null),[selected,setSelected]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
 const callbacks=useRef({onAccessLost,onChanged});callbacks.current={onAccessLost,onChanged};const mounted=useRef(false),inFlight=useRef(false),sequence=useRef(0),pending=useRef<Action|null>(null),reader=useRef<AbortController|null>(null);
 const refresh=useCallback(async()=>{
  if(inFlight.current)return;reader.current?.abort();const controller=new AbortController();reader.current=controller;const ticket=++sequence.current;
  try{const value=privateReviewState.parse(await call('private?'+new URLSearchParams({requestId}),undefined,AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)])));
   if(!mounted.current||ticket!==sequence.current)return;setState(value);
   if(pending.current&&(value.revision>pending.current.input.revision||pending.current.path==='private/evaluate')){pending.current=null;setUncertain(false);setNotice('Current private state loaded. Review saved decisions before checking this time again.');callbacks.current.onChanged();}
   if(!pending.current)setError('');return value;
  }catch(cause){if(!mounted.current||controller.signal.aborted||ticket!==sequence.current)return;setState(null);setError(cause instanceof Error?cause.message:'Could not load private review.');if(cause instanceof ReviewError&&[401,403].includes(cause.status))callbacks.current.onAccessLost();}
 },[requestId]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;sequence.current++;reader.current?.abort();};},[]);
 useEffect(()=>{void refresh();},[refresh,refreshKey]);
 useEffect(()=>{const wake=()=>{if(document.visibilityState==='visible')void refresh();};const timer=setInterval(wake,15_000);addEventListener('focus',wake);document.addEventListener('visibilitychange',wake);return()=>{clearInterval(timer);removeEventListener('focus',wake);document.removeEventListener('visibilitychange',wake);};},[refresh]);
 useEffect(()=>{if(!state?.expiresAt)return;const timer=setTimeout(()=>void refresh(),Math.max(0,Date.parse(state.expiresAt)-Date.now())+25);return()=>clearTimeout(timer);},[state?.expiresAt,refresh]);
 async function act(path:string,fields:Record<string,unknown>={},candidate?:Interval){
  if(inFlight.current||disabled||(!state&&!pending.current))return;
  const recovering=pending.current!==null;
  const action=pending.current??{path,input:{requestId,revision:state!.revision,...fields,...(path==='private/evaluate'?{}:{idempotencyKey:crypto.randomUUID()})},candidate};pending.current=action;
  inFlight.current=true;sequence.current++;reader.current?.abort();setBusy(true);setError('');setNotice('');
  try{
   // A recovery read belongs to this action. Background polling must not
   // abort it between a user's retry click and the frozen command replay.
   if(recovering){
    const saved=privateReviewState.parse(await call('private?'+new URLSearchParams({requestId})));if(!mounted.current)return;setState(saved);
    if(saved.revision>action.input.revision||action.path==='private/evaluate'){
     pending.current=null;setUncertain(false);setNotice('Current private state loaded. Review saved decisions before checking this time again.');callbacks.current.onChanged();return;
    }
   }
   const value=await call(action.path,action.input);if(!mounted.current)return;
   if(action.path==='private/evaluate'){
    const next=privateReviewState.parse(value);setState(next);setSelected(next.candidates[0]?.id??'');setNotice('Private checks refreshed. A passing check is not a proposal or booking.');
   }else{
    const receipt=(action.path.startsWith('allowances/')?travelAllowanceReceipt:preferenceReceipt).parse(value);
    pending.current=null;setUncertain(false);callbacks.current.onChanged();
    setNotice(receipt.revoked?'Decision revoked. Rechecking this time…':'Decision saved. Rechecking this time…');
    try{
     const next=privateReviewState.parse(await call('private/evaluate',{requestId,revision:receipt.revision,...(action.candidate?{candidate:action.candidate}:{})}));if(!mounted.current)return;setState(next);setSelected(next.candidates[0]?.id??'');setNotice(receipt.revoked?'Decision revoked and time rechecked.':'Decision saved and time rechecked. Review both trips and all preferences.');
    }catch{if(!mounted.current)return;setState(null);setNotice('Your decision was saved. Refresh private review, then run a new check before continuing.');}
   }
   pending.current=null;setUncertain(false);callbacks.current.onChanged();
  }catch(cause){if(!mounted.current)return;
   if(cause instanceof ReviewError&&cause.status<500){pending.current=null;setUncertain(false);setState(null);if([401,403].includes(cause.status))callbacks.current.onAccessLost();}else setUncertain(true);
   setError(cause instanceof ReviewError?cause.message:'The decision outcome could not be confirmed. Check saved state before retrying.');
  }finally{inFlight.current=false;if(mounted.current)setBusy(false);}
 }
 const locked=disabled||busy||uncertain||!state,entry=state?.candidates.find(candidate=>candidate.id===selected),fresh=state?.availability==='current'&&!!state.expiresAt&&Date.parse(state.expiresAt)>Date.now();
 return <section aria-label="Private scheduling review" aria-busy={busy} className="flex min-w-0 flex-col gap-4">
  <Card><CardHeader><CardTitle>Private travel and preferences</CardTitle><CardDescription>Only you and your host assistant can access this review. Decisions apply to one checked time, clear prior proposal decisions and never waive hard conflicts or approve a meeting.</CardDescription></CardHeader>
   <CardContent className="flex min-w-0 flex-col gap-4">
    {state?<><p>Times use {state.timezone}. General buffer: {state.rules.bufferMinutes} minutes. Extra travel buffer: {state.rules.travelBufferMinutes} minutes.</p>
     {!state.detailsComplete?<p>The requester needs to complete their meeting details before private checks can run.</p>:state.availability==='reconnect_required'?<p>Calendar access needs attention. Return to host chat to reconnect; requester Calendar access may also need recovery.</p>:state.availability==='stale'?<p>These private checks are out of date. Check current constraints before making another decision.</p>:state.availability==='idle'?<p>Check current constraints to review travel and preferences for possible times.</p>:state.candidates.length===0?<p>No times in the checked windows passed the initial time filters. Discuss different availability; a preference exception cannot waive a hard conflict.</p>:null}
     {state.truncated?<p>This is a limited sample of possible times. Other times may be possible.</p>:null}
     {fresh?<ul className="flex flex-col gap-2">{state.candidates.map(candidate=><li key={candidate.id}><Button variant="outline" className="min-h-11 h-auto w-full whitespace-normal" disabled={locked} onClick={()=>setSelected(candidate.id)} aria-pressed={selected===candidate.id}>Review {privateTime(candidate.interval,state.timezone)}</Button></li>)}</ul>:null}
    </>:<p role="status">Refresh to load your private review.</p>}
   </CardContent><CardFooter className="flex-wrap gap-2"><Button className="min-h-11 h-auto whitespace-normal" disabled={locked||!state?.detailsComplete} onClick={()=>void act('private/evaluate')}>Check private constraints</Button><Button variant="ghost" className="min-h-11 h-auto whitespace-normal" disabled={busy||disabled} onClick={()=>void refresh()}>Refresh private review</Button></CardFooter>
  </Card>
  {error?<Alert variant="destructive"><AlertTitle>Private review needs attention</AlertTitle><AlertDescription>{error}</AlertDescription>{uncertain&&pending.current?.path!=='private/evaluate'?<Button variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={disabled||busy} onClick={()=>void act(pending.current!.path)}>Retry same private decision</Button>:null}</Alert>:null}
  {notice?<p role="status">{notice}</p>:null}
  {entry&&fresh&&state?<CandidateReview key={entry.id} requestId={requestId} state={state} candidate={entry} disabled={locked} act={act}/>:null}
  {state&&(state.allowances.length>0||state.preferences.length>0)?<Card><CardHeader><CardTitle>Saved private decisions</CardTitle><CardDescription>These are recorded inputs. Fresh evaluation decides whether they still apply to current context.</CardDescription></CardHeader><CardContent className="flex min-w-0 flex-col gap-4">
   {state.allowances.map(decision=><div key={decision.id} className="flex min-w-0 flex-col gap-2 wrap-anywhere"><p>{decision.value.direction==='inbound'?'Inbound':'Outbound'} allowance · {privateTime(decision.candidate,state.timezone)} · {decision.value.durationMinutes} minutes · {decision.value.mode}</p><p>{decision.value.reason}</p><Button variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={locked} onClick={()=>void act('allowances/revoke',{allowanceId:decision.id},decision.candidate)}>Revoke travel allowance</Button></div>)}
   {state.preferences.map(decision=><div key={decision.id} className="flex min-w-0 flex-col gap-2 wrap-anywhere"><p>{preferenceLabels[decision.value.key]} · {privateTime(decision.candidate,state.timezone)} · {decision.value.decision}</p><p>{decision.value.reason}</p><Button variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={locked} onClick={()=>void act('preferences/revoke',{decisionId:decision.id},decision.candidate)}>Revoke preference decision</Button></div>)}
  </CardContent></Card>:null}
 </section>;
}

type Act=(path:string,fields?:Record<string,unknown>,candidate?:Interval)=>Promise<void>;
function CandidateReview({requestId,state,candidate,disabled,act}:{requestId:string;state:PrivateReviewState;candidate:PrivateReviewCandidate;disabled:boolean;act:Act}){
 return <Card role="region" aria-label="Private candidate details"><CardHeader><CardTitle>{privateTime(candidate.interval,state.timezone)}</CardTitle><CardDescription>{candidate.status==='checks_passed'?'These private checks passed. Find meeting times in the shared proposal card before selecting a proposal.':candidate.intervalStatus!=='fits'?'A hard time constraint or missing time context prevents this meeting. Change the meeting details.':'Resolve the items below, then check this time again.'}</CardDescription></CardHeader>
  <CardContent className="flex min-w-0 flex-col gap-5">
   {candidate.travel.map(leg=><section key={leg.direction} aria-label={leg.direction==='inbound'?'Inbound travel review':'Outbound travel review'} className="flex min-w-0 flex-col gap-3"><h3>{leg.direction==='inbound'?'Travel to the meeting':'Travel after the meeting'}</h3><p>{leg.status.replaceAll('_',' ')}{leg.reason?'. '+(legReasons[leg.reason]??'Review the trip context.'):''}</p>{leg.canConfirm?<TravelForm requestId={requestId} revision={state.revision} candidate={candidate} leg={leg} timezone={state.timezone} disabled={disabled} act={act}/>:null}</section>)}
   <section aria-label="Private preference review" className="flex min-w-0 flex-col gap-3"><h3>Your meeting preferences</h3><p className="wrap-anywhere">Mode: {state.rules.meetingMode||'Not specified'}. Preferred places: {state.rules.locations.join(', ')||'Decide per meeting'}.</p>{state.rules.additional?<p className="whitespace-pre-wrap wrap-anywhere">{state.rules.additional}</p>:null}
    {candidate.preferences?.checks.map(check=><div key={check.key} className="flex min-w-0 flex-col gap-2"><p>{preferenceLabels[check.key]}: {check.status}</p>{check.status==='unresolved'&&candidate.canConfirmPreferences?<PreferenceForm requestId={requestId} revision={state.revision} candidate={candidate} preference={check.key} disabled={disabled} act={act}/>:null}</div>)}
    {!candidate.canConfirmPreferences?<p>Resolve time and travel constraints before recording preference decisions.</p>:null}
   </section>
  </CardContent><CardFooter><p>Both trips must fit with the general and extra travel buffers. A manual allowance is a travel estimate, not permission to ignore a conflict.</p></CardFooter>
 </Card>;
}

function PreferenceForm({requestId,revision,candidate,preference,disabled,act}:{requestId:string;revision:number;candidate:PrivateReviewCandidate;preference:'meeting_mode'|'location'|'additional';disabled:boolean;act:Act}){
 const id=useId(),[choice,setChoice]=useState(preference==='additional'?'':'exception'),[classified,setClassified]=useState(false),[reason,setReason]=useState(''),[error,setError]=useState('');
 function submit(event:FormEvent){event.preventDefault();setError('');if(!classified)return;
  const parsed=confirmPreference.safeParse({requestId,revision,evaluationId:candidate.id,confirmed:true,idempotencyKey:crypto.randomUUID(),choice:{key:preference,classification:'preference',decision:choice,reason}});
  if(!parsed.success){setError('Choose a decision and explain your private reason.');return;}
  void act('preferences/confirm',{evaluationId:candidate.id,confirmed:true,choice:parsed.data.choice},candidate.interval);
 }
 return <form onSubmit={submit} aria-label={preferenceLabels[preference]+' decision'}><FieldGroup>
  {preference==='additional'?<FieldSet disabled={disabled}><FieldLegend>How does this preference apply?</FieldLegend><RadioGroup value={choice} onValueChange={setChoice}><Field orientation="horizontal"><RadioGroupItem id={id+'satisfied'} value="satisfied"/><FieldLabel htmlFor={id+'satisfied'}>This time satisfies it</FieldLabel></Field><Field orientation="horizontal"><RadioGroupItem id={id+'exception'} value="exception"/><FieldLabel htmlFor={id+'exception'}>Allow an exception for this time</FieldLabel></Field></RadioGroup></FieldSet>:<p>This time conflicts with the configured preference. Confirmation records an exception for this time.</p>}
  <Field data-disabled={disabled}><FieldLabel htmlFor={id+'reason'}>Private reason</FieldLabel><Textarea id={id+'reason'} value={reason} maxLength={2000} required disabled={disabled} onChange={event=>setReason(event.target.value)}/></Field>
  <Field orientation="horizontal" data-disabled={disabled}><Checkbox id={id+'classification'} checked={classified} disabled={disabled} onCheckedChange={value=>setClassified(value===true)}/><FieldLabel htmlFor={id+'classification'}>I confirm this is a preference, not a hard requirement.</FieldLabel></Field>
  {error?<p role="alert">{error}</p>:null}<Button type="submit" className="min-h-11 h-auto whitespace-normal" disabled={disabled||!classified||!choice||!reason.trim()}>Confirm preference and recheck</Button>
 </FieldGroup></form>;
}

function TravelForm({requestId,revision,candidate,leg,timezone,disabled,act}:{requestId:string;revision:number;candidate:PrivateReviewCandidate;leg:PrivateTravelLeg;timezone:string;disabled:boolean;act:Act}){
 const id=useId(),[mode,setMode]=useState(leg.mode??''),[minutes,setMinutes]=useState(''),[at,setAt]=useState(''),[location,setLocation]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[error,setError]=useState('');
 function submit(event:FormEvent){event.preventDefault();setError('');if(!confirmed)return;
  try{
   const boundary={at:leg.boundary.timeLocked?leg.boundary.at!:localTimeToInstant(at,timezone),location:leg.boundary.locationLocked?leg.boundary.location!:{address:location}};
   const parsed=confirmTravelAllowance.safeParse({requestId,revision,evaluationId:candidate.id,confirmed:true,idempotencyKey:crypto.randomUUID(),allowance:{direction:leg.direction,durationMinutes:Number(minutes),mode,boundary,reason}});
   if(!parsed.success){setError('Provide a mode, a positive whole number of travel minutes, an endpoint, a time and a private reason.');return;}
   void act('allowances/confirm',{evaluationId:candidate.id,confirmed:true,allowance:parsed.data.allowance},candidate.interval);
  }catch(cause){setError(cause instanceof Error?cause.message:'Review your time and location.');}
 }
 return <form onSubmit={submit} aria-label={leg.direction+' manual allowance'}><FieldGroup>
  <FieldSet disabled={disabled}><FieldLegend>Transportation for this trip</FieldLegend><RadioGroup value={mode} onValueChange={setMode} className="flex flex-wrap gap-4">{[['DRIVE','Drive'],['TRANSIT','Transit'],['WALK','Walk'],['BICYCLE','Bicycle']].map(([value,label])=><Field key={value} orientation="horizontal" className="w-auto"><RadioGroupItem id={id+value} value={value}/><FieldLabel htmlFor={id+value}>{label}</FieldLabel></Field>)}</RadioGroup></FieldSet>
  <Field data-disabled={disabled}><FieldLabel htmlFor={id+'minutes'}>Travel duration (minutes)</FieldLabel><Input id={id+'minutes'} type="number" min={1} max={1440} step={1} required value={minutes} disabled={disabled} onChange={event=>setMinutes(event.target.value)}/><FieldDescription>Travel only. Your buffers are added separately.</FieldDescription></Field>
  {leg.boundary.timeLocked?<p>{leg.direction==='inbound'?'Available after previous commitment':'Required at next commitment'}: {privateInstant(leg.boundary.at!,timezone)} · {timezone}. This known boundary cannot be changed here.</p>:<Field data-disabled={disabled}><FieldLabel htmlFor={id+'at'}>{leg.direction==='inbound'?'Available at starting point':'Required at next destination'} ({timezone})</FieldLabel><Input id={id+'at'} type="datetime-local" required value={at} disabled={disabled} onChange={event=>setAt(event.target.value)}/></Field>}
  {leg.boundary.locationLocked?<p className="wrap-anywhere">{leg.direction==='inbound'?'Starting point':'Next destination'}: {place(leg.boundary.location)}. This known location cannot be changed here.</p>:<Field data-disabled={disabled}><FieldLabel htmlFor={id+'location'}>{leg.direction==='inbound'?'Starting point address':'Next destination address'}</FieldLabel><Input id={id+'location'} maxLength={2000} required value={location} disabled={disabled} onChange={event=>setLocation(event.target.value)}/></Field>}
  <Field data-disabled={disabled}><FieldLabel htmlFor={id+'reason'}>Private travel reason</FieldLabel><Textarea id={id+'reason'} required maxLength={2000} value={reason} disabled={disabled} onChange={event=>setReason(event.target.value)}/></Field>
  <Field orientation="horizontal" data-disabled={disabled}><Checkbox id={id+'confirm'} checked={confirmed} disabled={disabled} onCheckedChange={value=>setConfirmed(value===true)}/><FieldLabel htmlFor={id+'confirm'}>I confirm this travel estimate and the endpoint details.</FieldLabel></Field>
  {error?<p role="alert">{error}</p>:null}<Button type="submit" className="min-h-11 h-auto whitespace-normal" disabled={disabled||!confirmed||!minutes||!mode||!reason.trim()}>Confirm allowance and recheck</Button>
 </FieldGroup></form>;
}
