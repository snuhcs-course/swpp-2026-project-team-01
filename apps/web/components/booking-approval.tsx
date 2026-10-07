'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {approvalState,type ApprovalState} from '../../../lib/contracts/booking-approval.ts';
import {Button} from './ui/button';
import {Card,CardHeader,CardTitle,CardDescription,CardContent,CardFooter} from './ui/card';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';
type Decision={requestId:string;revision:number;proposalVersion:number;confirmed:true;idempotencyKey:string};
const reasons:Record<ApprovalState['blocker'],string>={none:'Review the exact details below before approving.',proposal_required:'Choose a current proposal before approval.',agreement_required:'Waiting for the requester to agree to this proposal.',contact_verification_required:'The requester must verify their contact email before booking.',reconnect_required:'Calendar access needs recovery before approval.',proposal_stale:'Meeting context changed. Review a new proposal and requester agreement.',booking_pending:'Booking is pending. The event is not confirmed yet. Check status before taking another action.',closed:'This request is closed.'};
async function call(requestId:string,decision?:Decision,signal?:AbortSignal){
 const response=await fetch('/api/browser/booking-approval/'+(decision?'approve':'state?'+new URLSearchParams({requestId})),{method:decision?'POST':'GET',cache:'no-store',signal,headers:decision?{'content-type':'application/json'}:undefined,body:decision?JSON.stringify(decision):undefined});
 const body=await response.json();signal?.throwIfAborted();
 if(!response.ok)throw Object.assign(new Error(body.error?.message??'Approval status is unavailable.'),{status:response.status});return approvalState.parse(body);
}
export function BookingApprovalCard({requestId,onStatus}:{requestId:string;onStatus:(state:ApprovalState)=>void}){
 const [state,setState]=useState<ApprovalState|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirming,setConfirming]=useState<{revision:number;version:number}|null>(null),[uncertain,setUncertain]=useState(false);
 const heading=useRef<HTMLDivElement>(null);
 const mounted=useRef(false),inFlight=useRef(false),reader=useRef<AbortController|null>(null),pending=useRef<Decision|null>(null),callback=useRef(onStatus);callback.current=onStatus;
 const apply=useCallback((next:ApprovalState)=>{setState(next);callback.current(next);if(pending.current&&(next.revision!==pending.current.revision||!next.canApprove)){pending.current=null;setUncertain(false);}setConfirming(previous=>previous&&(previous.revision!==next.revision||previous.version!==next.proposal?.version)?null:previous);},[]);
 const refresh=useCallback(async()=>{
  if(inFlight.current)return;reader.current?.abort();const controller=new AbortController();reader.current=controller;
  try{const next=await call(requestId,undefined,AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)]));if(!mounted.current||reader.current!==controller)return;apply(next);setError('');return next;}
  catch(cause){if(!mounted.current||controller.signal.aborted||reader.current!==controller)return;setState(null);setError(cause instanceof Error?cause.message:'Approval status is unavailable.');}
 },[requestId,apply]);
 useEffect(()=>{mounted.current=true;inFlight.current=false;void refresh();const wake=()=>{if(document.visibilityState==='visible')void refresh();},timer=setInterval(wake,15_000);addEventListener('focus',wake);return()=>{mounted.current=false;reader.current?.abort();clearInterval(timer);removeEventListener('focus',wake);};},[refresh]);
 useEffect(()=>{if(state?.status==='booking')heading.current?.focus();},[state?.status]);
 async function approve(){
  if(inFlight.current||(!pending.current&&(!state?.canApprove||!state.proposal||confirming?.revision!==state.revision||confirming.version!==state.proposal.version)))return;
  const decision=pending.current??{requestId,revision:state!.revision,proposalVersion:state!.proposal!.version,confirmed:true as const,idempotencyKey:crypto.randomUUID()};
  const retry=!!pending.current;pending.current=decision;inFlight.current=true;reader.current?.abort();setBusy(true);setError('');
  try{
   if(retry){const current=await call(requestId,undefined,AbortSignal.timeout(15_000));if(!mounted.current)return;apply(current);if(!pending.current)return;}
   const next=await call(requestId,decision,AbortSignal.timeout(30_000));if(!mounted.current)return;pending.current=null;setUncertain(false);setConfirming(null);apply(next);
  }catch(cause){if(!mounted.current)return;setState(null);setError(cause instanceof Error?cause.message:'The approval outcome is unknown. Check status before retrying.');setUncertain(true);}
  finally{inFlight.current=false;if(mounted.current)setBusy(false);}
 }
 const proposal=state?.proposal;
 const time=(value:string,zone:string)=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'long',timeZone:zone}).format(new Date(value));
 return <Card role="region" aria-label="Host booking approval" aria-busy={busy}>
  <CardHeader><CardTitle ref={heading} tabIndex={-1}>Approve this meeting</CardTitle><CardDescription>{state?reasons[state.blocker]:'Check the current approval status.'}</CardDescription></CardHeader>
  <CardContent className="flex min-w-0 flex-col gap-3 break-words">
   {proposal?<><p>Proposal {proposal.version} · {time(proposal.start,proposal.timezone)} – {time(proposal.end,proposal.timezone)}<br/>{proposal.timezone}</p><dl className="flex flex-col gap-2"><div><dt>Meeting</dt><dd>{proposal.purpose}</dd></div><div><dt>Requester</dt><dd>{proposal.requesterName}<br/>{proposal.requesterEmail}</dd></div><div><dt>{proposal.mode==='online'?'Online meeting link':'Meeting location'}</dt><dd>{proposal.location}</dd></div></dl><p>{state.requesterAgreed?'Requester agreement is recorded for this proposal.':'Requester agreement is required.'}</p></>:null}
   {state?.approved?<p role="status">Your approval is recorded. Booking still requires current availability checks and a confirmed Calendar event.</p>:null}
   {confirming&&state?.canApprove?<Alert><AlertTitle>Confirm approval of proposal {confirming.version}</AlertTitle><AlertDescription>Approve these exact details and the reviewed private exceptions. Booking will recheck calendars and constraints before creating an event and sending invitations. This action does not mean the event is already booked.</AlertDescription></Alert>:null}
   {error?<Alert variant="destructive"><AlertTitle>Approval needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>:null}
  </CardContent>
  <CardFooter className="flex flex-wrap gap-2">
   {!confirming&&state?.canApprove&&!uncertain?<Button className="min-h-11 h-auto whitespace-normal" disabled={busy} onClick={()=>setConfirming({revision:state.revision,version:state.proposal!.version})}>Review approval</Button>:null}
   {confirming&&state?.canApprove&&!uncertain?<><Button className="min-h-11 h-auto whitespace-normal" disabled={busy} onClick={()=>void approve()}>Confirm approval</Button><Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>setConfirming(null)}>Keep reviewing</Button></>:null}
   <Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>void refresh()}>Check approval status</Button>
   {uncertain&&pending.current&&state?.canApprove?<Button variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={busy} onClick={()=>void approve()}>Retry same approval</Button>:null}
  </CardFooter>
 </Card>;
}
