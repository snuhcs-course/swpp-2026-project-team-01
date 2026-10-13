'use client';
import {useEffect,useRef,useState} from 'react';
import {calendarStatus,type CalendarStatus} from '../../../lib/contracts/calendar.ts';
import {ChatAction} from './chat-action';
import {Dialog,DialogTrigger,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './ui/dialog';
import {Button} from './ui/button';
import {StreamingChatMessage} from './streaming-chat-message';
import {CalendarChoices} from './calendar-choices';
import {RequesterAvailability} from './requester-availability';
async function call(action:string,requestId?:string,signal?:AbortSignal){
  const response=await fetch('/api/browser/calendar/'+action+(action==='status'&&requestId?'?requestId='+encodeURIComponent(requestId):''),{method:action==='status'?'GET':'POST',cache:'no-store',signal,headers:{'content-type':'application/json'},...(action==='status'?{}:{body:JSON.stringify(requestId?{requestId}:{})})});
  const data=await response.json();if(!response.ok)throw new Error(data.error?.message??'Calendar connection is unavailable. Try again.');return data;
}
export function CalendarConnection({requestId,onChanged,introduce=false,refreshKey,onPresentationReady}:{requestId?:string;onChanged?:()=>void;introduce?:boolean;refreshKey?:string;onPresentationReady?:()=>void}){
  const [manage,setManage]=useState(false);
  const [greeted,setGreeted]=useState(!introduce),[spoken,setSpoken]=useState<string|null>(null),[choicesIntroduced,setChoicesIntroduced]=useState(false);
  const connectedMessage=useRef<HTMLDivElement>(null);
  const [status,setStatus]=useState<CalendarStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [loading,setLoading]=useState(true),[reload,setReload]=useState(0);
  useEffect(()=>{if(!introduce)setGreeted(true);},[introduce]);
  useEffect(()=>{if(greeted&&!loading&&!status&&error)onPresentationReady?.();},[greeted,loading,status,error]);
  const returnResult=useRef<string|null>(null),returned=useRef(false),resultStatus=useRef<HTMLParagraphElement>(null),resultError=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{if(!returned.current||(!notice&&!error))return;const target=error?resultError.current:resultStatus.current;if(target){returned.current=false;target.focus();}},[notice,error]);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setStatus(null);setError('');setNotice('');
    const url=new URL(location.href),result=url.searchParams.get('calendar')??returnResult.current;
    returnResult.current=result;
    if(result){returned.current=true;url.searchParams.delete('calendar');history.replaceState(null,'',url.pathname+url.search+url.hash);}
    void call('status',requestId,AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)])).then(data=>{
      if(controller.signal.aborted)return;
      const current=calendarStatus.parse(data);setStatus(current);
      if(result)setNotice(result==='connected'&&current.connected?'':result==='denied'?'Google connection was skipped. You can connect when you’re ready.':'Google access could not be confirmed. Start a new connection attempt.');
      else if(reload>0)setNotice('Calendar connection checked.');
    }).catch(()=>{if(!controller.signal.aborted)setError('Calendar connection could not be checked. Retry to see your current connection.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();},[requestId,reload]);
  async function act(action:'start'|'disconnect'){
    if(loading||!status||busy)return;
    setBusy(true);setError('');setNotice('');
    try{const data=await call(action,requestId);if(action==='start'){const url=new URL(data.url);if(url.protocol!=='https:'||url.hostname!=='accounts.google.com')throw new Error('The connection could not be started.');location.assign(url.href);}else{returned.current=true;setManage(false);setSpoken(null);setChoicesIntroduced(false);setStatus(calendarStatus.parse(data));setNotice('Google access has been disconnected from this workspace.');onChanged?.();}}
    catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}
  }
  return <Dialog open={manage} onOpenChange={setManage}><section role="region" aria-label="Google Calendar connection" aria-busy={loading||busy} className="flex min-w-0 flex-col gap-4">
    {introduce?<StreamingChatMessage text="Hi! I’m Thyme, your scheduling assistant. Let’s set up your meetings together." onComplete={()=>setGreeted(true)}/>:null}
    {greeted&&status?.connected?<>
      <div><Button variant="secondary" disabled className="w-fit">Google Calendar connected</Button></div>
      <div ref={connectedMessage} tabIndex={-1} data-connection-confirmation>
       <StreamingChatMessage key="connected" continuation={introduce} text="Great! Your Google Calendar is connected!" onComplete={()=>{setSpoken('connected');if(returned.current){returned.current=false;connectedMessage.current?.focus();}if(requestId)onPresentationReady?.();}}>
        <DialogTrigger asChild><Button variant="link" className="min-h-11 h-auto w-fit px-0 text-muted-foreground underline underline-offset-4">Manage Google connection</Button></DialogTrigger>
       </StreamingChatMessage>
      </div>
    </>:greeted&&status?<StreamingChatMessage key="disconnected" continuation={introduce} text={requestId?'Optionally connect your calendar to share free/busy availability for this request.':'Could you connect Google Calendar? We’ll choose your calendars next. Nothing gets booked without your approval.'} onComplete={()=>{setSpoken('disconnected');onPresentationReady?.();}}/>:null}
    {greeted&&loading?<p role="status" className="sr-only">Checking Google Calendar connection…</p>:null}
    {status&&!status.connected&&spoken==='disconnected'?<ChatAction title="Google Calendar access"><Button disabled={busy} onClick={()=>void act('start')}>{busy?'One moment…':'Connect Google Calendar'}</Button></ChatAction>:null}
    {status?.connected&&!requestId&&spoken==='connected'?<><StreamingChatMessage continuation text="Let’s choose which calendars to use." onComplete={()=>{setChoicesIntroduced(true);onPresentationReady?.();}}/>{choicesIntroduced?<ChatAction title="Choose calendars"><CalendarChoices refreshKey={refreshKey} disabled={busy} onSaved={onChanged}/></ChatAction>:null}</>:null}
    {requestId?<ChatAction title="Your availability"><RequesterAvailability requestId={requestId} connected={status?.connected??false} disabled={busy||loading} onManual={()=>{setError('');setStatus({connected:false,kind:'guest',selected:false});}}/></ChatAction>:null}
    {!loading&&!status&&error?<Button variant="outline" className="mt-3 min-h-11" onClick={()=>{returned.current=true;setError('');setLoading(true);setReload(value=>value+1);}}>Retry connection status</Button>:null}
    {notice?<p ref={resultStatus} tabIndex={-1} role="status" className="mt-2 text-sm">{notice}</p>:null}{error&&!manage?<p ref={resultError} tabIndex={-1} role="alert" className="mt-2 text-sm text-destructive">{error}</p>:null}
  </section>
    <DialogContent onCloseAutoFocus={event=>{if(!status?.connected){event.preventDefault();resultStatus.current?.focus();}}}>
      <DialogHeader><DialogTitle>Google Calendar settings</DialogTitle><DialogDescription>Manage your Google Calendar connection.</DialogDescription></DialogHeader>
      <div className="flex flex-col gap-2" aria-busy={busy}>
        <Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>void act('start')}>{busy?'One moment…':'Reconnect Google'}</Button>
        <Button variant="destructive" className="min-h-11" disabled={busy} onClick={()=>void act('disconnect')}>Disconnect Google</Button>
      </div>
      {error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
    </DialogContent>
  </Dialog>;
}
