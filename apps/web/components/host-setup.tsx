'use client';
import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {setupState,setupPatch,type SetupState,type SetupPatch} from '../../../lib/contracts/setup.ts';
import {CalendarAnalysis} from './calendar-analysis';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {Textarea} from './ui/textarea';
import {Checkbox} from './ui/checkbox';
import {RadioGroup,RadioGroupItem} from './ui/radio-group';
import {Field,FieldGroup,FieldSet,FieldLegend,FieldLabel,FieldDescription} from './ui/field';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';
type Section='profile'|'schedule'|'mode'|'location'|'travel';
const titles:Record<Section,string>={profile:'Your booking profile',schedule:'Your meeting week',mode:'How would you like to meet?',location:'Where would you like to meet?',travel:'How do you travel?'};
const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const modes={online:'Online only',in_person:'In person',either:'Either'};
const travelModes={DRIVE:'Drive',TRANSIT:'Public transit',WALK:'Walk',BICYCLE:'Bicycle',PER_TRIP:'Depends on the trip'};
async function call(action:string,input?:unknown,signal?:AbortSignal){const response=await fetch('/api/browser/setup/'+action,{method:input===undefined?'GET':'POST',cache:'no-store',signal:signal??AbortSignal.timeout(20_000),headers:{'content-type':'application/json'},...(input===undefined?{}:{body:JSON.stringify(input)})});const data=await response.json();if(!response.ok)throw new Error(data.error?.message??'Setup could not be saved. Try again.');return setupState.parse(data);}
function nextSection(state:SetupState):Section{
 const s=state.draft?.settings??state.confirmed,r=s.rules,p=state.draft?.provenance??{};
 if(!s.handle||!s.displayName)return 'profile';if(!r?.timezone||!r.availability||!r.durationMinutes||r.bufferMinutes===undefined)return 'schedule';
 if(p['rules.meetingMode']!=='host')return 'mode';if(r.meetingMode!=='online'&&p['rules.locationPolicy']!=='host')return 'location';return r.meetingMode==='online'?'schedule':'travel';
}
export function HostSetup({refreshKey,disabled}:{refreshKey:string;disabled:boolean}){
 const [state,setState]=useState<SetupState|null>(null),[editor,setEditor]=useState<{section:Section;base:SetupState}|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
 const pending=useRef<{action:string;input:Record<string,unknown>;identity:string}|null>(null);
 useEffect(()=>{const controller=new AbortController();void call('read',undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setState(value);}).catch(e=>{if(!controller.signal.aborted){setState(null);setError(e.message);}});return()=>controller.abort();},[refreshKey,reload]);
 async function mutate(action:'draft'|'rebase'|'confirm',body:Record<string,unknown>){
  const identity=JSON.stringify({action,body});if(pending.current&&pending.current.identity!==identity){setError('Reload setup before starting another action; the earlier result is not yet confirmed.');return;}
  pending.current??={action,input:{...body,idempotencyKey:crypto.randomUUID()},identity};setBusy(true);setError('');setNotice('');
  try{const next=await call(action,pending.current.input);pending.current=null;setState(next);setEditor(null);setNotice(action!=='confirm'?'Draft updated. Your confirmed settings are unchanged.':'Settings confirmed. Booking and iMessage setup continue separately.');}
  catch(e){setError(e instanceof Error?e.message:'Please retry.');}finally{setBusy(false);}
 }
 const settings=state?.draft?.settings??state?.confirmed,rules=settings?.rules,locked=disabled||busy;
 return <section role="region" aria-label="Your meeting setup" className="flex min-w-0 flex-col gap-4" aria-busy={busy}>
  <FieldSet><FieldLegend>Your meeting setup</FieldLegend><FieldDescription>Preferences stay private drafts until you confirm the exact review. You can describe them in chat or edit a step here.</FieldDescription>
   {!state?<p role="status">Loading setup…</p>:<>
    <CalendarAnalysis setup={state} disabled={locked} onChange={()=>setReload(n=>n+1)}/>
    <p>{state.nextAction==='settings_confirmed'?'Your settings are confirmed.':state.calendarSelected?'Calendar choices are saved. Let’s review your preferences.':'Connect Google and confirm calendar choices above. You can draft preferences meanwhile.'}</p>
    {settings?.displayName?<p>{settings.displayName}{settings.handle?' · '+settings.handle:''}</p>:null}
    {rules?.timezone?<p>{rules.durationMinutes??'—'} minute meetings · {rules.timezone} · {rules.bufferMinutes??'—'} minute meeting buffer</p>:null}
    {rules?.availability?.map((w,i)=><p key={i}>{w.days.map(day=>days[day]).join(', ')}: {w.start}–{w.end}</p>)}
    {rules?.focusBlocks?.length?<p>Additional focus blocks: {rules.focusBlocks.map(w=>new Date(w.start).toLocaleString(undefined,{timeZone:rules.timezone})+' – '+new Date(w.end).toLocaleString(undefined,{timeZone:rules.timezone})).join('; ')}</p>:null}
    {rules?.meetingMode?<p>{modes[rules.meetingMode]}{rules.meetingMode!=='online'?' · '+(rules.locationPolicy==='per_meeting'?'Decide location per meeting':rules.locations?.join(', ')??'Choose locations'):''}</p>:null}
    {rules?.meetingMode&&rules.meetingMode!=='online'?<p>{rules.travelMode&&rules.travelMode!=='NONE'?travelModes[rules.travelMode]:'Choose transportation'} · {rules.travelBufferMinutes??'—'} extra travel minutes, separate from journey time</p>:null}
    {rules?.preferences?<p>{rules.preferences}</p>:null}
    {state.draft&&Object.values(state.draft.provenance).includes('assistant')?<p>Some values are assistant suggestions. Review them before confirming.</p>:null}
    {state.draft?.unresolved.length?<Alert><AlertTitle>Still to clarify</AlertTitle><AlertDescription>{state.draft.unresolved.map(key=>({displayName:'Your display name',handle:'Your booking name',timezone:'Meeting timezone',durationMinutes:'Meeting length',availability:'Weekly meeting times',focusBlocks:'Focus time',bufferMinutes:'Meeting buffer',preferences:'Other preferences',meetingMode:'Meeting mode',locationPolicy:'Location preference',travelMode:'Transportation',travelBufferMinutes:'Extra travel buffer'}[key]??key)).join(' · ')}</AlertDescription></Alert>:null}
    {state.nextAction==='refresh_draft'?<Alert><AlertTitle>Review your preferences again</AlertTitle><AlertDescription>Your calendar choices or saved settings changed. Your draft answers are preserved. Refresh the draft to review them against the current setup before confirming.</AlertDescription><Button disabled={locked} onClick={()=>void mutate('rebase',{expectedRevision:state.revision,rulesVersion:state.rulesVersion})}>Refresh my draft</Button></Alert>:null}
    {!editor&&state.nextAction!=='refresh_draft'&&state.nextAction!=='settings_confirmed'&&state.review?.status!=='pending'?<Button disabled={locked} onClick={()=>setEditor({section:nextSection(state),base:state})}>Continue preferences</Button>:null}
    <div className="flex flex-wrap gap-2">{(Object.keys(titles) as Section[]).filter(s=>rules?.meetingMode!=='online'||!['location','travel'].includes(s)).map(section=><Button key={section} variant="outline" disabled={locked||state.nextAction==='refresh_draft'} onClick={()=>setEditor({section,base:state})}>Edit {section}</Button>)}</div>
    {editor?<SetupEditor key={editor.section+':'+editor.base.revision} section={editor.section} state={editor.base} disabled={locked} onCancel={()=>setEditor(null)} onSave={(patch,unresolved)=>void mutate('draft',{expectedRevision:editor.base.revision,patch,unresolved})}/>:null}
    {state.review?.status==='pending'&&state.calendarGeneration&&state.calendarSelected&&!editor?<Button className="h-auto min-h-11 whitespace-normal" disabled={locked} onClick={()=>void mutate('confirm',{expectedRevision:state.revision,draftRevision:state.review!.draftRevision,reviewRevision:state.review!.revision,rulesVersion:state.rulesVersion,calendarGeneration:state.calendarGeneration,confirmed:true})}>Confirm these meeting settings</Button>:null}
   </>}
  </FieldSet>
  <Button variant="ghost" disabled={locked} onClick={()=>{pending.current=null;setEditor(null);setError('');setReload(n=>n+1);}}>Reload setup</Button>
  {notice?<p role="status">{notice}</p>:null}{error?<Alert variant="destructive"><AlertTitle>Setup needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>:null}
 </section>;
}
function SetupEditor({section,state,disabled,onSave,onCancel}:{section:Section;state:SetupState;disabled:boolean;onSave:(patch:SetupPatch,unresolved:string[])=>void;onCancel:()=>void}){
 const [resolved,setResolved]=useState(false);
 const id=useId(),s=state.draft?.settings??state.confirmed,r=s.rules,p=state.draft?.provenance??{};
 const [name,setName]=useState(s.displayName??''),[handle,setHandle]=useState(s.handle??''),[timezone,setTimezone]=useState(r?.timezone??Intl.DateTimeFormat().resolvedOptions().timeZone),[duration,setDuration]=useState(r?.durationMinutes??30),[buffer,setBuffer]=useState(r?.bufferMinutes??10),[windows,setWindows]=useState(r?.availability??[{days:[1,2,3,4,5],start:'13:00',end:'17:00'}]),[preferences,setPreferences]=useState(r?.preferences??'');
 const [mode,setMode]=useState(p['rules.meetingMode']==='host'?r?.meetingMode??'':''),[location,setLocation]=useState(p['rules.locationPolicy']==='host'?r?.locationPolicy??'':''),[locations,setLocations]=useState(r?.locations?.join('\n')??''),[travel,setTravel]=useState(p['rules.travelMode']==='host'?r?.travelMode??'':''),[extra,setExtra]=useState(r?.travelBufferMinutes??15),[error,setError]=useState('');
 function choices(label:string,value:string,options:Record<string,string>,change:(v:string)=>void){return <FieldSet><FieldLegend variant="label">{label}</FieldLegend><RadioGroup value={value} onValueChange={change}>{Object.entries(options).map(([v,text])=><Field key={v} orientation="horizontal"><RadioGroupItem id={id+v} value={v}/><FieldLabel htmlFor={id+v}>{text}</FieldLabel></Field>)}</RadioGroup></FieldSet>;}
 function submit(e:FormEvent){e.preventDefault();try{const patch=section==='profile'?{handle,displayName:name}:section==='schedule'?{rules:{timezone,durationMinutes:duration,bufferMinutes:buffer,availability:windows,focusBlocks:r?.focusBlocks??[],preferences}}:section==='mode'?{rules:{meetingMode:mode}}:section==='location'?{rules:{locationPolicy:location,locations:location==='preferred'?locations.split('\n').map(v=>v.trim()).filter(Boolean):[]}}:{rules:{travelMode:travel,travelBufferMinutes:extra}};onSave(setupPatch.parse(patch),resolved?[]:state.draft?.clarifications??[]);setError('');}catch{setError('Choose the requested options and check times, names and numeric limits.');}}
 return <form onSubmit={submit}><FieldSet disabled={disabled}><FieldLegend>{titles[section]}</FieldLegend><FieldGroup>
  {section==='profile'?<><Field><FieldLabel htmlFor={id+'name'}>Display name</FieldLabel><Input id={id+'name'} value={name} maxLength={120} onChange={e=>setName(e.target.value)} required/></Field><Field><FieldLabel htmlFor={id+'handle'}>Booking name</FieldLabel><Input id={id+'handle'} value={handle} maxLength={40} pattern="[a-z][a-z0-9-]{2,39}" onChange={e=>setHandle(e.target.value)} required/><FieldDescription>3–40 lowercase letters, numbers or hyphens, starting with a letter.</FieldDescription></Field></>:null}
  {section==='schedule'?<>
   <FieldDescription>Without saved preferences, the suggested starting point is 30-minute meetings on weekday afternoons with a 10-minute meeting buffer. These are editable defaults, not Calendar analysis.</FieldDescription>
   <Field><FieldLabel htmlFor={id+'zone'}>Meeting timezone</FieldLabel><Input id={id+'zone'} value={timezone} onChange={e=>setTimezone(e.target.value)} required/></Field>
   <Field><FieldLabel htmlFor={id+'duration'}>Meeting duration (minutes)</FieldLabel><Input id={id+'duration'} type="number" min={5} max={240} value={duration} onChange={e=>setDuration(Number(e.target.value))} required/></Field>
   <Field><FieldLabel htmlFor={id+'buffer'}>Meeting buffer (minutes)</FieldLabel><Input id={id+'buffer'} type="number" min={0} max={240} value={buffer} onChange={e=>setBuffer(Number(e.target.value))} required/></Field>
   {windows.map((w,index)=><FieldSet key={index}><FieldLegend variant="label">Window {index+1}</FieldLegend><div className="flex flex-wrap gap-3">{days.map((day,n)=><Field key={day} orientation="horizontal" className="w-auto"><Checkbox id={id+index+day} checked={w.days.includes(n)} onCheckedChange={checked=>setWindows(all=>all.map((item,i)=>i===index?{...item,days:checked?[...item.days,n].sort():item.days.filter(d=>d!==n)}:item))}/><FieldLabel htmlFor={id+index+day}>{day}</FieldLabel></Field>)}</div><Field><FieldLabel htmlFor={id+'from'+index}>Window start {index+1}</FieldLabel><Input id={id+'from'+index} type="time" value={w.start} onChange={e=>setWindows(all=>all.map((item,i)=>i===index?{...item,start:e.target.value}:item))}/></Field><Field><FieldLabel htmlFor={id+'until'+index}>Window end {index+1}</FieldLabel><Input id={id+'until'+index} type="time" value={w.end} onChange={e=>setWindows(all=>all.map((item,i)=>i===index?{...item,end:e.target.value}:item))}/></Field>{windows.length>1?<Button type="button" variant="ghost" onClick={()=>setWindows(all=>all.filter((_,i)=>i!==index))}>Remove window {index+1}</Button>:null}</FieldSet>)}
   <Button type="button" variant="outline" disabled={windows.length>=21} onClick={()=>setWindows(all=>[...all,{days:[1],start:'09:00',end:'12:00'}])}>Add weekly window</Button>
   <Field><FieldLabel htmlFor={id+'preferences'}>Other preferences</FieldLabel><Textarea id={id+'preferences'} value={preferences} maxLength={5000} onChange={e=>setPreferences(e.target.value)}/></Field>
  </>:null}
  {section==='mode'?choices('Choose a meeting mode',mode,modes,v=>setMode(v as typeof mode)):null}
  {section==='location'?<>{choices('Location preference',location,{per_meeting:'Decide per meeting',preferred:'Preferred areas or venues'},v=>setLocation(v as typeof location))}{location==='preferred'?<Field><FieldLabel htmlFor={id+'locations'}>Preferred areas or venues, one per line</FieldLabel><Textarea id={id+'locations'} value={locations} onChange={e=>setLocations(e.target.value)} required/></Field>:null}</>:null}
  {section==='travel'?<>{choices('Transportation',travel,travelModes,v=>setTravel(v as typeof travel))}<Field><FieldLabel htmlFor={id+'extra'}>Extra travel buffer (minutes)</FieldLabel><Input id={id+'extra'} type="number" min={0} max={240} value={extra} onChange={e=>setExtra(Number(e.target.value))} required/><FieldDescription>Suggested starting point: 15 minutes in addition to the estimated journey. Confirm or edit it. Routes are checked separately for each actual meeting.</FieldDescription></Field></>:null}
  {state.draft?.clarifications.length?<Field orientation="horizontal"><Checkbox id={id+'resolved'} checked={resolved} onCheckedChange={value=>setResolved(value===true)}/><FieldLabel htmlFor={id+'resolved'}>These edits resolve the outstanding questions: {state.draft.clarifications.join('; ')}</FieldLabel></Field>:null}
  {error?<p role="alert">{error}</p>:null}<Button type="submit" className="h-auto min-h-11 whitespace-normal">Use these preferences in my draft</Button><Button type="button" variant="ghost" onClick={onCancel}>Cancel edit</Button>
 </FieldGroup></FieldSet></form>;
}
