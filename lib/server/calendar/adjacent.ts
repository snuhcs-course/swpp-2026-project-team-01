import {providerSignal,providerFetch,providerBody} from './transport.ts';
import {createHash} from 'node:crypto';
import {Temporal} from '@js-temporal/polyfill';
import {z} from 'zod';
import {schedulingInterval,type SchedulingInterval} from '../../contracts/interval-feasibility.ts';
import {routeLocation} from '../../contracts/travel.ts';
import type {TravelInput} from '../scheduling/travel.ts';
import {ApplicationError} from '../errors.ts';
import {mergeIntervals} from './freebusy.ts';

const ns=(v:string)=>Temporal.Instant.from(v).epochNanoseconds;
const day=86400n*1000000000n;
export const travelCommitment=z.strictObject({id:z.string().min(1).max(1024),calendarId:z.string().min(1).max(1024),eventId:z.string().min(1).max(1024),version:z.string().max(1024),interval:schedulingInterval,location:routeLocation.nullable()});
export type TravelCommitment=z.infer<typeof travelCommitment>;
const endpoint=z.object({date:z.iso.date().optional(),dateTime:z.string().max(100).optional(),timeZone:z.string().max(100).optional()});
const event=z.object({id:z.string().min(1).max(1024),etag:z.string().min(1).max(1024),status:z.enum(['confirmed','tentative','cancelled']).optional(),transparency:z.enum(['opaque','transparent']).optional(),eventType:z.string().max(100).optional(),start:endpoint.optional(),end:endpoint.optional(),location:z.string().max(5000).optional(),hangoutLink:z.string().max(5000).optional(),conferenceData:z.object({entryPoints:z.array(z.object({entryPointType:z.string().min(1).max(100)})).max(100).optional(),conferenceSolution:z.object({key:z.object({type:z.string().min(1).max(100)})}).optional()}).optional(),attendees:z.array(z.object({self:z.boolean().optional(),responseStatus:z.string().optional()})).max(1).optional()});
const pageSchema=z.object({timeZone:z.string().min(1).max(100),accessRole:z.enum(['reader','writer','writerWithoutPrivateAccess','owner']),items:z.array(event).max(250).optional(),nextPageToken:z.string().min(1).max(4096).optional(),nextSyncToken:z.string().min(1).max(4096).optional()});
export function travelReadRange(raw:SchedulingInterval){const value=schedulingInterval.parse(raw);return {start:Temporal.Instant.fromEpochNanoseconds(ns(value.start)-31n*day).toString(),end:Temporal.Instant.fromEpochNanoseconds(ns(value.end)+31n*day).toString()};}
export function physicalLocation(raw:string|undefined){const value=raw?.trim().replace(/\s+/gu,' ');return value&&value.length<=2000&&!/[<>\u0000-\u001f]|https?:\/\/|@/iu.test(value)?{address:value}:null;}
function instant(value:z.infer<typeof endpoint>,zone:string){
 if(Boolean(value.date)===Boolean(value.dateTime))throw new Error();
 if(value.date)return Temporal.PlainDate.from(value.date).toZonedDateTime(zone).toInstant().toString();
 try{return Temporal.Instant.from(value.dateTime!).toString();}catch{if(!value.timeZone)throw new Error();return Temporal.PlainDateTime.from(value.dateTime!).toZonedDateTime(value.timeZone,{disambiguation:'reject'}).toInstant().toString();}
}
export interface AdjacentEventProvider {read(accessToken:string,calendarIds:string[],candidate:SchedulingInterval,assertCurrent:()=>Promise<void>,shared?:AbortSignal):Promise<TravelCommitment[]>;}
/** Bounded complete reads establish known neighbors, never an assumed location
 * outside coverage. Titles, descriptions, attendee identity and meeting URLs
 * are neither requested nor retained. */
