'use client';
import {activeCalendars,calendarLabel} from '../lib/calendar-display';
import {useEffect,useId,useRef,useState} from 'react';
import {calendarCatalog,calendarRecommendations,type CalendarCatalog,type CalendarRecommendations} from '../../../lib/contracts/calendar.ts';
import {Button} from './ui/button';
import {Checkbox} from './ui/checkbox';
import {RadioGroup,RadioGroupItem} from './ui/radio-group';
import {Field,FieldContent,FieldDescription,FieldLabel,FieldLegend,FieldSet} from './ui/field';
const writable=(role:string)=>['owner','writer','writerWithoutPrivateAccess'].includes(role);
async function request(action:'list'|'recommend'|'select',signal:AbortSignal,input?:unknown){
 const response=await fetch('/api/browser/calendar/'+action,{method:action==='list'?'GET':'POST',signal,cache:'no-store',headers:{'content-type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});
 const result=await response.json();if(!response.ok)throw new Error(result.error?.message??'Calendar choices are unavailable. Try again.');return result;
}
export function CalendarChoices({disabled,onSaved,refreshKey}:{disabled:boolean;onSaved?:()=>void;refreshKey?:string}){
 const id=useId(),[catalog,setCatalog]=useState<CalendarCatalog|null>(null),[recommendations,setRecommendations]=useState<CalendarRecommendations|null>(null);
 const [conflicts,setConflicts]=useState<string[]>([]),[booking,setBooking]=useState(''),[step,setStep]=useState<'conflicts'|'booking'|'saved'>('conflicts');
 const [attempt,setAttempt]=useState(0),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const readError=useRef<HTMLParagraphElement>(null),heading=useRef<HTMLLegendElement>(null),change=useRef<HTMLButtonElement>(null),focusNext=useRef(false);
 const cached=useRef<{generation:string;value:CalendarRecommendations}|null>(null);
 useEffect(()=>{if(!loading&&!saving&&focusNext.current){focusNext.current=false;(error?readError.current:step==='saved'?change.current:heading.current)?.focus();}},[step,loading,saving,error]);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError('');setCatalog(null);setNotice('');
  void (async()=>{
   const next=calendarCatalog.parse(await request('list',AbortSignal.any([controller.signal,AbortSignal.timeout(20_000)])));
   if(controller.signal.aborted)return;
   const available=new Set(next.calendars.map(c=>c.id));
   const saved=next.conflictCalendarIds.length>0&&next.conflictCalendarIds.every(c=>available.has(c))&&next.calendars.some(c=>c.id===next.bookingCalendarId&&writable(c.accessRole));
   let suggested:CalendarRecommendations|null=null;
   if(!saved){
    if(cached.current?.generation===next.generation)suggested=cached.current.value;
    else try{
     suggested=calendarRecommendations.parse(await request('recommend',AbortSignal.any([controller.signal,AbortSignal.timeout(45_000)]),{generation:next.generation,rulesVersion:next.rulesVersion}));
     if(!controller.signal.aborted)cached.current={generation:next.generation,value:suggested};
    }catch{if(controller.signal.aborted)return;setNotice('I couldn’t inspect your events. You can choose calendars below.');}
   }
   if(controller.signal.aborted)return;
   setCatalog(next);setRecommendations(suggested);setStep(saved?'saved':'conflicts');
   setConflicts(next.conflictCalendarIds.length?next.conflictCalendarIds:(suggested?.conflictCalendarIds??[]));
   setBooking(next.bookingCalendarId??suggested?.bookingCalendarId??'');
  })().catch(()=>{if(!controller.signal.aborted)setError('Calendar choices could not be loaded.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[attempt,refreshKey]);
 const calendars=activeCalendars(catalog?.calendars??[]),available=new Set(catalog?.calendars.map(c=>c.id));
 const conflictsValid=conflicts.length>0&&conflicts.length<=50&&conflicts.every(c=>available.has(c));
 const bookingValid=catalog?.calendars.some(c=>c.id===booking&&writable(c.accessRole));
 const unavailable=conflicts.some(c=>!available.has(c))||!!booking&&!bookingValid;
 const savedValid=!!catalog&&catalog.conflictCalendarIds.length>0&&catalog.conflictCalendarIds.every(c=>available.has(c))&&catalog.calendars.some(c=>c.id===catalog.bookingCalendarId&&writable(c.accessRole));
 const destination=catalog?.calendars.find(c=>c.id===catalog.bookingCalendarId);
 function go(next:typeof step){focusNext.current=true;setStep(next);setError('');setNotice('');}
 async function save(){
  if(!catalog||!conflictsValid||!bookingValid)return;
  setSaving(true);setError('');setNotice('');
  try{
   const result=await request('select',AbortSignal.timeout(30_000),{generation:catalog.generation,rulesVersion:catalog.rulesVersion,conflictCalendarIds:conflicts,bookingCalendarId:booking});
   setCatalog({...catalog,rulesVersion:result.rulesVersion,conflictCalendarIds:conflicts,bookingCalendarId:booking});go('saved');setNotice('Calendar choices saved.');onSaved?.();
  }catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setSaving(false);}
 }
 return <section aria-label="Calendar choices" aria-busy={loading||saving} className="flex min-w-0 flex-col gap-3">
  {loading?<p role="status">Looking at your calendars and recent/upcoming events…</p>:catalog?<>
   {step==='saved'?<><p className="break-words">{catalog.conflictCalendarIds.length} calendar{catalog.conflictCalendarIds.length===1?'':'s'} checked for conflicts · Bookings in {destination?calendarLabel(destination,catalog.calendars):'Calendar'}</p><Button ref={change} variant="outline" disabled={disabled} onClick={()=>go('conflicts')}>Change calendar choices</Button></>:<>
    {unavailable?<p role="alert">A saved calendar is no longer available. Choose a replacement.</p>:null}
    {catalog.calendars.some(c=>c.active===false&&(conflicts.includes(c.id)||booking===c.id))?<p role="status">Saved hidden or unchecked calendars remain selected. Check them in Google Calendar to edit them here.</p>:null}
    {step==='conflicts'?<>
     <FieldSet disabled={disabled||saving}>
      <FieldLegend ref={heading} tabIndex={-1}>Calendars to check for conflicts</FieldLegend>
      {recommendations?<p className="text-sm text-muted-foreground">I checked event names and activity from the past and next four weeks. Suggested calendars are checked; adjust them below.</p>:null}
      {!calendars.length?<p>No checked calendars. Check a calendar in Google Calendar, then return to this page.</p>:null}
      {calendars.map((calendar,index)=>{
       const evidence=recommendations?.evidence.find(e=>e.calendarId===calendar.id),suggested=recommendations?.conflictCalendarIds.includes(calendar.id);
       return <Field key={calendar.id} orientation="horizontal">
        <Checkbox id={id+'-conflict-'+index} checked={conflicts.includes(calendar.id)} onCheckedChange={checked=>setConflicts(current=>checked?[...new Set([...current,calendar.id])]:current.filter(c=>c!==calendar.id))}/>
        <FieldContent className="min-w-0 break-words"><FieldLabel htmlFor={id+'-conflict-'+index}>{calendarLabel(calendar,catalog.calendars)}{suggested?<span className="text-xs text-muted-foreground">Suggested</span>:null}</FieldLabel>
         {evidence?<FieldDescription>{evidence.eventCount!==null?`${evidence.eventCount}${evidence.status==='partial'?'+':''} events · ${evidence.busyCount}${evidence.status==='partial'?'+':''} busy. `:''}{evidence.reason}{suggested&&evidence.busyCount===0?' Suggested as a starting point.':''}{evidence.status==='partial'?' Partial sample.':''}</FieldDescription>:null}
        </FieldContent>
       </Field>;
      })}
      {conflicts.some(c=>!available.has(c))?<Button variant="outline" onClick={()=>setConflicts(current=>current.filter(c=>available.has(c)))}>Remove unavailable conflict calendars</Button>:null}
     </FieldSet>
     <Button disabled={disabled||saving||!conflictsValid} onClick={()=>go('booking')}>Continue</Button>
    </>:<>
     <FieldSet disabled={disabled||saving}>
      <FieldLegend ref={heading} tabIndex={-1} id={id+'-destination'}>Calendar for confirmed bookings</FieldLegend>
      <p className="text-sm text-muted-foreground">Where should I add meetings after you approve them?</p>
      <RadioGroup aria-labelledby={id+'-destination'} value={booking} disabled={disabled||saving} onValueChange={setBooking}>
       {calendars.map((calendar,index)=><Field key={calendar.id} orientation="horizontal" data-disabled={!writable(calendar.accessRole)}>
        <RadioGroupItem id={id+'-booking-'+index} value={calendar.id} disabled={!writable(calendar.accessRole)}/>
        <FieldContent className="min-w-0 break-words"><FieldLabel htmlFor={id+'-booking-'+index}>{calendarLabel(calendar,catalog.calendars)}{!writable(calendar.accessRole)?' (read-only)':recommendations?.bookingCalendarId===calendar.id?' · Suggested':''}</FieldLabel></FieldContent>
       </Field>)}
      </RadioGroup>
     </FieldSet>
     <div className="flex flex-wrap gap-2"><Button variant="ghost" disabled={disabled||saving} onClick={()=>go('conflicts')}>Back</Button><Button disabled={disabled||saving||!conflictsValid||!bookingValid} onClick={()=>void save()}>{saving?'Saving choices…':'Confirm calendar choices'}</Button></div>
    </>}
    {savedValid?<Button variant="ghost" disabled={disabled||saving} onClick={()=>{setConflicts(catalog.conflictCalendarIds);setBooking(catalog.bookingCalendarId!);go('saved');}}>Cancel calendar edits</Button>:null}
   </>}
  </>:null}
  {notice?<p role="status">{notice}</p>:null}
  {error?<><p ref={readError} tabIndex={-1} role="alert" className="text-destructive">{error}</p><Button variant="outline" disabled={disabled||loading||saving} onClick={()=>{cached.current=null;focusNext.current=true;setAttempt(n=>n+1);}}>Try again</Button></>:null}
 </section>;
}
