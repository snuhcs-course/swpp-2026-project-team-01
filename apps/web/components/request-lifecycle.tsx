'use client';
import {useEffect,useRef,useState} from 'react';
import {requestLifecycleState,type RequestLifecycleState} from '../../../lib/contracts/request-lifecycle.ts';
import {Button} from './ui/button';
import {Card,CardHeader,CardTitle,CardDescription,CardContent,CardFooter} from './ui/card';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';

type Decision={requestId:string;revision:number;confirmed:true;idempotencyKey:string};
export function RequestLifecycleCard({requestId,audience,onStatus,refreshKey}:{refreshKey?:number;requestId:string;audience:'host'|'guest';onStatus:(state:RequestLifecycleState)=>void}){
 const [state,setState]=useState<RequestLifecycleState|null>(null),[confirmation,setConfirmation]=useState<number|null>(null);
 const [pending,setPending]=useState<Decision|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const decision=useRef(pending);decision.current=pending;
 const live=useRef(false),inFlight=useRef(false),current=useRef(state),notify=useRef(onStatus),controller=useRef<AbortController|null>(null),heading=useRef<HTMLDivElement>(null);
 current.current=state;notify.current=onStatus;
 const canClose=(next:RequestLifecycleState)=>audience==='guest'?next.canWithdraw:next.canDecline;
 const verb=audience==='guest'?'Withdraw':'Decline',operation=audience==='guest'?'withdraw':'decline';
 function accept(next:RequestLifecycleState){
  if(!live.current)return;
  const before=current.current;current.current=next;setState(next);setError('');
  if(!before||before.revision!==next.revision||before.status!==next.status||before.closed!==next.closed)notify.current(next);
 }
 async function read(){
  const activeController=controller.current!;
  const response=await fetch('/api/browser/request-lifecycle/state?'+new URLSearchParams({requestId,audience}),{cache:'no-store',signal:AbortSignal.any([activeController.signal,AbortSignal.timeout(15000)])});
  const body=await response.json();activeController.signal.throwIfAborted();if(!response.ok)throw new Error(body.error?.message??'Could not check this request.');
  return requestLifecycleState.parse(body);
 }
 async function refresh(){
  if(inFlight.current)return;const activeController=controller.current!;inFlight.current=true;setBusy(true);
  try{const next=await read();accept(next);if(live.current&&decision.current&&(next.closed||!canClose(next)||next.revision!==decision.current.revision)){setPending(null);setConfirmation(null);}}catch(cause){if(live.current&&controller.current===activeController){setError(cause instanceof Error?cause.message:'Could not check this request.');setState(null);current.current=null;}}
  finally{if(controller.current===activeController){inFlight.current=false;if(live.current)setBusy(false);}}
 }
 useEffect(()=>{
  live.current=true;inFlight.current=false;controller.current=new AbortController();void refresh();
  const focus=()=>{if(document.visibilityState==='visible')void refresh();};
  addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);const timer=setInterval(focus,15000);
  return()=>{live.current=false;controller.current?.abort();clearInterval(timer);removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
 // Parent keys this component by audience and request; action recovery owns the read lock.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 useEffect(()=>{if(live.current)void refresh();},[refreshKey]);
 async function closeRequest(){
  if(inFlight.current)return;
  const input=pending??(confirmation!==null?{requestId,revision:confirmation,confirmed:true as const,idempotencyKey:crypto.randomUUID()}:null);if(!input)return;
  inFlight.current=true;setPending(input);setBusy(true);setError('');
  try{
   const response=await fetch('/api/browser/request-lifecycle/'+operation,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),cache:'no-store',signal:AbortSignal.any([controller.current!.signal,AbortSignal.timeout(15000)])});
   const body=await response.json();if(!response.ok)throw new Error(body.error?.message??'Could not close this request.');
   accept(requestLifecycleState.parse(body));if(live.current){setPending(null);setConfirmation(null);heading.current?.focus();}
  }catch(cause){
   if(!live.current)return;
   const message=cause instanceof Error?cause.message:'The result could not be confirmed.';
   // Read before offering a retry: closure may have committed after its response
   // was lost, or booking may have started. Never invent a cancellation result.
   try{const next=await read();accept(next);if(!live.current)return;
    if(next.closed||!canClose(next)||next.revision!==input.revision){setPending(null);setConfirmation(null);}
    if(!next.closed&&canClose(next))setError(next.revision!==input.revision?'The request changed. Review its current details before confirming again.':message);
   }catch{if(live.current){setState(null);current.current=null;setError('The result is unknown. Check request status before making another decision.');}}
  }finally{inFlight.current=false;if(live.current)setBusy(false);}
 }
 const allowed=state&&(audience==='guest'?state.canWithdraw:state.canDecline),changed=confirmation!==null&&confirmation!==state?.revision;
 return <Card role="region" aria-label="Request status and closure"><CardHeader><CardTitle tabIndex={-1} ref={heading}>Request status</CardTitle><CardDescription>{state?state.status.replaceAll('_',' '):'Check the current status before closing this request.'}</CardDescription></CardHeader>
  <CardContent className="flex min-w-0 flex-col gap-3">
   {state?.status==='booking'&&allowed?<p role="status">Calendar creation has not started. You can still {operation} this request; the server will check again when you confirm.</p>:state?.status==='booking'?<p role="status">Booking is being checked. A calendar event may already exist. Withdrawal and decline are unavailable while the outcome is uncertain.</p>:state?.closed?<p role="status">This request is closed. No further scheduling changes are available here.</p>:<p>{audience==='guest'?'You can withdraw this request before Calendar creation starts.':'You can decline this request before Calendar creation starts.'} Closing a request does not cancel an existing calendar event.</p>}
   {confirmation!==null&&allowed?<Alert><AlertTitle>{verb} this request?</AlertTitle><AlertDescription>This ends scheduling for this request. {changed?'The request has changed. Cancel and review its current details first.':'Confirm only if you want to close it.'}</AlertDescription></Alert>:null}
   {error?<Alert variant="destructive"><AlertTitle>Check request status</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>:null}
  </CardContent><CardFooter className="flex-wrap gap-2">
   {allowed&&!pending&&confirmation===null?<Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>{setConfirmation(state.revision);setError('');}}>{verb} request</Button>:null}
   {allowed&&confirmation!==null?<Button variant="destructive" className="min-h-11" disabled={busy||changed} onClick={()=>void closeRequest()}>{busy?'Checking…':pending?'Retry same decision':'Confirm '+operation}</Button>:null}
   {confirmation!==null&&!pending?<Button variant="ghost" className="min-h-11" disabled={busy} onClick={()=>setConfirmation(null)}>Keep request open</Button>:null}
   {!state||error||pending?<Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>void refresh()}>Check request status</Button>:null}
  </CardFooter></Card>;
}
