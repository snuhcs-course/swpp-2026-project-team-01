import {Temporal} from '@js-temporal/polyfill';
import {z} from 'zod';
import {analysisScope,analysisSummary,type AnalysisScope,type AnalysisSummary} from '../../contracts/calendar-analysis.ts';
import {ApplicationError} from '../errors.ts';
const endpoint=z.object({date:z.iso.date().optional(),dateTime:z.string().max(100).optional(),timeZone:z.string().max(100).optional()});
const event=z.object({id:z.string().min(1).max(1024),status:z.enum(['confirmed','tentative','cancelled']).optional(),transparency:z.enum(['opaque','transparent']).optional(),eventType:z.string().max(100).optional(),start:endpoint.optional(),end:endpoint.optional(),location:z.string().max(5000).optional(),hangoutLink:z.string().max(5000).optional(),conferenceData:z.object({entryPoints:z.array(z.object({entryPointType:z.string()})).max(100).optional()}).optional(),attendees:z.array(z.object({self:z.boolean().optional(),responseStatus:z.string().optional()})).max(100).optional()});
const pageSchema=z.object({timeZone:z.string().min(1).max(100),accessRole:z.enum(['reader','writer','writerWithoutPrivateAccess','owner']),items:z.array(event).max(250).optional(),nextSyncToken:z.string().min(1).max(4096).optional(),nextPageToken:z.string().min(1).max(4096).optional()});
export type CalendarEvent=z.infer<typeof event>;
export type EventCalendar={id:string;timezone:string;events:CalendarEvent[]};
export function scanRange(input:AnalysisScope,now=Date.now()){
 try{const scope=analysisScope.parse(input),start=Temporal.PlainDate.from(scope.startDate),end=Temporal.PlainDate.from(scope.endDate),days=start.until(end).days,today=Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(scope.timezone).toPlainDate();
  if(days<14||days>56||Temporal.PlainDate.compare(start,today.subtract({days:90}))<0||Temporal.PlainDate.compare(end,today.add({days:90}))>0)throw new Error();
  return {start:start.toZonedDateTime(scope.timezone).toInstant().toString(),end:end.toZonedDateTime(scope.timezone).toInstant().toString(),days};
 }catch{throw new ApplicationError('INVALID_INPUT',400);}
}
export interface EventProvider{read(accessToken:string,scope:AnalysisScope):Promise<EventCalendar[]>;}
export class GoogleEventProvider implements EventProvider{
 constructor(private readonly fetcher:typeof fetch=fetch){}
 async read(accessToken:string,scope:AnalysisScope):Promise<EventCalendar[]>{
  const range=scanRange(scope),signal=AbortSignal.timeout(20_000),calendars:EventCalendar[]=[];let totalBytes=0,totalEvents=0;
  try{for(const id of scope.calendarIds){let token:string|undefined,timezone:string|undefined;const events:CalendarEvent[]=[],ids=new Set<string>(),tokens=new Set<string>();
   for(let page=0;page<10;page++){
    const url=new URL('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(id)+'/events');
    for(const [k,v] of Object.entries({singleEvents:'true',showDeleted:'false',maxResults:'250',maxAttendees:'1',timeMin:range.start,timeMax:range.end,fields:'timeZone,accessRole,nextPageToken,nextSyncToken,items(id,status,transparency,eventType,start,end,location,hangoutLink,conferenceData(entryPoints(entryPointType)),attendees(self,responseStatus))'}))url.searchParams.set(k,v);
    if(token)url.searchParams.set('pageToken',token);
    const response=await this.fetcher(url,{headers:{authorization:'Bearer '+accessToken},signal,cache:'no-store',redirect:'error'});
    if(response.status===401||response.status===403)throw new ApplicationError('RECONNECT_REQUIRED',409);if(!response.ok)throw new Error();
    const reader=response.body?.getReader();if(!reader)throw new Error();let bytes=0;const chunks:Uint8Array[]=[];
    try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;totalBytes+=value.length;if(bytes>2*1024*1024||totalBytes>8*1024*1024){await reader.cancel();throw new Error();}chunks.push(value);}}finally{reader.releaseLock();}
    const data=pageSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));Temporal.Now.zonedDateTimeISO(data.timeZone);if(!data.items&&!data.nextPageToken&&!data.nextSyncToken)throw new Error();
    if(timezone&&timezone!==data.timeZone)throw new Error();timezone=data.timeZone;
    for(const e of data.items??[]){if(ids.has(e.id))throw new Error();ids.add(e.id);events.push(e);if(++totalEvents>10000)throw new Error();}
    token=data.nextPageToken;if(!token)break;if(tokens.has(token)||page===9)throw new Error();tokens.add(token);
   }
   calendars.push({id,timezone:timezone!,events});
  }return calendars;}catch(error){if(error instanceof ApplicationError)throw error;throw new ApplicationError('PROVIDER_UNAVAILABLE',503);}
 }
}
function instant(value:z.infer<typeof endpoint>,calendarZone:string){
 if(value.date&&value.dateTime||!value.date&&!value.dateTime)throw new Error();
 if(value.date)return Temporal.PlainDate.from(value.date).toZonedDateTime(calendarZone).epochMilliseconds;
 try{return Temporal.Instant.from(value.dateTime!).epochMilliseconds;}catch{
  if(!value.timeZone)throw new Error();return Temporal.PlainDateTime.from(value.dateTime!).toZonedDateTime(value.timeZone,{disambiguation:'reject'}).epochMilliseconds;
 }
}
export function analyzeCalendars(scope:AnalysisScope,calendars:EventCalendar[],now=Date.now()):AnalysisSummary{
 const range=scanRange(scope,now),begin=Date.parse(range.start),finish=Date.parse(range.end);
 try{
  if(calendars.length!==scope.calendarIds.length||new Set(calendars.map(c=>c.id)).size!==calendars.length||scope.calendarIds.some(id=>!calendars.some(c=>c.id===id)))throw new Error();
  const busy:{start:number;end:number}[]=[],places=new Map<string,number>();let eventCount=0,onlineCount=0,physicalCount=0,missingLocations=0;
  for(const calendar of calendars){Temporal.Now.zonedDateTimeISO(calendar.timezone);for(const raw of calendar.events){const e=event.parse(raw);
   if(e.status==='cancelled'||e.transparency==='transparent'||e.eventType==='workingLocation'||e.attendees?.some(a=>a.self&&a.responseStatus==='declined'))continue;
   if(!e.start||!e.end||Boolean(e.start.date)!==Boolean(e.end.date))throw new Error();
   const start=instant(e.start,calendar.timezone),end=instant(e.end,calendar.timezone);if(start>=end)throw new Error();if(end<=begin||start>=finish)continue;
   busy.push({start:Math.max(start,begin),end:Math.min(end,finish)});eventCount++;
   const online=Boolean(e.hangoutLink||e.conferenceData?.entryPoints?.some(p=>p.entryPointType==='video'));
   if(online)onlineCount++;
   const location=e.location?.trim().replace(/\s+/gu,' ');
   if(location&&location.length<=500&&!/[<>\u0000-\u001f]|https?:\/\/|@/iu.test(location)){places.set(location,(places.get(location)??0)+1);physicalCount++;}else if(!online)missingLocations++;
  }}
  // A disclosed 09:00–18:00 search frame ranks weekly gaps, never actual booking availability.
  const windows:AnalysisSummary['windows']=[];let date=Temporal.PlainDate.from(scope.startDate);const dates:Temporal.PlainDate[]=[];
  while(Temporal.PlainDate.compare(date,Temporal.PlainDate.from(scope.endDate))<0){dates.push(date);date=date.add({days:1});}
  if(eventCount>=5){for(let day=1;day<=5;day++){
   const samples=dates.filter(d=>d.dayOfWeek===day);let best:{hour:number;clear:number}|undefined;
   for(let hour=9;hour<=16;hour++){
    let clear=0;for(const d of samples){const start=d.toPlainDateTime({hour}).toZonedDateTime(scope.timezone,{disambiguation:'reject'}).epochMilliseconds,end=d.toPlainDateTime({hour:hour+2}).toZonedDateTime(scope.timezone,{disambiguation:'reject'}).epochMilliseconds;if(!busy.some(b=>b.start<end&&start<b.end))clear++;}
    if(clear/samples.length>=0.75&&(!best||clear>best.clear||clear===best.clear&&Math.abs(hour-13)<Math.abs(best.hour-13)))best={hour,clear};
   }
   if(best)windows.push({days:[day],start:String(best.hour).padStart(2,'0')+':00',end:String(best.hour+2).padStart(2,'0')+':00'});
  }}
  const sparse=eventCount<5,locations=[...places].filter(([,count])=>count>=2).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,5).map(([label,count])=>({label,count}));
  return analysisSummary.parse({eventCount,busyCount:busy.length,days:range.days,windowSource:sparse?'starter':windows.length?'calendar':'none',windows:sparse?[{days:[1,2,3,4,5],start:'13:00',end:'17:00'}]:windows,onlineCount,physicalCount,locations,limitations:[...(sparse?['sparse']:[]),...(missingLocations?['missing_locations']:[]),...(calendars.some(c=>c.timezone!==scope.timezone)?['mixed_timezones']:[]),...(!sparse&&!windows.length?['no_pattern']:[])]});
 }catch(error){if(error instanceof ApplicationError)throw error;throw new ApplicationError('PROVIDER_UNAVAILABLE',503);}
}
