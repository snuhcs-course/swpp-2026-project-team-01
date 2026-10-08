import {useId} from 'react';
import {weeklyWindow,type SetupPatch} from '../../../lib/contracts/setup.ts';

type Windows=NonNullable<NonNullable<SetupPatch['rules']>['availability']>;
const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const week=[1,2,3,4,5,6,0];
const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3));

/** A recurring preference view, not a Calendar availability or booking claim.
 * Exact text accompanies every bar; incomplete form values never draw a range. */
export function WeeklyPreview({windows,timezone,title}:{windows:Windows;timezone?:string;title:string}){
 const id=useId();
 const valid=windows.flatMap(window=>{const parsed=weeklyWindow.safeParse(window);return parsed.success?[parsed.data]:[];});
 return <figure aria-labelledby={id} className="weekly-preview">
  <figcaption id={id} className="font-medium">{title}</figcaption>
  <p className="text-sm text-muted-foreground break-words">{timezone||'Choose a timezone'} · recurring meeting preferences. Actual availability is checked for each request.</p>
  {valid.length<windows.length?<p className="text-sm">Complete the days and start/end times to preview unfinished windows.</p>:null}
  <div className="weekly-preview-scale text-xs text-muted-foreground" aria-hidden="true"><span>00:00</span><span>12:00</span><span>24:00</span></div>
  <ol className="flex flex-col gap-3" aria-label="Weekly meeting windows">
   {week.map(day=>{
    const intervals=valid.filter(w=>w.days.includes(day)).sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end));
    return <li key={day} className="weekly-preview-day">
     <span className="text-sm font-medium">{days[day]}</span>
     <div className="min-w-0">
      <p className="text-sm break-words">{intervals.length?intervals.map(w=>w.start+'–'+w.end).join(', '):'No window chosen'}</p>
      <div className="weekly-preview-track" aria-hidden="true">
       {intervals.map((w,index)=><span key={index} className="weekly-preview-window" style={{left:minutes(w.start)/1440*100+'%',width:(minutes(w.end)-minutes(w.start))/1440*100+'%'}}/>)}
      </div>
     </div>
    </li>;
   })}
  </ol>
 </figure>;
}
