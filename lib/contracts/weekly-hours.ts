import type {SetupPatch} from './setup.ts';
type Windows=NonNullable<NonNullable<SetupPatch['rules']>['availability']>;
const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3));
export function weeklyHoursLabel(window:{start:string;end:string}){
 return window.start+'–'+window.end+(window.end<window.start?' (+1 day)':'');
}
/** Display-only day segments. Inputs have passed weeklyWindow validation;
 * the start-day label preserves ownership while the next row shows its tail. */
export function weeklyDaySegments(windows:Windows,day:number){
 return windows.flatMap(window=>{
  const result:{start:number;end:number;label:string}[]=[],overnight=window.end<window.start;
  if(window.days.includes(day))result.push({start:minutes(window.start),end:overnight?1440:minutes(window.end),label:weeklyHoursLabel(window)});
  const previous=(day+6)%7;
  if(overnight&&window.end!=='00:00'&&window.days.includes(previous))result.push({start:0,end:minutes(window.end),label:'00:00–'+window.end+' (from '+days[previous]+')'});
  return result;
 }).sort((a,b)=>a.start-b.start||a.end-b.end);
}
