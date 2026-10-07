import {Temporal} from '@js-temporal/polyfill';
import {intervalFeasibilityInput,schedulingInterval,type IntervalFeasibilityInput,type SchedulingInterval} from '../../contracts/interval-feasibility.ts';
import {localTimeToInstant} from '../../contracts/time.ts';

type Range={start:bigint;end:bigint};
const minute=60n*1000000000n;
const max=(a:bigint,b:bigint)=>a>b?a:b,min=(a:bigint,b:bigint)=>a<b?a:b;
function range(value:SchedulingInterval):Range{return {start:Temporal.Instant.from(value.start).epochNanoseconds,end:Temporal.Instant.from(value.end).epochNanoseconds};}
function interval(value:Range):SchedulingInterval{return {start:Temporal.Instant.fromEpochNanoseconds(value.start).toString(),end:Temporal.Instant.fromEpochNanoseconds(value.end).toString()};}
function merge(values:Range[]):Range[]{
 const result:Range[]=[];
 for(const value of values.filter(v=>v.start<v.end).sort((a,b)=>a.start<b.start?-1:a.start>b.start?1:0)){
  const last=result.at(-1);if(last&&value.start<=last.end)last.end=max(last.end,value.end);else result.push({...value});
 }
 return result;
}
function intersect(left:Range[],right:Range[]):Range[]{
 const result:Range[]=[];let i=0,j=0;
 while(i<left.length&&j<right.length){const a=left[i],b=right[j],start=max(a.start,b.start),end=min(a.end,b.end);if(start<end)result.push({start,end});if(a.end<=b.end)i++;else j++;}
 return merge(result);
}
function subtract(available:Range[],blocked:Range[]):Range[]{
 const result:Range[]=[];let index=0;
 for(const source of available){let start=source.start;while(index<blocked.length&&blocked[index].end<=start)index++;
  for(let i=index;i<blocked.length&&blocked[i].start<source.end;i++){const block=blocked[i];if(block.start>start)result.push({start,end:min(source.end,block.start)});start=max(start,block.end);if(start>=source.end)break;}
  if(start<source.end)result.push({start,end:source.end});
 }
 return result;
}
export type IntervalEvaluation={status:'ready';windows:SchedulingInterval[];durationMinutes:number;requesterTimezone:string}|{status:'clarification';windows:[];reason:'host_clock_change';dates:string[]};

/** Computes time-only feasibility. Travel, preferences, current authority and
 * versioned persistence are additional required gates before offering a slot.
 * All inputs are snapshots; this function performs no provider calls or writes. */
export function evaluateIntervals(raw:IntervalFeasibilityInput):IntervalEvaluation{
 const input=intervalFeasibilityInput.parse(raw),now=Temporal.Instant.from(input.now).epochNanoseconds,duration=BigInt(input.durationMinutes)*minute,buffer=BigInt(input.rules.bufferMinutes)*minute;
 const requests=merge(input.windows.map(range).map(v=>({...v,start:max(v.start,now)}))),dates=new Set<string>(),working:Range[]=[],ambiguous=new Set<string>();
 // Walk each bounded window separately. Widely separated requests must not
 // cause a min-to-max date loop spanning years of unrelated days.
 for(const value of requests){let date=Temporal.Instant.fromEpochNanoseconds(value.start).toZonedDateTimeISO(input.rules.timezone).toPlainDate();const last=Temporal.Instant.fromEpochNanoseconds(value.end-1n).toZonedDateTimeISO(input.rules.timezone).toPlainDate();
  while(Temporal.PlainDate.compare(date,last)<=0){dates.add(date.toString());date=date.add({days:1});}
 }
 for(const value of dates){const date=Temporal.PlainDate.from(value);
  for(const rule of input.rules.availability){if(!rule.days.includes(date.dayOfWeek%7))continue;
   try{working.push(range({start:localTimeToInstant(value+'T'+rule.start,input.rules.timezone),end:localTimeToInstant(value+'T'+rule.end,input.rules.timezone)}));}
   catch{ambiguous.add(value);}
  }
 }
 if(ambiguous.size)return {status:'clarification',windows:[],reason:'host_clock_change',dates:[...ambiguous].sort()};
 // General buffer protects host busy/focus boundaries. It is distinct from
 // physical travel time and the extra travel buffer checked by the travel gate.
 const hostBlocked=merge([...input.hostBusy,...input.rules.focusBlocks].map(range).map(v=>({start:v.start-buffer,end:v.end+buffer})));
 const hostFree=subtract(merge(working),hostBlocked);
 const requested=intersect(requests,merge(input.requesterAvailability.map(range)));
 const available=subtract(intersect(hostFree,requested),merge(input.requesterBusy.map(range)));
 return {status:'ready',windows:available.filter(v=>v.end-v.start>=duration).map(interval),durationMinutes:input.durationMinutes,requesterTimezone:input.requesterTimezone};
}

/** Revalidation shares the same full-interval test; matching only the start
 * time is insufficient. Adjacent half-open boundaries do not overlap. */
export function intervalFits(evaluation:IntervalEvaluation,candidate:SchedulingInterval):boolean{
 const parsed=schedulingInterval.safeParse(candidate);if(!parsed.success||evaluation.status!=='ready')return false;
 const value=range(parsed.data);return value.end-value.start===BigInt(evaluation.durationMinutes)*minute&&evaluation.windows.some(w=>{const allowed=range(w);return value.start>=allowed.start&&value.end<=allowed.end;});
}

/** Presentation sampling is caller-configured, never a feasibility rule. The
 * underlying continuous windows remain available for exact-time proposals. */
export function sampleIntervals(evaluation:IntervalEvaluation,options:{stepMinutes:number;limit:number}):{intervals:SchedulingInterval[];truncated:boolean}{
 if(!Number.isInteger(options.stepMinutes)||options.stepMinutes<1||options.stepMinutes>240||!Number.isInteger(options.limit)||options.limit<1||options.limit>300)throw new Error('Invalid interval sampling bounds.');
 if(evaluation.status!=='ready')return {intervals:[],truncated:false};
 const intervals:SchedulingInterval[]=[],step=BigInt(options.stepMinutes)*minute,duration=BigInt(evaluation.durationMinutes)*minute;
 for(const window of evaluation.windows){const value=range(window);for(let start=value.start;start+duration<=value.end;start+=step){if(intervals.length===options.limit)return {intervals,truncated:true};intervals.push(interval({start,end:start+duration}));}}
 return {intervals,truncated:false};
}
