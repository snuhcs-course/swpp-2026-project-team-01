import {z} from 'zod';
import {availabilityWindows,interval,type Interval} from '../../contracts/availability.ts';
import {ApplicationError} from '../errors.ts';
const responseSchema=z.object({timeMin:z.iso.datetime({offset:true}),timeMax:z.iso.datetime({offset:true}),calendars:z.record(z.string(),z.object({busy:z.array(interval).max(10000),errors:z.array(z.unknown()).optional()})),groups:z.record(z.string(),z.unknown()).optional()});
export function mergeIntervals(values:Interval[]):Interval[]{
  const sorted=values.map(v=>({start:Date.parse(v.start),end:Date.parse(v.end)})).sort((a,b)=>a.start-b.start),merged:{start:number;end:number}[]=[];
  for(const value of sorted){const last=merged.at(-1);if(last&&value.start<=last.end)last.end=Math.max(last.end,value.end);else merged.push({...value});}
  return merged.map(v=>({start:new Date(v.start).toISOString(),end:new Date(v.end).toISOString()}));
}
export interface FreeBusyProvider {read(accessToken:string,calendarIds:string[],windows:Interval[]):Promise<Interval[]>;}
export class GoogleFreeBusy implements FreeBusyProvider {
  constructor(private readonly fetcher:typeof fetch=fetch){}
  async read(accessToken:string,calendarIds:string[],windows:Interval[]):Promise<Interval[]>{
    const ids=z.array(z.string().min(1).max(1024)).min(1).max(50).parse(calendarIds),ranges=mergeIntervals(availabilityWindows.parse(windows));
    const signal=AbortSignal.timeout(15_000),busy:Interval[]=[];
    try{
      for(const range of ranges){
        const response=await this.fetcher('https://www.googleapis.com/calendar/v3/freeBusy',{method:'POST',headers:{authorization:'Bearer '+accessToken,'content-type':'application/json'},body:JSON.stringify({timeMin:range.start,timeMax:range.end,timeZone:'UTC',calendarExpansionMax:50,groupExpansionMax:0,items:ids.map(id=>({id}))}),signal,cache:'no-store',redirect:'error'});
        if(response.status===401||response.status===403)throw new ApplicationError('RECONNECT_REQUIRED',409);
        if(!response.ok)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
        // Bound the response before parsing: provider failure must not exhaust runtime memory.
        const reader=response.body?.getReader();if(!reader)throw new Error();let size=0;const chunks:Uint8Array[]=[];
        try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4*1024*1024){await reader.cancel();throw new Error();}chunks.push(value);}}finally{reader.releaseLock();}
        const data=responseSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        if(Date.parse(data.timeMin)!==Date.parse(range.start)||Date.parse(data.timeMax)!==Date.parse(range.end)||Object.keys(data.groups??{}).length)throw new Error();
        for(const id of ids){
          const calendar=Object.hasOwn(data.calendars,id)?data.calendars[id]:undefined;
          if(!calendar||calendar.errors?.length)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
          for(const block of calendar.busy){const start=Math.max(Date.parse(range.start),Date.parse(block.start)),end=Math.min(Date.parse(range.end),Date.parse(block.end));if(start<end)busy.push({start:new Date(start).toISOString(),end:new Date(end).toISOString()});}
        }
      }
      return mergeIntervals(busy);
    }catch(error){if(error instanceof ApplicationError)throw error;throw new ApplicationError('PROVIDER_UNAVAILABLE',503);}
  }
}
