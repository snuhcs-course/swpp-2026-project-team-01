'use client';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {schedulingState,type SchedulingState} from '../../../lib/contracts/scheduling.ts';
import {detectedTimezone,readTimezonePreference,saveTimezonePreference,validTimezone,intervalLabel} from '../lib/timezone-preference.ts';
import {Input} from './ui/input';
import {Field,FieldLabel,FieldDescription} from './ui/field';
import {Button} from './ui/button';
import {Card,CardHeader,CardTitle,CardDescription,CardContent,CardFooter} from './ui/card';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';

type Operation='evaluate'|'select'|'agree';
type Action={operation:Operation;input:Record<string,unknown>&{revision:number}};
class SchedulingError extends Error {constructor(message:string,readonly status:number){super(message);}}
async function call(requestId:string,audience:'host'|'guest',action?:Action,signal?:AbortSignal){
 const response=await fetch('/api/browser/scheduling/'+(action?action.operation:'state?'+new URLSearchParams({requestId,audience})),{method:action?'POST':'GET',cache:'no-store',signal,headers:action?{'content-type':'application/json'}:undefined,body:action?JSON.stringify({requestId,audience,...action.input}):undefined});
 const body=await response.json();
 if(!response.ok)throw new SchedulingError(body.error?.message??'Meeting details could not be loaded. Try again.',response.status);
 return schedulingState.parse(body);
}
const availabilityText={
 not_evaluated:'Find meeting times using your saved details and current availability.',
 available:'Choose an option, then review the complete proposal before agreeing.',
 clarification:'More information or host review is needed before times can be offered. Ask the assistant about the next step.',
 no_candidates:'No matching times were found in the checked options. Share different availability or meeting details to explore alternatives.',
 stale:'These options need a fresh availability check before you can choose a time.',
 reconnect_required:'Calendar-dependent scheduling is paused. Reconnect your calendar or explicitly enter your availability. The host may also need to reconnect.',
} as const;

