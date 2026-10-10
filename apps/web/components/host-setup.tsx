'use client';
import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {setupState,setupPatch,type SetupState,type SetupPatch} from '../../../lib/contracts/setup.ts';
import {setupGuide} from '../../../lib/contracts/setup-guide.ts';
import {SetupGuidance} from './setup-guidance';
import {CalendarAnalysis} from './calendar-analysis';
import {IMessageLink} from './imessage-link';
import {WeeklyPreview} from './weekly-preview';
import {SetupReadyLinks} from './setup-ready-links';
import {Collapsible,CollapsibleTrigger,CollapsibleContent} from './ui/collapsible';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {Textarea} from './ui/textarea';
import {Checkbox} from './ui/checkbox';
import {RadioGroup,RadioGroupItem} from './ui/radio-group';
import {Field,FieldGroup,FieldSet,FieldLegend,FieldLabel,FieldDescription} from './ui/field';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';
type Section='profile'|'schedule'|'mode'|'location'|'travel'|'transport'|'travel_buffer';
const titles:Record<Section,string>={profile:'Your booking profile',schedule:'Your meeting week',mode:'How would you like to meet?',location:'Where would you like to meet?',travel:'How do you travel?',transport:'How do you usually travel?',travel_buffer:'Extra time around travel'};
const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const modes={online:'Online only',in_person:'In person',either:'Either'};
const travelModes={DRIVE:'Drive',TRANSIT:'Public transit',WALK:'Walk',BICYCLE:'Bicycle',PER_TRIP:'Depends on the trip'};
async function call(action:string,input?:unknown,signal?:AbortSignal){const response=await fetch('/api/browser/setup/'+action,{method:input===undefined?'GET':'POST',cache:'no-store',signal:signal??AbortSignal.timeout(20_000),headers:{'content-type':'application/json'},...(input===undefined?{}:{body:JSON.stringify(input)})});const data=await response.json();if(!response.ok)throw new Error(data.error?.message??'Setup could not be saved. Try again.');return setupState.parse(data);}
export function HostSetup({refreshKey,disabled}:{refreshKey:string;disabled:boolean}){
 const [state,setState]=useState<SetupState|null>(null),[editor,setEditor]=useState<{section:Section;base:SetupState}|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
 const [expanded,setExpanded]=useState(false),[loading,setLoading]=useState(true);
 const editorOrigin=useRef<HTMLElement|null>(null),setupHeading=useRef<HTMLLegendElement>(null),savedNotice=useRef<HTMLParagraphElement>(null),restoreFocus=useRef<'origin'|'saved'|null>(null);
 useEffect(()=>{if(editor||busy||!restoreFocus.current)return;const target=restoreFocus.current==='saved'?savedNotice.current:editorOrigin.current;restoreFocus.current=null;if(target?.isConnected&&!target.matches(':disabled'))target.focus();else setupHeading.current?.focus();},[editor,busy,notice]);
 const pending=useRef<{action:string;input:Record<string,unknown>;identity:string}|null>(null);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError('');
  void call('read',undefined,controller.signal)
   .then(value=>{if(!controller.signal.aborted)setState(value);})
   .catch(e=>{if(!controller.signal.aborted){setState(null);setError(e instanceof Error?e.message:'Setup could not be loaded. Try again.');}})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[refreshKey,reload]);
 async function mutate(action:'draft'|'rebase'|'confirm'|'progress',body:Record<string,unknown>){
  const identity=JSON.stringify({action,body});if(pending.current&&pending.current.identity!==identity){setError('Reload setup before starting another action; the earlier result is not yet confirmed.');return;}
  pending.current??={action,input:{...body,idempotencyKey:crypto.randomUUID()},identity};setBusy(true);setError('');setNotice('');
  try{const next=await call(action,pending.current.input);pending.current=null;if(editor)restoreFocus.current='saved';setState(next);setEditor(null);setNotice(action==='progress'?'Your setup choice is remembered. Confirmed settings are unchanged.':action!=='confirm'?'Draft updated. Your confirmed settings are unchanged.':'Settings confirmed. Booking and iMessage setup continue separately.');}
  catch(e){setError(e instanceof Error?e.message:'Please retry.');}finally{setBusy(false);}
 }
 async function refreshAfterAnalysis(){setBusy(true);try{setState(await call('read'));setEditor(null);}finally{setBusy(false);}}
 const settings=state?.draft?.settings??state?.confirmed,rules=settings?.rules,locked=disabled||busy||loading,guide=state?setupGuide(state):null;
 const showReview=state?.review?.status==='pending'&&!!state.calendarGeneration&&state.calendarSelected;
 const openEditor=(section:Section)=>{if(state){editorOrigin.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setEditor({section,base:state});}};
 const progress=(choice:string)=>{if(state)void mutate('progress',{expectedRevision:state.revision,choice});};
 const suggest=(patch:SetupPatch,starterFields?:string[])=>{if(state)void mutate('draft',{expectedRevision:state.revision,patch,...(starterFields?.length?{starterFields}:{}),unresolved:state.draft?.clarifications??[]});};
 return <section role="region" aria-label="Your meeting setup" className="flex min-w-0 flex-col gap-4" aria-busy={busy||loading}>
  <FieldSet><FieldLegend ref={setupHeading} tabIndex={-1}>Your meeting setup</FieldLegend><FieldDescription>Preferences stay private drafts until you confirm the exact review. You can describe them in chat or edit a step here.</FieldDescription>
   {loading?<p role="status">Loading setup…</p>:null}
   {state?<>
    {guide?<SetupGuidance state={state} disabled={locked} editing={!!editor} onEdit={openEditor} onProgress={progress} onUse={suggest} onResolve={()=>void mutate('draft',{expectedRevision:state.revision,patch:{rules:{}},unresolved:state.draft?.clarifications.slice(1)??[]})}/>:null}
    <IMessageLink beforeSettings={state.nextAction!=='settings_confirmed'}/>
    <CalendarAnalysis setup={state} disabled={locked} onSkip={()=>progress('skip_analysis')} onChange={refreshAfterAnalysis}/>
    <p>{state.nextAction==='settings_confirmed'?'Your settings are confirmed.':state.calendarSelected?'Calendar choices are saved. Let’s review your preferences.':'Connect Google and confirm calendar choices above. You can draft preferences meanwhile.'}</p>
    {state.nextAction==='settings_confirmed'&&!locked?<SetupReadyLinks key={[refreshKey,reload,state.revision,state.rulesVersion,state.calendarGeneration].join(':')}/>:null}
    {settings?.displayName?<p className="break-words">{settings.displayName}{settings.handle?' · '+settings.handle:''}</p>:null}
    {rules?.timezone?<p>{rules.durationMinutes??'—'} minute meetings · {rules.timezone} · {rules.bufferMinutes??'—'} minute meeting buffer</p>:null}
    {settings?.displayName||rules?<Collapsible open={!editor&&(showReview||expanded)} onOpenChange={setExpanded} className="flex min-w-0 flex-col gap-3">
     {!showReview?<CollapsibleTrigger asChild><Button className="min-h-11 h-auto whitespace-normal" variant="outline" disabled={locked||!!editor}>{expanded?'Hide preference details':'Show preference details'}</Button></CollapsibleTrigger>:<p>Review your complete draft below. These values are not confirmed yet.</p>}
     <CollapsibleContent className="flex min-w-0 flex-col gap-3">
    {rules?.availability&&editor?.section!=='schedule'?<WeeklyPreview windows={rules.availability} timezone={rules.timezone} title={state.draft&&state.draft.status!=='confirmed'?'Your draft meeting week':'Your confirmed meeting week'}/>:null}
    {rules?.focusBlocks?.length?<p>Additional focus blocks: {rules.focusBlocks.map(w=>new Date(w.start).toLocaleString(undefined,{timeZone:rules.timezone})+' – '+new Date(w.end).toLocaleString(undefined,{timeZone:rules.timezone})).join('; ')}</p>:null}
    {rules?.meetingMode?<p>{modes[rules.meetingMode]}{rules.meetingMode!=='online'?' · '+(rules.locationPolicy==='per_meeting'?'Decide location per meeting':rules.locations?.join(', ')??'Choose locations'):''}</p>:null}
    {rules?.meetingMode&&rules.meetingMode!=='online'?<p>{rules.travelMode&&rules.travelMode!=='NONE'?travelModes[rules.travelMode]:'Choose transportation'} · {rules.travelBufferMinutes??'—'} extra travel minutes, separate from journey time</p>:null}
    {rules?.preferences?<p>{rules.preferences}</p>:null}
    {state.draft&&Object.keys(state.draft.origins).length?<details><summary>Where these preferences came from</summary><ul className="flex flex-col gap-2">{Object.entries(state.draft.origins).map(([field,origin])=><li key={field}>{({timezone:'Meeting timezone',availability:'Weekly meeting windows',durationMinutes:'Meeting duration',bufferMinutes:'Meeting buffer',focusBlocks:'Focus time',preferences:'Other preferences',meetingMode:'Meeting mode',locationPolicy:'Location preference',locations:'Preferred places',travelMode:'Transportation',travelBufferMinutes:'Extra travel buffer',displayName:'Display name',handle:'Booking name'}[field.replace('rules.','')]??field.replace('rules.',''))} · {({host:'You entered or chose this',assistant:'Assistant suggestion',confirmed:'Previously confirmed',calendar:'Calendar suggestion you chose',calendar_edited:'Calendar suggestion you edited',starter:'Starter default you chose'})[origin.source]}{origin.startDate?' · '+origin.startDate+'–'+origin.endDate+' · '+origin.timezone:''}</li>)}</ul></details>:null}
    {state.draft&&Object.values(state.draft.provenance).includes('assistant')?<p>Some values are assistant suggestions. Review them before confirming.</p>:null}
     </CollapsibleContent>
    </Collapsible>:null}
    {state.nextAction==='refresh_draft'?<Alert><AlertTitle>Review your preferences again</AlertTitle><AlertDescription>Your calendar choices or saved settings changed. Your draft answers are preserved. Refresh the draft to review them against the current setup before confirming.</AlertDescription><Button disabled={locked} onClick={()=>void mutate('rebase',{expectedRevision:state.revision,rulesVersion:state.rulesVersion})}>Refresh my draft</Button></Alert>:null}
    <div className="flex flex-wrap gap-2">{(['profile','schedule','mode','location','travel'] as Section[]).filter(s=>rules?.meetingMode!=='online'||!['location','travel'].includes(s)).map(section=><Button key={section} variant="outline" disabled={locked||state.nextAction==='refresh_draft'} onClick={()=>openEditor(section)}>Edit {section}</Button>)}</div>
    {editor?<SetupEditor key={editor.section+':'+editor.base.revision} section={editor.section} state={editor.base} disabled={locked} onCancel={()=>{restoreFocus.current='origin';setEditor(null);}} onSave={(patch,unresolved)=>void mutate('draft',{expectedRevision:editor.base.revision,patch,unresolved})}/>:null}
    {showReview&&!editor?<Button className="h-auto min-h-11 whitespace-normal" disabled={locked} onClick={()=>void mutate('confirm',{expectedRevision:state.revision,draftRevision:state.review!.draftRevision,reviewRevision:state.review!.revision,rulesVersion:state.rulesVersion,calendarGeneration:state.calendarGeneration,confirmed:true})}>Confirm these meeting settings</Button>:null}
   </>:null}
  </FieldSet>
  <Button variant="ghost" disabled={locked} onClick={()=>{pending.current=null;setEditor(null);setError('');setReload(n=>n+1);}}>Reload setup</Button>
  {notice?<p ref={savedNotice} tabIndex={-1} role="status">{notice}</p>:null}{error?<Alert variant="destructive"><AlertTitle>Setup needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>:null}
 </section>;
}
function SetupEditor({section,state,disabled,onSave,onCancel}:{section:Section;state:SetupState;disabled:boolean;onSave:(patch:SetupPatch,unresolved:string[])=>void;onCancel:()=>void}){
 const heading=useRef<HTMLLegendElement>(null);
 useEffect(()=>{heading.current?.focus();},[]);
 const [resolved,setResolved]=useState(false);
 const id=useId(),s=state.draft?.settings??state.confirmed,r=s.rules,p=state.draft?.provenance??{};
 const manual=state.progress.dismissedSuggestions.includes('schedule');
 const [name,setName]=useState(s.displayName??''),[handle,setHandle]=useState(s.handle??''),[timezone,setTimezone]=useState(r?.timezone??(manual?'':Intl.DateTimeFormat().resolvedOptions().timeZone)),[duration,setDuration]=useState<number|''>(r?.durationMinutes??(manual?'':30)),[buffer,setBuffer]=useState<number|''>(r?.bufferMinutes??(manual?'':10)),[windows,setWindows]=useState(r?.availability??(manual?[{days:[],start:'',end:''}]:[{days:[1,2,3,4,5],start:'13:00',end:'17:00'}])),[preferences,setPreferences]=useState(r?.preferences??'');
 const [mode,setMode]=useState(p['rules.meetingMode']==='host'?r?.meetingMode??'':''),[location,setLocation]=useState(p['rules.locationPolicy']==='host'?r?.locationPolicy??'':''),[locations,setLocations]=useState(r?.locations?.join('\n')??''),[travel,setTravel]=useState(p['rules.travelMode']==='host'?r?.travelMode??'':''),[extra,setExtra]=useState(p['rules.travelBufferMinutes']?r?.travelBufferMinutes??15:15),[error,setError]=useState('');
 function choices(label:string,value:string,options:Record<string,string>,change:(v:string)=>void){return <FieldSet><FieldLegend variant="label">{label}</FieldLegend><RadioGroup value={value} onValueChange={change}>{Object.entries(options).map(([v,text])=><Field key={v} orientation="horizontal"><RadioGroupItem id={id+v} value={v}/><FieldLabel htmlFor={id+v}>{text}</FieldLabel></Field>)}</RadioGroup></FieldSet>;}
 function submit(e:FormEvent){e.preventDefault();if(section==='schedule'&&windows.some(w=>w.start&&w.start===w.end)){setError('Start and end must differ. For overnight hours, choose an earlier end time.');return;}try{const patch=section==='profile'?{handle,displayName:name}:section==='schedule'?{rules:{timezone,durationMinutes:duration,bufferMinutes:buffer,availability:windows,focusBlocks:r?.focusBlocks??[],preferences}}:section==='mode'?{rules:{meetingMode:mode}}:section==='location'?{rules:{locationPolicy:location,locations:location==='preferred'?locations.split('\n').map(v=>v.trim()).filter(Boolean):[]}}:section==='transport'?{rules:{travelMode:travel}}:section==='travel_buffer'?{rules:{travelBufferMinutes:extra}}:{rules:{travelMode:travel,travelBufferMinutes:extra}};onSave(setupPatch.parse(patch),resolved?state.draft?.clarifications.slice(1)??[]:state.draft?.clarifications??[]);setError('');}catch{setError('Choose the requested options and check times, names and numeric limits.');}}
 return <form onSubmit={submit}><FieldSet disabled={disabled}><FieldLegend ref={heading} tabIndex={-1}>{titles[section]}</FieldLegend><FieldGroup>
  {section==='profile'?<><Field><FieldLabel htmlFor={id+'name'}>Display name</FieldLabel><Input id={id+'name'} value={name} maxLength={120} onChange={e=>setName(e.target.value)} required/></Field><Field><FieldLabel htmlFor={id+'handle'}>Booking name</FieldLabel><Input id={id+'handle'} value={handle} maxLength={40} pattern="[a-z][a-z0-9-]{2,39}" onChange={e=>setHandle(e.target.value)} required/><FieldDescription>3–40 lowercase letters, numbers or hyphens, starting with a letter.</FieldDescription></Field></>:null}
  {section==='schedule'?<>
   <WeeklyPreview windows={windows} timezone={timezone} title="Your edited meeting week"/>
   <FieldDescription>An end earlier than the start means the next day. Select the day the window starts. Start and end must differ.</FieldDescription>
   {!manual?<FieldDescription>Without saved preferences, the suggested starting point is 30-minute meetings on weekday afternoons with a 10-minute meeting buffer. These are editable defaults, not Calendar analysis.</FieldDescription>:<FieldDescription>Your dismissed defaults stay hidden. Enter the missing values; existing choices are preserved.</FieldDescription>}
   <Field><FieldLabel htmlFor={id+'zone'}>Meeting timezone</FieldLabel><Input id={id+'zone'} value={timezone} onChange={e=>setTimezone(e.target.value)} required/></Field>
   <Field><FieldLabel htmlFor={id+'duration'}>Meeting duration (minutes)</FieldLabel><Input id={id+'duration'} type="number" min={5} max={240} value={duration} onChange={e=>setDuration(e.target.value===''?'':Number(e.target.value))} required/></Field>
   <Field><FieldLabel htmlFor={id+'buffer'}>Meeting buffer (minutes)</FieldLabel><Input id={id+'buffer'} type="number" min={0} max={240} value={buffer} onChange={e=>setBuffer(e.target.value===''?'':Number(e.target.value))} required/></Field>
   {windows.map((w,index)=><FieldSet key={index}><FieldLegend variant="label">Window {index+1}</FieldLegend><div className="flex flex-wrap gap-3">{days.map((day,n)=><Field key={day} orientation="horizontal" className="w-auto"><Checkbox id={id+index+day} checked={w.days.includes(n)} onCheckedChange={checked=>setWindows(all=>all.map((item,i)=>i===index?{...item,days:checked?[...item.days,n].sort():item.days.filter(d=>d!==n)}:item))}/><FieldLabel htmlFor={id+index+day}>{day}</FieldLabel></Field>)}</div><Field><FieldLabel htmlFor={id+'from'+index}>Window start {index+1}</FieldLabel><Input id={id+'from'+index} type="time" value={w.start} onChange={e=>setWindows(all=>all.map((item,i)=>i===index?{...item,start:e.target.value}:item))}/></Field><Field data-invalid={!!w.start&&w.start===w.end}><FieldLabel htmlFor={id+'until'+index}>Window end {index+1}</FieldLabel><Input aria-invalid={!!w.start&&w.start===w.end} id={id+'until'+index} type="time" value={w.end} onChange={e=>setWindows(all=>all.map((item,i)=>i===index?{...item,end:e.target.value}:item))}/></Field>{windows.length>1?<Button type="button" variant="ghost" onClick={()=>setWindows(all=>all.filter((_,i)=>i!==index))}>Remove window {index+1}</Button>:null}</FieldSet>)}
   <Button type="button" variant="outline" disabled={windows.length>=21} onClick={()=>setWindows(all=>[...all,{days:[],start:'',end:''}])}>Add weekly window</Button>
   <Field><FieldLabel htmlFor={id+'preferences'}>Other preferences</FieldLabel><Textarea id={id+'preferences'} value={preferences} maxLength={5000} onChange={e=>setPreferences(e.target.value)}/></Field>
  </>:null}
  {section==='mode'?choices('Choose a meeting mode',mode,modes,v=>setMode(v as typeof mode)):null}
  {section==='location'?<>{choices('Location preference',location,{per_meeting:'Decide per meeting',preferred:'Preferred areas or venues'},v=>setLocation(v as typeof location))}{location==='preferred'?<Field><FieldLabel htmlFor={id+'locations'}>Preferred areas or venues, one per line</FieldLabel><Textarea id={id+'locations'} value={locations} onChange={e=>setLocations(e.target.value)} required/></Field>:null}</>:null}
  {section==='travel'||section==='transport'?choices('Transportation',travel,travelModes,v=>setTravel(v as typeof travel)):null}
  {section==='travel'||section==='travel_buffer'?<Field><FieldLabel htmlFor={id+'extra'}>Extra travel buffer (minutes)</FieldLabel><Input id={id+'extra'} type="number" min={0} max={240} value={extra} onChange={e=>setExtra(Number(e.target.value))} required/><FieldDescription>Suggested starting point: 15 minutes in addition to the estimated journey. Confirm or edit it. Routes are checked separately for each actual meeting.</FieldDescription></Field>:null}
  {state.draft?.clarifications.length?<Field orientation="horizontal"><Checkbox id={id+'resolved'} checked={resolved} onCheckedChange={value=>setResolved(value===true)}/><FieldLabel htmlFor={id+'resolved'}>These edits resolve this question: {state.draft.clarifications[0]}</FieldLabel></Field>:null}
  {error?<p role="alert">{error}</p>:null}<Button type="submit" className="h-auto min-h-11 whitespace-normal">Use these preferences in my draft</Button><Button type="button" variant="ghost" onClick={onCancel}>Cancel edit</Button>
 </FieldGroup></FieldSet></form>;
}
