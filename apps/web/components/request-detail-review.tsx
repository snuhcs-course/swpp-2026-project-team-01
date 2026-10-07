'use client';
import {useEffect,useRef,useState} from 'react';
import {requestReviewState,type RequestReviewState} from '../../../lib/contracts/request-review.ts';
import {Button} from './ui/button';
import {Card,CardHeader,CardTitle,CardDescription,CardContent,CardFooter} from './ui/card';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';

const labels={requesterName:'Name',requesterEmail:'Email',purpose:'Purpose',durationMinutes:'Duration',timezone:'Timezone',windows:'Availability',mode:'Meeting mode',location:'Location'};
function display(key:string,value:unknown,timezone?:string):string{
  if(value===null||value===undefined||value===''||(Array.isArray(value)&&!value.length))return 'Not specified';
  if(key==='durationMinutes')return `${value} minutes`;
  if(key==='mode')return value==='in_person'?'In person':'Online';
  if(key==='windows'&&Array.isArray(value))return value.map((window:{start:string;end:string})=>{
    try{const format=new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'shortOffset',timeZone:timezone||'UTC'});return `${format.format(new Date(window.start))} – ${format.format(new Date(window.end))} (${timezone||'UTC'})`;}
    catch{return `${window.start} – ${window.end}`;}
  }).join('\n');
  return String(value);
}
export function RequestDetailReview({requestId,refreshKey,disabled,onAccessLost,onSaved}:{requestId:string;refreshKey:string;disabled:boolean;onAccessLost:()=>void;onSaved?:()=>void}){
  const [state,setState]=useState<RequestReviewState|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
  const pending=useRef<{operation:'apply'|'dismiss';input:{reviewId:string;expectedRevision:number;confirmed:true;idempotencyKey:string}}|null>(null);
  const [uncertain,setUncertain]=useState(false),sequence=useRef(0),accessLost=useRef(onAccessLost);accessLost.current=onAccessLost;
  useEffect(()=>{
    const controller=new AbortController(),current=++sequence.current;
    void (async()=>{try{
      const response=await fetch(`/api/browser/request-review/read?requestId=${encodeURIComponent(requestId)}`,{cache:'no-store',signal:controller.signal});
      if([401,403,404].includes(response.status)){setState(null);accessLost.current();return;}
      if(!response.ok)throw new Error('Could not load your details. Try again.');
      const next=requestReviewState.parse(await response.json());
      if(current!==sequence.current)return;
      setState(next);
      if(!pending.current)setError('');
      // A reload can recover a committed decision after its response was lost.
      if(pending.current&&next.review?.id===pending.current.input.reviewId&&next.review.status!=='pending'){pending.current=null;setUncertain(false);setError('');}
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not load your details.');}})();
    return ()=>controller.abort();
  },[requestId,refreshKey,reload]);
  async function decide(operation:'apply'|'dismiss'){
    const review=state?.review;if(!review||busy)return;
    const action=pending.current??{operation,input:{reviewId:review.id,expectedRevision:review.baseRevision,confirmed:true as const,idempotencyKey:crypto.randomUUID()}};
    pending.current=action;setBusy(true);setError('');++sequence.current;
    try{
      const response=await fetch('/api/browser/request-review/'+action.operation,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId,input:action.input})});
      if([401,403,404].includes(response.status)){setState(null);accessLost.current();return;}
      const body=await response.json();
      if(!response.ok){
        if(response.status<500){pending.current=null;setUncertain(false);setReload(x=>x+1);}else setUncertain(true);
        throw new Error(body.error?.message??'The result could not be confirmed. Retry the same action.');
      }
      setState(requestReviewState.parse(body));pending.current=null;setUncertain(false);onSaved?.();
    }catch(e){if(pending.current)setUncertain(true);setError(e instanceof Error?e.message:'The result could not be confirmed. Retry the same action.');}
    finally{setBusy(false);}
  }
  const review=state?.review,stale=review?.baseRevision!==state?.revision;
  return <>
    {error?<Alert variant="destructive"><AlertTitle>Request details</AlertTitle><AlertDescription>{error}</AlertDescription><Button variant="outline" disabled={busy||disabled} onClick={()=>uncertain&&pending.current?void decide(pending.current.operation):setReload(x=>x+1)}>{uncertain?'Retry same action':'Reload details'}</Button></Alert>:null}
    {review?.status==='pending'?<Card aria-label="Review suggested details">
      <CardHeader><CardTitle>Review suggested details</CardTitle><CardDescription>These changes are a draft. Apply them only when they match your request.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4">
        {Object.keys(review.patch).map(name=>{const key=name as keyof typeof labels;return <div key={key} className="flex flex-col gap-1 break-words"><strong>{labels[key]}</strong><div className="whitespace-pre-wrap">Current: {display(key,state?.details[key],state?.details.timezone)}</div><div className="whitespace-pre-wrap">Suggested: {display(key,review.details[key],review.details.timezone)}</div></div>;})}
        {review.clarifications.length?<Alert><AlertTitle>More information needed</AlertTitle><AlertDescription><ul>{review.clarifications.map((text,i)=><li key={i}>{text}</li>)}</ul><p>Reply in the conversation to clarify before applying.</p></AlertDescription></Alert>:null}
        {stale?<Alert><AlertTitle>Details changed</AlertTitle><AlertDescription>This draft is out of date. Ask the assistant for a current draft or dismiss it.</AlertDescription></Alert>:null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2"><Button className="min-h-11 h-auto whitespace-normal" disabled={disabled||busy||uncertain||stale||!!review.clarifications.length||!Object.keys(review.patch).length} onClick={()=>void decide('apply')}>Apply suggested details</Button><Button className="min-h-11 h-auto whitespace-normal" variant="outline" disabled={disabled||busy||uncertain} onClick={()=>void decide('dismiss')}>Dismiss suggestions</Button></CardFooter>
    </Card>:review?.status==='applied'?<p role="status">Suggested details applied.</p>:review?.status==='dismissed'?<p role="status">Suggestions dismissed. Your saved details are unchanged.</p>:null}
  </>;
}