export class GoogleAdjacentEvents implements AdjacentEventProvider {
 constructor(private readonly fetcher:typeof fetch=fetch){}
 async read(accessToken:string,calendarIds:string[],candidate:SchedulingInterval,assertCurrent:()=>Promise<void>,shared?:AbortSignal):Promise<TravelCommitment[]>{
  const ids=z.array(z.string().min(1).max(1024)).min(1).max(50).refine(v=>new Set(v).size===v.length).parse(calendarIds),range=travelReadRange(candidate),signal=providerSignal(shared,20_000),result:TravelCommitment[]=[];
  let totalBytes=0,totalEvents=0;
  try{for(const calendarId of ids){let token:string|undefined,zone:string|undefined;const seen=new Set<string>(),tokens=new Set<string>();
   for(let page=0;page<10;page++){
    await assertCurrent();
    const url=new URL('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendarId)+'/events');
    // Google ignores fractional seconds on range filters. Round outward.
    const timeMin=Temporal.Instant.from(range.start).round({smallestUnit:'second',roundingMode:'floor'}).toString(),timeMax=Temporal.Instant.from(range.end).round({smallestUnit:'second',roundingMode:'ceil'}).toString();
    for(const [key,value] of Object.entries({singleEvents:'true',showDeleted:'false',showHiddenInvitations:'true',maxResults:'250',maxAttendees:'1',timeMin,timeMax,fields:'timeZone,accessRole,nextPageToken,nextSyncToken,items(id,etag,status,transparency,eventType,start,end,location,conferenceData(entryPoints(entryPointType),conferenceSolution(key(type))),attendees(self,responseStatus))'}))url.searchParams.set(key,value);
    if(token)url.searchParams.set('pageToken',token);
    const response=await providerFetch(this.fetcher,url,{headers:{authorization:'Bearer '+accessToken},signal,cache:'no-store',redirect:'error'},signal);
    if([401,403,404].includes(response.status))throw new ApplicationError('RECONNECT_REQUIRED',409);if(!response.ok)throw new Error();
    const bytes=await providerBody(response,signal,2*1024*1024);totalBytes+=bytes.length;if(totalBytes>8*1024*1024)throw new Error();
    const data=pageSchema.parse(JSON.parse(bytes.toString('utf8')));Temporal.Instant.from(candidate.start).toZonedDateTimeISO(data.timeZone);
    if(zone&&zone!==data.timeZone||!data.items&&!data.nextPageToken&&!data.nextSyncToken)throw new Error();zone=data.timeZone;
    for(const e of data.items??[]){
     if(seen.has(e.id)||++totalEvents>10000)throw new Error();seen.add(e.id);
     if(e.status==='cancelled'||e.transparency==='transparent'||e.eventType==='workingLocation'||e.attendees?.some(a=>a.self&&a.responseStatus==='declined'))continue;
     if(!e.start||!e.end||Boolean(e.start.date)!==Boolean(e.end.date))throw new Error();
     const interval=schedulingInterval.parse({start:instant(e.start,zone),end:instant(e.end,zone)});
     if(ns(interval.end)<=ns(range.start)||ns(interval.start)>=ns(range.end))continue;
     result.push({id:createHash('sha256').update(JSON.stringify([calendarId,e.id])).digest('hex'),calendarId,eventId:e.id,version:e.etag,interval,location:e.hangoutLink||e.conferenceData?.entryPoints?.length||e.conferenceData?.conferenceSolution?null:physicalLocation(e.location)});
    }
    token=data.nextPageToken;if(!token)break;if(tokens.has(token)||page===9)throw new Error();tokens.add(token);
   }
  }await assertCurrent();return result;
  }catch(error){if(error instanceof ApplicationError)throw error;throw new ApplicationError('PROVIDER_UNAVAILABLE',503);}
 }
}
export function adjacentContext(raw:SchedulingInterval,values:TravelCommitment[],basis:string){
 const candidate=schedulingInterval.parse(raw),coverage=travelReadRange(candidate),commitments=z.array(travelCommitment).max(40100).parse(values).filter(c=>ns(c.interval.end)>ns(coverage.start)&&ns(c.interval.start)<ns(coverage.end)).sort((a,b)=>a.id.localeCompare(b.id)||a.version.localeCompare(b.version));
 // Exact duplicate local/provider records need only one constraint. Divergent
 // versions remain separate: a stale local copy must not erase a provider edit.
 const unique=[...new Map(commitments.map(c=>[JSON.stringify([c.calendarId,c.eventId,c.interval,c.location]),c])).values()];
 const overlap=unique.find(c=>ns(c.interval.start)<ns(candidate.end)&&ns(candidate.start)<ns(c.interval.end));
 const asNeighbor=(c:TravelCommitment):TravelInput['previous']=>({kind:'commitment',id:c.id,interval:c.interval,location:c.location});
 function neighbor(direction:'previous'|'next'):TravelInput['previous']{
  if(overlap)return asNeighbor(overlap);
  const possible=unique.filter(c=>direction==='previous'?ns(c.interval.end)<=ns(candidate.start):ns(c.interval.start)>=ns(candidate.end));
  possible.sort((a,b)=>{const x=ns(direction==='previous'?b.interval.end:a.interval.start),y=ns(direction==='previous'?a.interval.end:b.interval.start);return x<y?-1:x>y?1:0;});
  if(!possible.length)return {kind:'unknown'};
  const first=possible[0],boundary=direction==='previous'?first.interval.end:first.interval.start;
  const tied=possible.filter(c=>ns(direction==='previous'?c.interval.end:c.interval.start)===ns(boundary));
  if(tied.some(c=>JSON.stringify(c.location)!==JSON.stringify(first.location)))return {kind:'unknown'};
  return asNeighbor(first);
 }
 const fingerprint=createHash('sha256').update(JSON.stringify({basis,candidate,range:travelReadRange(candidate),commitments})).digest('hex');
 return {fingerprint,previous:neighbor('previous'),next:neighbor('next')};
}

/** A busy block absent from the event response is still a commitment. It must
 * not disappear between separate provider reads and open time for a trip. */
export function unexplainedBusy(busy:SchedulingInterval[],events:TravelCommitment[]):TravelCommitment[]{
 const known=mergeIntervals(events.map(e=>e.interval)).map(v=>({start:ns(v.start),end:ns(v.end)})),result:TravelCommitment[]=[];let index=0;
 const add=(start:bigint,end:bigint)=>{if(start>=end)return;const interval={start:Temporal.Instant.fromEpochNanoseconds(start).toString(),end:Temporal.Instant.fromEpochNanoseconds(end).toString()},id=createHash('sha256').update(JSON.stringify(interval)).digest('hex');result.push({id,calendarId:'freebusy',eventId:id,version:'unknown-location',interval,location:null});};
 for(const interval of mergeIntervals(busy)){let cursor=ns(interval.start);const end=ns(interval.end);while(index<known.length&&known[index].end<=cursor)index++;
  for(let i=index;i<known.length&&known[i].start<end;i++){const value=known[i];if(value.start>cursor)add(cursor,value.start<end?value.start:end);if(value.end>cursor)cursor=value.end;if(cursor>=end)break;}add(cursor,end);
 }return result;
}
