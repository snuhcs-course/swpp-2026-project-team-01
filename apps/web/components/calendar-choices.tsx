'use client';
import {useEffect,useId,useState} from 'react';
import {calendarCatalog,type CalendarCatalog} from '../../../lib/contracts/calendar.ts';
import {Button} from './ui/button';
import {Checkbox} from './ui/checkbox';
import {RadioGroup,RadioGroupItem} from './ui/radio-group';
import {Field,FieldContent,FieldDescription,FieldGroup,FieldLabel,FieldLegend,FieldSet} from './ui/field';
const writable=(role:string)=>['owner','writer','writerWithoutPrivateAccess'].includes(role);
async function request(action:'list'|'select',signal:AbortSignal,input?:unknown){
  const response=await fetch('/api/browser/calendar/'+action,{method:action==='list'?'GET':'POST',signal,cache:'no-store',headers:{'content-type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error?.message??'Calendar choices could not be loaded. Try again.');
  return result;
}
export function CalendarChoices({disabled}:{disabled:boolean}){
  const id=useId(),[catalog,setCatalog]=useState<CalendarCatalog|null>(null),[conflicts,setConflicts]=useState<string[]>([]),[booking,setBooking]=useState('');
  const [attempt,setAttempt]=useState(0),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');setCatalog(null);
    void request('list',controller.signal).then(result=>{
      if(controller.signal.aborted)return;
      const next=calendarCatalog.parse(result);setCatalog(next);setConflicts(next.conflictCalendarIds);setBooking(next.bookingCalendarId??'');
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[attempt]);
  const available=new Set(catalog?.calendars.map(c=>c.id)),selectedValid=conflicts.length>0&&conflicts.length<=50&&conflicts.every(c=>available.has(c))&&catalog?.calendars.some(c=>c.id===booking&&writable(c.accessRole));
  const unavailable=catalog&&(conflicts.some(c=>!available.has(c))||(booking&&!catalog.calendars.some(c=>c.id===booking&&writable(c.accessRole))));
  async function save(){
    if(!catalog||!selectedValid)return;
    setSaving(true);setError('');setNotice('');
    try{
      const result=await request('select',AbortSignal.timeout(30_000),{generation:catalog.generation,rulesVersion:catalog.rulesVersion,conflictCalendarIds:conflicts,bookingCalendarId:booking});
      setCatalog({...catalog,rulesVersion:result.rulesVersion,conflictCalendarIds:conflicts,bookingCalendarId:booking});setNotice('Calendar choices saved. Your meeting preferences still need confirmation before scheduling.');
    }catch(e){setError(e instanceof Error?e.message:'Please try again.');}
    finally{setSaving(false);}
  }
  return <section aria-label="Calendar choices" aria-busy={loading||saving} className="mt-5 flex min-w-0 flex-col gap-4">
    {loading?<p role="status">Loading your calendars…</p>:null}
    {catalog?<FieldGroup>
      <FieldSet disabled={disabled||saving}>
        <FieldLegend>Calendars to check for conflicts</FieldLegend>
        <FieldDescription>Choose up to 50 calendars whose busy times should block meetings.</FieldDescription>
        {unavailable?<p role="alert">A saved calendar is no longer available with the required access. Review your choices and select a replacement.</p>:null}
        {catalog.calendars.length===0?<p>No calendars are available. Reconnect Google with an account that has calendars.</p>:null}
        {catalog.calendars.map((calendar,index)=><Field key={calendar.id} orientation="horizontal">
          <Checkbox id={id+'-conflict-'+index} checked={conflicts.includes(calendar.id)} onCheckedChange={checked=>{setNotice('');setConflicts(current=>checked?[...current,calendar.id]:current.filter(c=>c!==calendar.id));}}/>
          <FieldContent className="min-w-0 break-words">
            <FieldLabel htmlFor={id+'-conflict-'+index}>{calendar.name}{calendar.primary?' (primary)':''}</FieldLabel>
            <FieldDescription className="break-all">{calendar.id}{calendar.timeZone?' · '+calendar.timeZone:''}</FieldDescription>
          </FieldContent>
        </Field>)}
        {conflicts.some(c=>!available.has(c))?<Button type="button" variant="outline" onClick={()=>{setNotice('');setConflicts(current=>current.filter(c=>available.has(c)));}}>Remove unavailable conflict calendars</Button>:null}
      </FieldSet>
      <FieldSet disabled={disabled||saving}>
        <FieldLegend id={id+'-destination'}>Calendar for confirmed bookings</FieldLegend>
        <FieldDescription>Choose where approved meetings will be created. Read-only calendars cannot receive bookings.</FieldDescription>
        <RadioGroup aria-labelledby={id+'-destination'} value={booking} disabled={disabled||saving} onValueChange={value=>{setBooking(value);setNotice('');}}>
          {catalog.calendars.map((calendar,index)=><Field key={calendar.id} orientation="horizontal" data-disabled={!writable(calendar.accessRole)}>
            <RadioGroupItem id={id+'-booking-'+index} value={calendar.id} disabled={!writable(calendar.accessRole)}/>
            <FieldContent className="min-w-0 break-words">
              <FieldLabel htmlFor={id+'-booking-'+index}>{calendar.name}{!writable(calendar.accessRole)?' (read-only)':''}</FieldLabel>
              <FieldDescription className="break-all">{calendar.id}</FieldDescription>
            </FieldContent>
          </Field>)}
        </RadioGroup>
      </FieldSet>
      <Button disabled={disabled||saving||!selectedValid} onClick={()=>void save()}>{saving?'Saving choices…':'Confirm calendar choices'}</Button>
    </FieldGroup>:null}
    <Button variant="outline" disabled={disabled||loading||saving} onClick={()=>{setNotice('');setAttempt(n=>n+1);}}>Reload calendar choices</Button>
    {notice?<p role="status">{notice}</p>:null}{error?<p role="alert" className="text-destructive">{error} Reconnect Google if access has changed, or reload your choices to try again.</p>:null}
  </section>;
}
