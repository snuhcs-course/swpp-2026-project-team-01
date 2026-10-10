'use client';
import {useEffect,useId,useState} from 'react';
import {availabilityState,requesterCatalog,type AvailabilityState,type RequesterCatalog} from '../../../lib/contracts/availability.ts';
import {localTimeToInstant,instantToLocalTime} from '../lib/availability-time';
import {Button} from './ui/button';
import {Checkbox} from './ui/checkbox';
import {Input} from './ui/input';
import {Field,FieldContent,FieldDescription,FieldGroup,FieldLabel,FieldLegend,FieldSet} from './ui/field';
async function call(requestId:string,action:string,input?:unknown,signal?:AbortSignal){
  const read=action==='status'||action==='list';
  const response=await fetch('/api/browser/availability/'+action+(read?'?requestId='+encodeURIComponent(requestId):''),{method:read?'GET':'POST',signal,cache:'no-store',headers:{'content-type':'application/json'},...(read?{}:{body:JSON.stringify({requestId,input:input??{}})})});
  const data=await response.json();if(!response.ok)throw new Error(data.error?.message??'Availability could not be confirmed. Try again.');return data;
}
export function RequesterAvailability({requestId,connected,disabled,onManual}:{requestId:string;connected:boolean;disabled:boolean;onManual:()=>void}){
  const id=useId(),[state,setState]=useState<AvailabilityState|null>(null),[catalog,setCatalog]=useState<RequesterCatalog|null>(null),[selected,setSelected]=useState<string[]>([]);
  const [revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[manual,setManual]=useState(false);
  const [timezone,setTimezone]=useState(''),[windows,setWindows]=useState([{start:'',end:''}]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setCatalog(null);setError('');setState(null);
    const status=call(requestId,'status',undefined,controller.signal).then(data=>{
      if(controller.signal.aborted)return;const next=availabilityState.parse(data);setState(next);const zone=next.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone;setTimezone(zone);
      setWindows(next.windows.length?next.windows.map(w=>({start:instantToLocalTime(w.start,zone),end:instantToLocalTime(w.end,zone)})):[{start:'',end:''}]);
    });
    const list=connected?call(requestId,'list',undefined,controller.signal).then(data=>{if(controller.signal.aborted)return;const next=requesterCatalog.parse(data);setCatalog(next);setSelected(next.selectedCalendarIds);}):Promise.resolve();
    void Promise.allSettled([status,list]).then(results=>{if(controller.signal.aborted)return;const failed=results.find(r=>r.status==='rejected');if(failed?.status==='rejected')setError(failed.reason.message);setLoading(false);});
    return()=>controller.abort();
  },[requestId,connected,revision]);
  async function act(action:'select'|'manual'|'check'){
    if(!state)return;setBusy(true);setError('');setNotice('');
    try{
      const input=action==='select'?{generation:catalog?.generation,revision:catalog?.revision,calendarIds:selected}:action==='manual'?{revision:state.revision,confirmed:true,timezone,windows:windows.map(w=>({start:localTimeToInstant(w.start,timezone),end:localTimeToInstant(w.end,timezone)}))}:{};
      await call(requestId,action,input,AbortSignal.timeout(45_000));
      if(action==='check')setState(availabilityState.parse(await call(requestId,'status',undefined,AbortSignal.timeout(15_000))));
      setNotice(action==='select'?'Calendar choices saved for this request.':action==='manual'?'Your entered times now replace Google Calendar checks for this request. Previous meeting decisions need a fresh review.':'Your selected calendars were checked for the requested times. A meeting still needs a proposal, your agreement and host approval.');
      if(action==='manual'){setManual(false);onManual();}
      if(action!=='check')setRevision(n=>n+1);
    }catch(e){setError(e instanceof Error?e.message:'Please try again.');try{setState(availabilityState.parse(await call(requestId,'status')));}catch{setState(null);setCatalog(null);}}finally{setBusy(false);}
  }
  const locked=disabled||busy||loading;
  return <section role="region" aria-label="Your availability" aria-busy={busy||loading} className="mt-5 flex min-w-0 flex-col gap-4">
    {loading?<p role="status">Loading availability choices…</p>:null}
    {state?.mode==='calendar'&&(!connected||state.failed)?<p role="alert">Calendar checks are paused. Reconnect Google or explicitly replace them with times you enter.</p>:null}
    {catalog?<FieldSet disabled={locked}>
      <FieldLegend>Calendars for your availability</FieldLegend>
      <FieldDescription>Choose the calendars to check for this request. Event details stay private.</FieldDescription>
      {catalog.calendars.length===0?<p>No calendars are available. Reconnect with another account or enter your availability manually.</p>:null}
      {catalog.calendars.map((c,index)=><Field key={c.id} orientation="horizontal"><Checkbox id={id+'-calendar-'+index} checked={selected.includes(c.id)} onCheckedChange={checked=>{setNotice('');setSelected(current=>checked?[...current,c.id]:current.filter(v=>v!==c.id));}}/><FieldContent className="min-w-0 break-words"><FieldLabel htmlFor={id+'-calendar-'+index}>{c.name}{c.primary?' (primary)':''}</FieldLabel><FieldDescription className="break-all">{c.id}</FieldDescription></FieldContent></Field>)}
      {selected.some(v=>!catalog.calendars.some(c=>c.id===v))?<Button variant="outline" onClick={()=>setSelected(values=>values.filter(v=>catalog.calendars.some(c=>c.id===v)))}>Remove unavailable calendars</Button>:null}
      <Button disabled={locked||selected.length<1||selected.length>50} onClick={()=>void act('select')}>Confirm availability calendars</Button>
      <Button variant="outline" disabled={locked||!state?.windows.length||!catalog.selectedCalendarIds.length} onClick={()=>void act('check')}>Check my calendars</Button>
      {!state?.windows.length?<FieldDescription>Enter your possible meeting times below before checking calendars.</FieldDescription>:null}
    </FieldSet>:null}
    {state?<>
      <Button variant="outline" disabled={locked} onClick={()=>setManual(value=>!value)}>{manual?'Close manual availability':'Enter availability manually'}</Button>
      {manual?<FieldSet disabled={locked}><FieldLegend>Your possible meeting times</FieldLegend><FieldDescription>Confirming these times disconnects Google for this request and uses these windows instead. Changing the timezone changes the meaning of the entered times.</FieldDescription>
        <Field><FieldLabel htmlFor={id+'-zone'}>Availability timezone</FieldLabel><Input id={id+'-zone'} value={timezone} onChange={e=>setTimezone(e.target.value)} list={id+'-zones'}/><datalist id={id+'-zones'}>{Intl.supportedValuesOf('timeZone').map(zone=><option key={zone} value={zone}/>)}</datalist></Field>
        {windows.map((window,index)=><FieldGroup key={index}>
          <Field><FieldLabel htmlFor={id+'-start-'+index}>Available from {index+1}</FieldLabel><Input id={id+'-start-'+index} type="datetime-local" value={window.start} onChange={e=>setWindows(current=>current.map((w,i)=>i===index?{...w,start:e.target.value}:w))}/></Field>
          <Field><FieldLabel htmlFor={id+'-end-'+index}>Available until {index+1}</FieldLabel><Input id={id+'-end-'+index} type="datetime-local" value={window.end} onChange={e=>setWindows(current=>current.map((w,i)=>i===index?{...w,end:e.target.value}:w))}/></Field>
          {windows.length>1?<Button variant="ghost" onClick={()=>setWindows(current=>current.filter((_,i)=>i!==index))}>Remove time window {index+1}</Button>:null}
        </FieldGroup>)}
        <Button variant="outline" disabled={locked||windows.length>=30} onClick={()=>setWindows(current=>[...current,{start:'',end:''}])}>Add another time window</Button>
        <Button className="h-auto min-h-11 whitespace-normal" disabled={locked||!timezone||windows.some(w=>!w.start||!w.end)} onClick={()=>void act('manual')}>Use these times instead of Google Calendar</Button>
      </FieldSet>:null}
    </>:null}
    <Button variant="outline" disabled={locked} onClick={()=>{setNotice('');setRevision(n=>n+1);}}>Reload availability choices</Button>
    {notice?<p role="status">{notice}</p>:null}{error?<p role="alert" className="text-destructive">{error}{state?.mode==='calendar'?' Calendar-dependent scheduling stays paused until a successful check or explicit manual replacement.':''}</p>:null}
  </section>;
}