export function SchedulingReview({requestId,audience='guest',refreshKey,disabled,onAccessLost,onChanged,onAsk}:{requestId:string;audience?:'host'|'guest';refreshKey:string;disabled:boolean;onAccessLost:()=>void;onChanged?:()=>void;onAsk:(text:string)=>void}){
 const [state,setState]=useState<SchedulingState|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[uncertain,setUncertain]=useState(false),[notice,setNotice]=useState('');
 const pending=useRef<Action|null>(null),inFlight=useRef(false),sequence=useRef(0),mounted=useRef(false),readController=useRef<AbortController|null>(null),callbacks=useRef({onAccessLost,onChanged});callbacks.current={onAccessLost,onChanged};
 const id=useId();
 const [displayTimezone,setDisplayTimezone]=useState(''),[zones,setZones]=useState<string[]>([]),[preferenceNotice,setPreferenceNotice]=useState('');
 useEffect(()=>{setDisplayTimezone(readTimezonePreference()??detectedTimezone());setZones(['UTC',...Intl.supportedValuesOf('timeZone')]);},[]);
 const validDisplay=validTimezone(displayTimezone);
 const refresh=useCallback(async()=>{
  if(inFlight.current)return;
  readController.current?.abort();const controller=new AbortController();readController.current=controller;const current=++sequence.current;
  try{
   const next=await call(requestId,audience,undefined,AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)]));
   if(!mounted.current||current!==sequence.current)return;
   setState(next);
   // Status recovery reports the current state without inventing which action
   // committed. Never replay a decision automatically after a lost response.
   if(pending.current&&(next.revision>pending.current.input.revision||pending.current.operation==='evaluate')){pending.current=null;setUncertain(false);setError('');setNotice('Current meeting state loaded. Review it before another action.');callbacks.current.onChanged?.();}
   else if(!pending.current)setError('');
   return next;
  }catch(e){if(!mounted.current||controller.signal.aborted||current!==sequence.current)return;setState(null);setError(e instanceof Error?e.message:'Could not load the meeting.');if(e instanceof SchedulingError&&[401,403].includes(e.status))callbacks.current.onAccessLost();}
  finally{if(mounted.current&&current===sequence.current)setLoading(false);}
 },[requestId,audience]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;++sequence.current;readController.current?.abort();};},[]);
 useEffect(()=>{void refresh();},[refresh,refreshKey]);
 useEffect(()=>{
  const wake=()=>{if(document.visibilityState==='visible')void refresh();},timer=setInterval(wake,15_000);
  addEventListener('focus',wake);document.addEventListener('visibilitychange',wake);
  return()=>{clearInterval(timer);removeEventListener('focus',wake);document.removeEventListener('visibilitychange',wake);};
 },[refresh]);
 useEffect(()=>{if(!state?.publication)return;const remaining=Date.parse(state.publication.expiresAt)-Date.now();const timer=setTimeout(()=>void refresh(),Math.max(0,remaining)+25);return()=>clearTimeout(timer);},[state?.publication,refresh]);
 async function act(operation:Operation,fields:Record<string,unknown>={}){
  if(inFlight.current||disabled||(!state&&!pending.current))return;
  if(pending.current){if(!await refresh()||!pending.current)return;}
  const action=pending.current??{operation,input:{revision:state!.revision,...fields,...(operation==='evaluate'?{}:{confirmed:true,idempotencyKey:crypto.randomUUID()})}};
  pending.current=action;inFlight.current=true;++sequence.current;readController.current?.abort();setBusy(true);setError('');setNotice('');
  try{
   const next=await call(requestId,audience,action,AbortSignal.timeout(120_000));if(!mounted.current)return;
   setState(next);pending.current=null;setUncertain(false);callbacks.current.onChanged?.();
   setNotice(action.operation==='select'?'Time selected. Review the proposal below before agreeing.':action.operation==='agree'?'Your agreement is saved. The meeting still needs host approval.':'Availability checked. Review the current options.');
  }catch(e){
   if(!mounted.current)return;
   if(e instanceof SchedulingError&&e.status<500){pending.current=null;setUncertain(false);setState(null);if([401,403].includes(e.status))callbacks.current.onAccessLost();}
   else setUncertain(true);
   setError(e instanceof SchedulingError?e.message:'The result could not be confirmed. Check the current status before retrying.');
  }finally{inFlight.current=false;if(mounted.current)setBusy(false);}
 }
 const locked=disabled||busy||uncertain||!state,proposal=state?.proposal,publication=state?.publication;
 const currentPublication=publication&&Date.parse(publication.expiresAt)>Date.now();
 return <section aria-label="Meeting options and proposal" aria-busy={busy||loading} className="flex min-w-0 flex-col gap-4">
  {loading?<p role="status">Loading meeting options…</p>:null}
  {error?<Alert variant="destructive"><AlertTitle>Meeting options need attention</AlertTitle><AlertDescription>{error}</AlertDescription><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={busy||disabled} onClick={()=>void refresh()}>Check current meeting status</Button>{uncertain&&pending.current&&pending.current.operation!=='evaluate'?<Button variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={busy||disabled} onClick={()=>void act(pending.current!.operation)}>Retry same decision</Button>:null}</div></Alert>:null}
  {state?<Field data-invalid={!validDisplay}><FieldLabel htmlFor={id+'-display-zone'}>Display timezone</FieldLabel><Input id={id+'-display-zone'} value={displayTimezone} maxLength={100} list={id+'-display-zones'} aria-invalid={!validDisplay} onChange={e=>{setDisplayTimezone(e.target.value);setPreferenceNotice(saveTimezonePreference(e.target.value)?'':'Your browser cannot save this preference for reloads.');}}/><datalist id={id+'-display-zones'}>{zones.map(zone=><option key={zone} value={zone}/>)}</datalist><FieldDescription>{validDisplay?'Changes how times are shown. To change your availability, edit and confirm your meeting details.':'Choose an IANA timezone, such as Asia/Seoul, before reviewing times.'} {preferenceNotice}</FieldDescription></Field>:null}
  {state?<Card>
   <CardHeader><CardTitle>Find a time together</CardTitle><CardDescription>{state.detailsComplete?availabilityText[state.availability]:'Share the remaining meeting details in the conversation before finding times.'}</CardDescription></CardHeader>
   <CardContent className="flex min-w-0 flex-col gap-4">
    {state.meeting.durationMinutes?<p className="break-words">{state.meeting.durationMinutes} minutes · {state.meeting.mode==='online'?'Online':state.meeting.mode==='in_person'?'In person':'Meeting mode needed'}{state.meeting.location?<><br/>{state.meeting.location}</>:null}</p>:null}
    {publication?.truncated?<p>These are a limited set of checked options. Other times may be possible; share different availability to explore them.</p>:null}
    {currentPublication&&publication.candidates.length?<><p>Times shown in <strong>{displayTimezone}</strong>, with each date’s UTC offset.</p><ul className="flex flex-col gap-3">{publication.candidates.map((candidate,index)=><li key={candidate.id} className="flex min-w-0 flex-col gap-2"><p id={id+'-'+index} className="break-words">{intervalLabel(candidate.interval.start,candidate.interval.end,displayTimezone)}</p><Button variant="outline" className="min-h-11 h-auto w-full whitespace-normal" aria-describedby={id+'-'+index} disabled={locked||!validDisplay} onClick={()=>void act('select',{publicationId:publication.id,candidateId:candidate.id})}>Choose this time</Button></li>)}</ul></>:null}
    {proposal?<p>Choosing another time or finding new options replaces the current proposal and clears previous agreement.</p>:null}
   </CardContent>
   <CardFooter className="flex flex-wrap gap-2"><Button className="min-h-11 h-auto whitespace-normal" disabled={locked||!state.detailsComplete} onClick={()=>void act('evaluate')}>{busy?'Checking your request…':publication||proposal?'Find new options':'Find meeting times'}</Button><Button variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={disabled||busy||uncertain} onClick={()=>onAsk('I’d like to explore different meeting times. Help me update my availability.')}>Ask for alternatives</Button><Button variant="ghost" className="min-h-11 h-auto whitespace-normal" disabled={busy||disabled} onClick={()=>void refresh()}>Refresh meeting</Button></CardFooter>
  </Card>:null}
  {proposal?<Card aria-label="Current meeting proposal">
   <CardHeader><CardTitle>Review your proposal</CardTitle><CardDescription>Proposal {proposal.version} · {state?.requesterAgreed?'Awaiting host approval':'Review all details before agreeing'}</CardDescription></CardHeader>
   <CardContent className="flex min-w-0 flex-col gap-3 break-words"><p>{intervalLabel(proposal.start,proposal.end,displayTimezone)}<br/>Shown in {displayTimezone}. Meeting timezone: {proposal.timezone}.</p><dl className="flex flex-col gap-2"><div><dt>Meeting</dt><dd>{proposal.purpose}</dd></div><div><dt>Requester</dt><dd>{proposal.requesterName}<br/>{proposal.requesterEmail}</dd></div><div><dt>{proposal.mode==='online'?'Online meeting':'In-person location'}</dt><dd>{proposal.location}</dd></div></dl>{!state?.canAgree?<Alert><AlertTitle>Proposal needs a fresh review</AlertTitle><AlertDescription>Availability or meeting details changed. Find new options before agreeing.</AlertDescription></Alert>:null}<p>{state?.requesterAgreed?'Your agreement is saved. This meeting is not booked yet.':'Agreement applies to this exact proposal. The host must approve it before booking.'}</p></CardContent>
   <CardFooter className="flex flex-wrap gap-2">{audience==='guest'?<Button className="min-h-11 h-auto whitespace-normal" disabled={locked||!validDisplay||!state?.canAgree||state.requesterAgreed} onClick={()=>void act('agree',{proposalVersion:proposal.version})}>{state?.requesterAgreed?'Agreement saved':'Agree to this proposal'}</Button>:null}<Button variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={disabled||busy||uncertain} onClick={()=>onAsk('I’d like to change the current meeting proposal. Help me review the details.')}>Request changes</Button></CardFooter>
  </Card>:null}
  {notice?<p role="status">{notice}</p>:null}
 </section>;
}
