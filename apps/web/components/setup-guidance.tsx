'use client';
import {useEffect,useRef} from 'react';
import {setupGuide,scheduleSuggestion} from '../../../lib/contracts/setup-guide.ts';
import type {SetupState,SetupPatch} from '../../../lib/contracts/setup.ts';
import {Button} from './ui/button';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';
import {SetupAnswers} from './setup-answers';
type EditStep='profile'|'schedule'|'mode'|'location'|'transport'|'travel_buffer';
const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const modes={online:'Online only',in_person:'In person',either:'Either'};
export function SetupGuidance({state,disabled,editing,onEdit,onProgress,onUse,onResolve}:{state:SetupState;disabled:boolean;editing:boolean;onEdit:(step:EditStep)=>void;onProgress:(choice:string)=>void;onUse:(patch:SetupPatch,starterFields?:string[])=>void;onResolve:()=>void}){
 const guide=setupGuide(state),heading=useRef<HTMLParagraphElement>(null),previous=useRef(guide.step);
 useEffect(()=>{if(previous.current!==guide.step&&!editing)heading.current?.focus();previous.current=guide.step;},[guide.step,editing]);
 const suggestion=scheduleSuggestion(state,Intl.DateTimeFormat().resolvedOptions().timeZone),r=suggestion?.patch.rules;
 const current=state.draft?.settings.rules??state.confirmed.rules,mode=current?.meetingMode??'either';
 const hasExtra=!!state.draft?.provenance['rules.travelBufferMinutes'],extra=hasExtra?current?.travelBufferMinutes??15:15;
 return <section aria-label="Setup guide" className="flex min-w-0 flex-col gap-3">
  <details className="text-sm"><summary className="min-h-11 cursor-pointer py-2">{guide.completed.length} of {guide.total} preference steps complete</summary><p>{guide.completed.length?guide.completed.join(' · '):'Your completed steps will appear here.'}</p></details>
  <p ref={heading} tabIndex={-1}>{guide.question}</p>
  {!editing?<>
   {guide.step==='answers_review'?<SetupAnswers key={state.revision} state={state} disabled={disabled} onUse={onUse} onEdit={onEdit}/>:null}
   {guide.step==='analysis'?<Button variant="outline" className="h-auto min-h-11 whitespace-normal" disabled={disabled} onClick={()=>onProgress('skip_analysis')}>Skip analysis and choose preferences</Button>:null}
   {guide.step==='profile'?<Button disabled={disabled} onClick={()=>onEdit('profile')}>Choose my booking profile</Button>:null}
   {guide.step==='schedule'?suggestion&&r?<Alert><AlertTitle>Suggested meeting week</AlertTitle><AlertDescription>
    <p>{r.durationMinutes} minute meetings · {r.timezone} · {r.bufferMinutes} minute meeting buffer</p>
    {r.availability?.map((w,i)=><p key={i}>{w.days.map(d=>days[d]).join(', ')} · {w.start}–{w.end}</p>)}
    <p>{suggestion.defaults.length?'Starter defaults for missing '+suggestion.defaults.join(', ')+'. Existing draft and confirmed values are preserved.':'These values come from your current draft or confirmed settings.'} Review or adjust before using them.</p>
    <div className="flex flex-wrap gap-2"><Button className="h-auto min-h-11 whitespace-normal" disabled={disabled} onClick={()=>onUse(suggestion.patch,suggestion.starterFields)}>Use this meeting week</Button><Button variant="outline" disabled={disabled} onClick={()=>onEdit('schedule')}>Adjust meeting week</Button><Button variant="ghost" disabled={disabled} onClick={()=>onProgress('dismiss_schedule')}>Choose my own schedule</Button></div>
   </AlertDescription></Alert>:<><p>You dismissed the schedule defaults. Your existing choices stay in place.</p><Button disabled={disabled} onClick={()=>onEdit('schedule')}>Enter my schedule</Button><Button variant="ghost" disabled={disabled} onClick={()=>onProgress('offer_schedule')}>Show schedule suggestions again</Button></>:null}
   {guide.step==='mode'?<>
    {!state.progress.dismissedSuggestions.includes('mode')?<><p>{current?.meetingMode?'Draft suggestion':'Starter option'}: {modes[mode]}. {mode==='either'?'This keeps online and in-person options available. ':''}It becomes your answer only when you choose it.</p><Button disabled={disabled} onClick={()=>onUse({rules:{meetingMode:mode}},current?.meetingMode?undefined:['meetingMode'])}>Choose {modes[mode]}</Button><Button variant="ghost" disabled={disabled} onClick={()=>onProgress('dismiss_mode')}>Dismiss this mode suggestion</Button></>:null}
    <Button variant="outline" disabled={disabled} onClick={()=>onEdit('mode')}>Choose another meeting mode</Button>
   </>:null}
   {guide.step==='location'?<><p>A place observed in Calendar is only a candidate. You can keep the location flexible.</p><Button disabled={disabled} onClick={()=>onUse({rules:{locationPolicy:'per_meeting',locations:[]}})}>Decide location per meeting</Button><Button variant="outline" disabled={disabled} onClick={()=>onEdit('location')}>Choose preferred places</Button></>:null}
   {guide.step==='transport'?<><p>Choose how you travel, or decide for each trip. Actual routes and both travel legs still need checking for each meeting.</p><Button disabled={disabled} onClick={()=>onEdit('transport')}>Choose transportation</Button></>:null}
   {guide.step==='travel_buffer'?<><p>{hasExtra?'Draft suggestion':'Starter suggestion'}: {extra} extra minutes around travel, in addition to the journey estimate.</p><Button disabled={disabled} onClick={()=>onUse({rules:{travelBufferMinutes:extra}},hasExtra?undefined:['travelBufferMinutes'])}>Use {extra} extra travel minutes</Button><Button variant="outline" disabled={disabled} onClick={()=>onEdit('travel_buffer')}>Adjust extra travel buffer</Button></>:null}
   {guide.step==='clarification'?<><p>Answer in chat or edit the relevant step below. Other questions will remain pending.</p><Button disabled={disabled} onClick={onResolve}>I have resolved this question</Button></>:null}
  </>:null}
 </section>;
}
