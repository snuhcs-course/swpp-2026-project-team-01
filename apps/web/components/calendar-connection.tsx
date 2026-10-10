'use client';
import {useEffect,useRef,useState} from 'react';
import {calendarStatus,type CalendarStatus} from '../../../lib/contracts/calendar.ts';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';
import {Collapsible,CollapsibleTrigger,CollapsibleContent} from './ui/collapsible';
import {Button} from './ui/button';
import {CalendarChoices} from './calendar-choices';
import {RequesterAvailability} from './requester-availability';
async function call(action:string,requestId?:string,signal?:AbortSignal){
  const response=await fetch('/api/browser/calendar/'+action+(action==='status'&&requestId?'?requestId='+encodeURIComponent(requestId):''),{method:action==='status'?'GET':'POST',cache:'no-store',signal,headers:{'content-type':'application/json'},...(action==='status'?{}:{body:JSON.stringify(requestId?{requestId}:{})})});
  const data=await response.json();if(!response.ok)throw new Error(data.error?.message??'Calendar connection is unavailable. Try again.');return data;
}
export function CalendarConnection({requestId,onChanged}:{requestId?:string;onChanged?:()=>void}){
  const [status,setStatus]=useState<CalendarStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [loading,setLoading]=useState(true),[reload,setReload]=useState(0);
  const returnResult=useRef<string|null>(null),returned=useRef(false),resultStatus=useRef<HTMLParagraphElement>(null),resultError=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{if(!returned.current||(!notice&&!error))return;const target=error?resultError.current:resultStatus.current;if(target){returned.current=false;target.focus();}},[notice,error]);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setStatus(null);setError('');setNotice('');
    const url=new URL(location.href),result=url.searchParams.get('calendar')??returnResult.current;
    returnResult.current=result;
    if(result){returned.current=true;url.searchParams.delete('calendar');history.replaceState(null,'',url.pathname+url.search+url.hash);}
    void call('status',requestId,AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)])).then(data=>{
      if(controller.signal.aborted)return;
      const current=calendarStatus.parse(data);setStatus(current);
      if(result)setNotice(result==='connected'&&current.connected?'Google connection saved.':result==='denied'?'Google connection was skipped. You can connect when you’re ready.':'Google access could not be confirmed. Start a new connection attempt.');
      else if(reload>0)setNotice('Calendar connection checked.');
    }).catch(()=>{if(!controller.signal.aborted)setError('Calendar connection could not be checked. Retry to see your current connection.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();},[requestId,reload]);
  async function act(action:'start'|'disconnect'){
    if(loading||!status||busy)return;
    setBusy(true);setError('');setNotice('');
    try{const data=await call(action,requestId);if(action==='start'){const url=new URL(data.url);if(url.protocol!=='https:'||url.hostname!=='accounts.google.com')throw new Error('The connection could not be started.');location.assign(url.href);}else{returned.current=true;setStatus(calendarStatus.parse(data));setNotice('Google access has been disconnected from this workspace.');onChanged?.();}}
    catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}
  }
  return <Alert role="region" aria-label="Google Calendar connection" aria-busy={loading||busy}>
    <AlertTitle>{!status?'Google Calendar connection':status.connected?'Google Calendar connected':requestId?'Optionally connect your calendar':'Connect your calendar'}</AlertTitle>
    <AlertDescription>{!status?'Check the saved connection before changing Google access.':status.connected?(requestId?'Google availability permission is saved for this request. Calendar choices still need confirmation before availability checks.':'Your Google permission is saved. Review your calendar choices below. Every booking still needs your approval.'):(requestId?'Choose calendars and share free/busy availability for this request. We won’t request event details or event creation access. You can continue the conversation without connecting.':'Connect Google to choose calendars for conflicts and a booking destination. Every booking will still require your approval.')}</AlertDescription>
    {loading?<p role="status" className="mt-2 text-sm">Checking Google Calendar connection…</p>:null}
    {status?<Collapsible className="mt-3" key={status?.connected?'connected':'disconnected'} defaultOpen={!status?.connected}>
      {status?.connected?<CollapsibleTrigger asChild><Button className="min-h-11 h-auto whitespace-normal" variant="outline">Manage Google connection</Button></CollapsibleTrigger>:null}
      <CollapsibleContent><div className="flex flex-wrap gap-2 py-2">
        <Button variant={status?.connected?'outline':'default'} disabled={busy} onClick={()=>void act('start')}>{busy?'One moment…':status?.connected?'Reconnect Google':'Connect Google Calendar'}</Button>
        {status?.connected?<Button variant="outline" disabled={busy} onClick={()=>void act('disconnect')}>Disconnect Google</Button>:null}
      </div></CollapsibleContent>
    </Collapsible>:null}
    {status?.connected&&!requestId?<CalendarChoices disabled={busy} onSaved={onChanged}/>:null}
    {requestId?<RequesterAvailability requestId={requestId} connected={status?.connected??false} disabled={busy||loading} onManual={()=>{setError('');setStatus({connected:false,kind:'guest',selected:false});}}/>:null}
    {!loading&&!status&&error?<Button variant="outline" className="mt-3 min-h-11" onClick={()=>{returned.current=true;setError('');setLoading(true);setReload(value=>value+1);}}>Retry connection status</Button>:null}
    {notice?<p ref={resultStatus} tabIndex={-1} role="status" className="mt-2 text-sm">{notice}</p>:null}{error?<p ref={resultError} tabIndex={-1} role="alert" className="mt-2 text-sm text-destructive">{error}</p>:null}
  </Alert>;
}
