'use client';
import {useCallback,useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {hostRequestPage,hostRequestSummary,hostRequestTarget,type HostRequestPage,type HostRequestSummary} from '../../../lib/contracts/host-requests.ts';
import {BookingReceiptCard} from './booking-receipt.tsx';
import {BookingApprovalCard} from './booking-approval.tsx';
import {RequestLifecycleCard} from './request-lifecycle.tsx';
import {ConversationWorkspace} from './conversation-workspace.tsx';
import {Button} from './ui/button';
import {Card,CardHeader,CardTitle,CardDescription,CardContent,CardFooter} from './ui/card';
import {Field,FieldGroup,FieldLabel,FieldSet,FieldLegend} from './ui/field';
import {Input} from './ui/input';
import {RadioGroup,RadioGroupItem} from './ui/radio-group';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';

type Selection={requestId:string;audience:'host_private'|'request_shared'};
async function read(path:string,signal?:AbortSignal){
 const response=await fetch('/api/browser/host/'+path,{cache:'no-store',signal:signal??AbortSignal.timeout(15_000)}),body=await response.json();
 if(!response.ok)throw Object.assign(new Error(body.error?.message??'Requests could not be loaded. Try again.'),{status:response.status});
 return body;
}
function statusLabel(value:string){return value.replaceAll('_',' ');}

export function HostRequestWorkspace({onAccessLost,onDraftRetained}:{onAccessLost:(draft?:string)=>void;onDraftRetained:(draft:string)=>void}){
 const [selection,setSelection]=useState<Selection|null>(null),[initialized,setInitialized]=useState(false),[picker,setPicker]=useState(false);
 const [selected,setSelected]=useState<HostRequestSummary|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const current=useRef(selection),sequence=useRef(0),onDenied=useRef(onAccessLost),heading=useRef<HTMLDivElement>(null);current.current=selection;onDenied.current=onAccessLost;
 function choose(next:Selection|null){
  sequence.current++;current.current=next;setSelection(next);setSelected(null);setError('');setLoading(!!next);setPicker(false);
  const url=new URL(location.href);url.searchParams.delete('request');url.searchParams.delete('audience');
  if(next){url.searchParams.set('request',next.requestId);url.searchParams.set('audience',next.audience);}
  history.pushState(null,'',url.pathname+url.search+url.hash);
 }
 useEffect(()=>{
  function restore(){
   const params=new URLSearchParams(location.search),requestId=params.get('request');sequence.current++;setSelected(null);setError('');
   const valid=requestId&&hostRequestTarget.safeParse({requestId}).success;
   const next:Selection|null=valid?{requestId,audience:params.get('audience')==='request_shared'?'request_shared':'host_private'}:null;
   current.current=next;setSelection(next);setLoading(!!next);setPicker(false);setInitialized(true);
   if(requestId&&!valid)setError('That request link is invalid. Choose a request below.');
  }
  restore();addEventListener('popstate',restore);return()=>{sequence.current++;removeEventListener('popstate',restore);};
 },[]);
 const refresh=useCallback(async()=>{
  const target=current.current;if(!target)return;
  const ticket=++sequence.current;
  try{const result=hostRequestSummary.parse(await read('request?'+new URLSearchParams({requestId:target.requestId})));
   if(ticket!==sequence.current)return;setSelected(previous=>previous?.requestId===result.requestId&&previous.revision>result.revision?previous:result);setError('');
  }catch(cause){if(ticket!==sequence.current)return;setSelected(null);setError(cause instanceof Error?cause.message:'Could not open this request.');
   if([401,403].includes((cause as {status?:number}).status??0))onDenied.current();
  }finally{if(ticket===sequence.current)setLoading(false);}
 },[]);
 useEffect(()=>{if(!selection)return;void refresh();const focus=()=>{if(document.visibilityState==='visible')void refresh();};
  addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);const timer=setInterval(focus,30_000);
  return()=>{sequence.current++;clearInterval(timer);removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
 },[selection,refresh]);
 useEffect(()=>{if(selected)heading.current?.focus();},[selected?.requestId,selected?.closed,selection?.audience]);
 const id=useId(),active=selected?.requestId===selection?.requestId?selected:null;
 return <div className="flex min-w-0 flex-col gap-4">
  <div className="flex flex-wrap gap-2"><Button variant="outline" className="min-h-11" aria-expanded={picker} aria-controls={id+'picker'} onClick={()=>setPicker(value=>!value)}>Meeting requests</Button>{selection?<Button variant="ghost" className="min-h-11" onClick={()=>choose(null)}>Back to host chat</Button>:null}</div>
  {picker?<RequestPicker id={id+'picker'} onChoose={requestId=>choose({requestId,audience:'host_private'})} onAccessLost={onAccessLost}/>:null}
  {error?<Alert variant="destructive"><AlertTitle>Request unavailable</AlertTitle><AlertDescription>{error}</AlertDescription>{selection?<Button variant="outline" className="min-h-11" onClick={()=>void refresh()}>Retry request</Button>:null}</Alert>:null}
  {loading?<p role="status">Opening your selected request…</p>:null}
  {active&&selection?<Card role="region" aria-label="Selected meeting request">
   <CardHeader><CardTitle className="wrap-anywhere" ref={heading} tabIndex={-1}>{active.title||'Meeting request'}</CardTitle><CardDescription className="wrap-anywhere">{active.requesterName||'Requester'} · {statusLabel(active.status)}{active.proposalVersion?` · Proposal ${active.proposalVersion}`:''}</CardDescription></CardHeader>
   <CardContent>{active.closed?<p>This request is closed. Scheduling controls are no longer available.</p>:<FieldSet><FieldLegend>Conversation audience</FieldLegend><RadioGroup value={selection.audience} onValueChange={audience=>{if(audience==='host_private'||audience==='request_shared')choose({...selection,audience});}}>
    <Field orientation="horizontal"><RadioGroupItem id={id+'private'} value="host_private"/><FieldLabel htmlFor={id+'private'}>Private host review</FieldLabel></Field>
    <Field orientation="horizontal"><RadioGroupItem id={id+'shared'} value="request_shared"/><FieldLabel htmlFor={id+'shared'}>Shared with requester</FieldLabel></Field>
   </RadioGroup></FieldSet>}</CardContent>
   <CardFooter><p>{selection.audience==='host_private'?'This discussion is private to you and your assistant.':'Messages in this discussion are visible to the requester. Keep private calendar details in host review.'}</p></CardFooter>
  </Card>:null}
  {active&&selection&&['booking','booked'].includes(active.status)?<BookingReceiptCard key={selection.requestId+'receipt'} requestId={selection.requestId} audience="host" onStatus={next=>setSelected(previous=>previous?.requestId===next.requestId&&next.revision>=previous.revision?{...previous,status:next.status,closed:next.closed,revision:next.revision}:previous)}/>:null}
  {active&&!active.closed&&selection?<RequestLifecycleCard key={selection.requestId+'closure'} requestId={selection.requestId} audience="host" refreshKey={active.revision} onStatus={next=>setSelected(previous=>previous?.requestId===next.requestId&&next.revision>=previous.revision?{...previous,status:next.status,closed:next.closed,revision:next.revision}:previous)}/>:null}
  {active&&!active.closed&&selection?<BookingApprovalCard key={selection.requestId+'approval'} requestId={selection.requestId} onStatus={next=>setSelected(previous=>previous?.requestId===next.requestId&&next.revision>=previous.revision?{...previous,status:next.status,revision:next.revision,closed:['booked','withdrawn','declined','expired'].includes(next.status)}:previous)}/>:null}
  {initialized&&!selection?<ConversationWorkspace key="host_setup" target={{audience:'host_setup'}} onAccessLost={onAccessLost}/>:active&&!active.closed&&active.status!=='booking'&&selection?<ConversationWorkspace key={selection.requestId+selection.audience} target={selection} onAccessLost={draft=>{if(draft)onDraftRetained(draft);sequence.current++;setSelected(null);setError('Access to this discussion has ended. Refresh the request to check your access.');}} onRequestChanged={()=>void refresh()}/>:null}
 </div>;
}

function RequestPicker({id,onChoose,onAccessLost}:{id:string;onChoose:(id:string)=>void;onAccessLost:()=>void}){
 const [search,setSearch]=useState(''),[status,setStatus]=useState('active'),[query,setQuery]=useState({search:'',status:'active'});
 const [cursor,setCursor]=useState<HostRequestPage['nextCursor']>(null),[page,setPage]=useState<HostRequestPage|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
 const denied=useRef(onAccessLost);denied.current=onAccessLost;
 useEffect(()=>{const controller=new AbortController();setLoading(true);setPage(null);setError('');
  void read('requests?'+new URLSearchParams({...query,...cursor}),AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)])).then(value=>{if(!controller.signal.aborted)setPage(hostRequestPage.parse(value));}).catch(cause=>{
   if(controller.signal.aborted)return;setError(cause instanceof Error?cause.message:'Could not load requests.');if([401,403].includes(cause.status))denied.current();
  }).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();
 },[query,cursor,refresh]);
 function submit(event:FormEvent){event.preventDefault();setCursor(null);setQuery({search:search.trim(),status});}
 return <Card id={id} role="region" aria-label="Meeting request picker"><CardHeader><CardTitle>Choose a meeting request</CardTitle><CardDescription>Search by requester or purpose. Newest requests appear first.</CardDescription></CardHeader>
  <CardContent className="flex min-w-0 flex-col gap-4"><form onSubmit={submit}><FieldGroup>
   <Field><FieldLabel htmlFor={id+'search'}>Search requests</FieldLabel><Input id={id+'search'} value={search} maxLength={200} onChange={event=>setSearch(event.target.value)}/></Field>
   <FieldSet><FieldLegend>Request status</FieldLegend><RadioGroup value={status} onValueChange={setStatus} className="flex flex-wrap gap-4">{[['active','Active'],['closed','Closed'],['all','All']].map(([value,label])=><Field orientation="horizontal" className="w-auto" key={value}><RadioGroupItem id={id+value} value={value}/><FieldLabel htmlFor={id+value}>{label}</FieldLabel></Field>)}</RadioGroup></FieldSet>
   <Button type="submit" variant="outline" className="min-h-11">Search requests</Button>
  </FieldGroup></form>
  {loading?<p role="status">Loading requests…</p>:null}{error?<Alert variant="destructive"><AlertTitle>Could not load requests</AlertTitle><AlertDescription>{error}</AlertDescription><Button variant="outline" className="min-h-11" onClick={()=>setRefresh(value=>value+1)}>Retry list</Button></Alert>:null}
  {page?<><p role="status">{page.requests.length?`${page.requests.length} requests on this page.`:'No requests match this search.'}</p><ul className="flex min-w-0 flex-col gap-3">{page.requests.map(request=><li key={request.requestId} className="flex min-w-0 flex-col gap-1"><p className="wrap-anywhere">{request.title||'Meeting request'} · {request.requesterName||'Requester'} · {statusLabel(request.status)}</p><Button variant="outline" className="min-h-11 self-start" aria-label={'Review '+(request.title||'meeting request')+' from '+(request.requesterName||'requester')} onClick={()=>onChoose(request.requestId)}>Review request</Button></li>)}</ul></>:null}
  </CardContent><CardFooter className="flex-wrap gap-2"><Button variant="ghost" className="min-h-11" disabled={loading} onClick={()=>{setCursor(null);setRefresh(value=>value+1);}}>Refresh newest</Button>{page?.nextCursor?<Button variant="outline" className="min-h-11" disabled={loading} onClick={()=>setCursor(page.nextCursor)}>Older requests</Button>:null}</CardFooter>
 </Card>;
}
