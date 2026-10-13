import {providerSignal,providerFetch,providerBody} from './transport.ts';
import {z} from 'zod';
import {Temporal} from '@js-temporal/polyfill';
import {availabilityWindows,interval,type Interval} from '../../contracts/availability.ts';
import {ApplicationError} from '../errors.ts';
const responseSchema=z.object({timeMin:z.iso.datetime({offset:true}),timeMax:z.iso.datetime({offset:true}),calendars:z.record(z.string(),z.object({busy:z.array(interval).max(10000).optional(),errors:z.array(z.object({reason:z.string()})).optional()})),groups:z.record(z.string(),z.unknown()).optional()});
const instant=(value:string)=>Temporal.Instant.from(value).epochNanoseconds;
const iso=(value:bigint)=>Temporal.Instant.fromEpochNanoseconds(value).toString({fractionalSecondDigits:value%1000000n===0n?3:'auto'});
const day=86400n*1000000000n;
export function mergeIntervals(values:Interval[]):Interval[]{
  const sorted=values.map(v=>({start:instant(v.start),end:instant(v.end)})).sort((a,b)=>a.start<b.start?-1:a.start>b.start?1:0),merged:{start:bigint;end:bigint}[]=[];
  for(const value of sorted){const last=merged.at(-1);if(last&&value.start<=last.end)last.end=last.end>value.end?last.end:value.end;else merged.push({...value});}
  return merged.map(v=>({start:iso(v.start),end:iso(v.end)}));
}
function splitWindows(values:Interval[]):Interval[]{
 const result:Interval[]=[];
 for(const value of values){const end=instant(value.end);for(let start=instant(value.start);start<end;){const next=start+31n*day<end?start+31n*day:end;result.push({start:iso(start),end:iso(next)});start=next;}}
 return result;
}
// Padding belongs in the read range: otherwise a busy event just outside the
// request can disappear before its buffer is applied by the interval core.
export function bufferedReadWindows(windows:Interval[],bufferMinutes:number):Interval[]{
 const ranges=availabilityWindows.parse(windows),buffer=BigInt(z.number().int().min(0).max(240).parse(bufferMinutes))*60n*1000000000n;
 return splitWindows(mergeIntervals(ranges.map(v=>({start:iso(instant(v.start)-buffer),end:iso(instant(v.end)+buffer)}))));
}
export interface FreeBusyProvider {read(accessToken:string,calendarIds:string[],windows:Interval[],shared?:AbortSignal):Promise<Interval[]>;}
export class GoogleFreeBusy implements FreeBusyProvider {
  constructor(private readonly fetcher:typeof fetch=fetch){}
  async read(accessToken:string,calendarIds:string[],windows:Interval[],shared?:AbortSignal):Promise<Interval[]>{
    const ids=z.array(z.string().min(1).max(1024)).min(1).max(50).parse(calendarIds),ranges=splitWindows(mergeIntervals(z.array(interval).min(1).max(60).refine(values=>values.every(v=>instant(v.end)-instant(v.start)<=31n*day)).parse(windows)));
    const signal=providerSignal(shared,15_000),busy:Interval[]=[];
    try{
      for(const range of ranges){
        const response=await providerFetch(this.fetcher,'https://www.googleapis.com/calendar/v3/freeBusy',{method:'POST',headers:{authorization:'Bearer '+accessToken,'content-type':'application/json'},body:JSON.stringify({timeMin:range.start,timeMax:range.end,timeZone:'UTC',calendarExpansionMax:50,groupExpansionMax:0,items:ids.map(id=>({id}))}),signal,cache:'no-store',redirect:'error'},signal);
        if(response.status===401||response.status===403)throw new ApplicationError('RECONNECT_REQUIRED',409);
        if(!response.ok)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
        // Bound the response before parsing: provider failure must not exhaust runtime memory.
        const bytes=await providerBody(response,signal,4*1024*1024);
        const data=responseSchema.parse(JSON.parse(bytes.toString('utf8')));
        if(instant(data.timeMin)!==instant(range.start)||instant(data.timeMax)!==instant(range.end)||Object.keys(data.groups??{}).length)throw new Error();
        for(const id of ids){
          const calendar=Object.hasOwn(data.calendars,id)?data.calendars[id]:undefined;
          if(calendar?.errors?.some(error=>['notFound','forbidden'].includes(error.reason)))throw new ApplicationError('RECONNECT_REQUIRED',409);
          if(!calendar||calendar.errors?.length||!calendar.busy)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
          for(const block of calendar.busy){const start=instant(range.start)>instant(block.start)?instant(range.start):instant(block.start),end=instant(range.end)<instant(block.end)?instant(range.end):instant(block.end);if(start<end)busy.push({start:iso(start),end:iso(end)});}
        }
      }
      return mergeIntervals(busy);
    }catch(error){if(error instanceof ApplicationError)throw error;throw new ApplicationError('PROVIDER_UNAVAILABLE',503);}
  }
}
