'use client';
import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {analysisApplication,type AnalysisApplication,type AnalysisState} from '../../../lib/contracts/calendar-analysis.ts';
import type {SetupState} from '../../../lib/contracts/setup.ts';
import {WeeklyPreview} from './weekly-preview';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {Textarea} from './ui/textarea';
import {Checkbox} from './ui/checkbox';
import {RadioGroup,RadioGroupItem} from './ui/radio-group';
import {Field,FieldGroup,FieldSet,FieldLegend,FieldLabel,FieldDescription} from './ui/field';
const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const modes={online:'Online only',in_person:'In person',either:'Either'};
type Step='schedule'|'mode'|'location'|'review';
type Scan=NonNullable<AnalysisState['scan']>;
export function ScanReview({scan,setup,disabled,onApply,onCancel}:{scan:Scan;setup:SetupState;disabled:boolean;onApply:(choice:Omit<AnalysisApplication,'idempotencyKey'>)=>void;onCancel:()=>void}){
 const heading=useRef<HTMLLegendElement>(null);
 const id=useId(),summary=scan.summary!,current=setup.draft?.settings.rules??setup.confirmed.rules??{},provenance=setup.draft?.provenance??{};
 const known=(name:string)=>provenance['rules.'+name]==='host';
 const knownMode=known('meetingMode'),knownLocation=known('locationPolicy')&&(current.locationPolicy==='per_meeting'||known('locations')&&!!current.locations?.length),knownWindows=known('availability')||!!setup.confirmed.rules?.availability;
 const [step,setStep]=useState<Step>('schedule'),[history,setHistory]=useState<Step[]>([]),[schedule,setSchedule]=useState(summary.windows.length>0),[windows,setWindows]=useState(summary.windows),[mode,setMode]=useState(knownMode?current.meetingMode??'':''),[policy,setPolicy]=useState<'preferred'|'per_meeting'|''>(''),[selected,setSelected]=useState<number[]>([]),[labels,setLabels]=useState(summary.locations.map(p=>p.label)),[manual,setManual]=useState(''),[error,setError]=useState('');
 useEffect(()=>{heading.current?.focus();},[step]);
 function advance(next:Step){setError('');setHistory(previous=>[...previous,step]);setStep(next);}
 function location(){return policy==='per_meeting'?{policy:'per_meeting' as const}:policy==='preferred'?{policy:'preferred' as const,places:[...selected.map(index=>({index,label:labels[index]})),...manual.split('\n').map(label=>label.trim()).filter(Boolean).map(label=>({label}))]}:undefined;}
 function choice(){return {scanId:scan.id,expectedRevision:setup.revision,schedule,...(schedule&&!knownWindows?{windows}:{}),...(!knownMode&&mode?{meetingMode:mode as 'online'|'in_person'|'either'}:{}),...(mode!=='online'&&!knownLocation?{location:location()}: {})};}
 function submit(event:FormEvent){event.preventDefault();setError('');
  if(step==='schedule'){if(schedule&&!knownWindows&&!windows.length){setError('Add a window or skip the schedule suggestion.');return;}advance(!knownMode?'mode':mode!=='online'&&!knownLocation?'location':'review');return;}
  if(step==='mode'){if(!mode){setError('Choose how you want to meet. Observations cannot answer for you.');return;}advance(mode!=='online'&&!knownLocation?'location':'review');return;}
  if(step==='location'){if(!policy||policy==='preferred'&&!selected.length&&!manual.trim()){setError('Choose a place, enter one, or decide per meeting.');return;}advance('review');return;}
  const parsed=analysisApplication.safeParse({...choice(),idempotencyKey:crypto.randomUUID()});if(!parsed.success){setError('Check the selected days, times and places. Each window needs a later end time and each place must be distinct.');return;}
  const {idempotencyKey:_,...input}=parsed.data;onApply(input);
 }
 return <form onSubmit={submit} aria-label="Review Calendar suggestions"><FieldSet disabled={disabled}><FieldLegend ref={heading} tabIndex={-1}>{({schedule:'Review your suggested week',mode:'How would you like to meet?',location:'Choose your meeting places',review:'Review these draft choices'})[step]}</FieldLegend><FieldGroup>
  {step==='schedule'?<>
   {schedule?<WeeklyPreview windows={knownWindows?current.availability??[]:windows} timezone={knownWindows?current.timezone:scan.scope.timezone} title="Your suggested week preview"/>:null}
   <FieldDescription>{summary.windowSource==='calendar'?'These windows come from the bounded Calendar analysis. Edit them if needed.':'These are labeled starter windows for sparse evidence.'} Your existing explicit and confirmed values will be preserved.</FieldDescription>
   <Field orientation="horizontal"><Checkbox id={id+'schedule'} checked={schedule} onCheckedChange={v=>setSchedule(v===true)} disabled={!summary.windows.length}/><FieldLabel htmlFor={id+'schedule'}>Include suggested schedule</FieldLabel></Field>
   {knownWindows?<p>Your chosen weekly windows are preserved. Change them in Edit schedule if needed.</p>:schedule?windows.map((window,index)=><FieldSet key={index}><FieldLegend variant="label">Suggested window {index+1}</FieldLegend><div className="flex flex-wrap gap-3">{days.map((day,n)=><Field key={day} orientation="horizontal" className="w-auto"><Checkbox id={id+'day'+index+n} checked={window.days.includes(n)} onCheckedChange={v=>setWindows(all=>all.map((w,i)=>i===index?{...w,days:v?[...w.days,n].sort():w.days.filter(d=>d!==n)}:w))}/><FieldLabel htmlFor={id+'day'+index+n}>{day}</FieldLabel></Field>)}</div><Field><FieldLabel htmlFor={id+'start'+index}>Suggested start {index+1}</FieldLabel><Input type="time" id={id+'start'+index} value={window.start} onChange={e=>setWindows(all=>all.map((w,i)=>i===index?{...w,start:e.target.value}:w))} required/></Field><Field><FieldLabel htmlFor={id+'end'+index}>Suggested end {index+1}</FieldLabel><Input type="time" id={id+'end'+index} value={window.end} onChange={e=>setWindows(all=>all.map((w,i)=>i===index?{...w,end:e.target.value}:w))} required/></Field>{windows.length>1?<Button type="button" variant="ghost" onClick={()=>setWindows(all=>all.filter((_,i)=>i!==index))}>Remove suggested window {index+1}</Button>:null}</FieldSet>):null}
  </>:null}
  {step==='mode'?<><FieldDescription>{summary.onlineCount} observed entries had a video link and {summary.physicalCount} had a usable place. These counts are evidence, not your preference. Choose explicitly.</FieldDescription><RadioGroup value={mode} onValueChange={setMode}>{Object.entries(modes).map(([value,label])=><Field key={value} orientation="horizontal"><RadioGroupItem id={id+value} value={value}/><FieldLabel htmlFor={id+value}>{label}</FieldLabel></Field>)}</RadioGroup></>:null}
  {step==='location'?<>
   <FieldDescription>Places stay private. Observations never identify home or work, and no place is selected automatically.</FieldDescription>
   <RadioGroup value={policy} onValueChange={v=>setPolicy(v as typeof policy)}>{Object.entries({per_meeting:'Decide per meeting',preferred:'Choose or enter preferred places'}).map(([value,label])=><Field key={value} orientation="horizontal"><RadioGroupItem id={id+value} value={value}/><FieldLabel htmlFor={id+value}>{label}</FieldLabel></Field>)}</RadioGroup>
   {policy==='preferred'?<>
    {summary.locations.map((place,index)=><FieldSet key={index}><FieldLegend variant="label">Private candidate {index+1}</FieldLegend><p className="break-words">“{place.label}” · {place.count} entries</p><Field orientation="horizontal"><Checkbox id={id+'place'+index} checked={selected.includes(index)} onCheckedChange={value=>setSelected(all=>value?[...all,index]:all.filter(i=>i!==index))}/><FieldLabel htmlFor={id+'place'+index}>Choose candidate {index+1}</FieldLabel></Field>{selected.includes(index)?<Field><FieldLabel htmlFor={id+'label'+index}>Preferred place {index+1}</FieldLabel><Input id={id+'label'+index} value={labels[index]} maxLength={500} required onChange={e=>setLabels(all=>all.map((label,i)=>i===index?e.target.value:label))}/></Field>:null}</FieldSet>)}
    <Field><FieldLabel htmlFor={id+'manual'}>Other preferred places, one per line</FieldLabel><Textarea id={id+'manual'} value={manual} onChange={e=>setManual(e.target.value)}/><FieldDescription>Up to ten places total. You can edit a candidate name before using it.</FieldDescription></Field>
   </>:null}
  </>:null}
  {step==='review'?<>
   <p>{schedule?'Include schedule suggestions in '+scan.scope.timezone+'. Existing choices win.':'Keep my current schedule unchanged.'}</p>
   {schedule?<WeeklyPreview windows={knownWindows?current.availability??[]:windows} timezone={knownWindows?current.timezone:scan.scope.timezone} title="Your reviewed meeting week"/>:null}
   <p>{mode?modes[mode as keyof typeof modes]:''}{knownMode?' · Your existing choice':''}</p>
   {mode!=='online'?<p className="break-words">{knownLocation?'Existing location preference retained':policy==='per_meeting'?'Decide location per meeting':[...selected.map(i=>labels[i]),...manual.split('\n').filter(Boolean)].join(' · ')}</p>:null}
   <p>This updates only your private draft. Transportation, extra buffer and the final settings review remain separate.</p>
  </>:null}
  {error?<p role="alert">{error}</p>:null}
  <Button className="h-auto min-h-11 whitespace-normal" type="submit">{step==='review'?'Use reviewed suggestions in draft':'Continue suggestion review'}</Button>
  {history.length?<Button type="button" variant="outline" onClick={()=>{setStep(history[history.length-1]);setHistory(all=>all.slice(0,-1));setError('');}}>Back to previous choice</Button>:null}
  <Button type="button" variant="ghost" onClick={onCancel}>Cancel suggestion review</Button>
 </FieldGroup></FieldSet></form>;
}
