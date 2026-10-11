import {z} from 'zod';
import type {CalendarEntry} from './catalog.ts';
import {providerSignal,providerFetch,providerBody} from './transport.ts';
import {calendarRecommendations,type CalendarRecommendations} from '../../contracts/calendar.ts';

const item=z.object({id:z.string().max(1024),summary:z.string().max(4096).optional(),status:z.string().optional(),transparency:z.string().optional(),eventType:z.string().optional(),start:z.object({date:z.string().optional(),dateTime:z.string().optional()}).optional(),attendees:z.array(z.object({self:z.boolean().optional(),responseStatus:z.string().optional()})).max(100).optional()});
const page=z.object({items:z.array(item).max(250),nextPageToken:z.string().max(4096).optional()});
type Sample=z.infer<typeof item>;
const writable=(c:CalendarEntry)=>['owner','writer','writerWithoutPrivateAccess'].includes(c.accessRole);
// Deliberately bounded title classification, not instructions or model prompts.
// Unknown opaque events still count as commitments; names never prove free time.
export function summarizeEvents(events:Sample[]){
 let eventCount=0,busyCount=0,namedCommitments=0,informationalCount=0;
 for(const event of events){
  if(event.status==='cancelled'||event.attendees?.some(a=>a.self&&a.responseStatus==='declined'))continue;
  eventCount++;
  const title=event.summary??'';
  const informational=event.eventType==='birthday'||event.eventType==='workingLocation'||(!!event.start?.date&&/birthday|holiday|anniversary|생일|공휴일|기념일/iu.test(title));
  if(informational)informationalCount++;
  if(event.transparency==='transparent'||informational)continue;
  busyCount++;
  if(/meeting|appointment|class|lecture|seminar|interview|workshop|focus|out of office|미팅|회의|약속|수업|강의|세미나|면접|집중|휴가/iu.test(title))namedCommitments++;
 }
 return {eventCount,busyCount,namedCommitments,informationalCount};
}
export interface CalendarRecommender{recommend(token:string,calendars:CalendarEntry[]):Promise<CalendarRecommendations>;}
export class GoogleCalendarRecommender implements CalendarRecommender{
 constructor(private readonly fetcher:typeof fetch=fetch,private readonly now=()=>Date.now()){}
 async recommend(token:string,calendars:CalendarEntry[]):Promise<CalendarRecommendations>{
  const now=this.now(),start=new Date(now-28*86400000).toISOString(),end=new Date(now+28*86400000).toISOString(),signal=providerSignal(undefined,20_000);
  const active=calendars.filter(c=>c.active!==false),evidence:CalendarRecommendations['evidence']=[];
  // At most 50 calendars, two 250-event pages per calendar, four concurrent reads.
  let next=0;
  const inspect=async(calendar:CalendarEntry,index:number)=>{
   if(index>=50||calendar.accessRole==='freeBusyReader')return {calendarId:calendar.id,status:'unavailable' as const,eventCount:null,busyCount:null,namedCommitments:null,reason:'Event details unavailable; choose manually.'};
   const events:Sample[]=[],seen=new Set<string>();let pageToken:string|undefined;
   try{
    for(let p=0;p<2;p++){
     const url=new URL('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendar.id)+'/events');
     for(const [k,v]of Object.entries({singleEvents:'true',showDeleted:'false',orderBy:'startTime',maxResults:'250',maxAttendees:'1',timeMin:start,timeMax:end,fields:'nextPageToken,items(id,summary,status,transparency,eventType,start,attendees(self,responseStatus))'}))url.searchParams.set(k,v);
     if(pageToken)url.searchParams.set('pageToken',pageToken);
     const response=await providerFetch(this.fetcher,url,{headers:{authorization:'Bearer '+token},cache:'no-store',redirect:'error',signal},signal);
     if(!response.ok)throw new Error('Unavailable');
     const data=page.parse(JSON.parse((await providerBody(response,signal,256*1024)).toString('utf8')));
     for(const e of data.items){if(seen.has(e.id))throw new Error('Duplicate');seen.add(e.id);events.push(e);}
     if(data.nextPageToken===pageToken&&pageToken)throw new Error('Repeated page');
     pageToken=data.nextPageToken;if(!pageToken)break;
    }
    const summary=summarizeEvents(events),status=pageToken?'partial' as const:'complete' as const;
    const reason=summary.namedCommitments>0?'Event names suggest meetings, classes or other commitments.':summary.busyCount>0?'Contains events marked busy.':summary.informationalCount>0?'No busy commitments found; includes informational events.':'No busy events found in this window.';
    return {calendarId:calendar.id,status,eventCount:summary.eventCount,busyCount:summary.busyCount,namedCommitments:summary.namedCommitments,reason};
   }catch{return {calendarId:calendar.id,status:'unavailable' as const,eventCount:null,busyCount:null,namedCommitments:null,reason:'Could not inspect events; choose manually.'};}
  };
  await Promise.all(Array.from({length:Math.min(4,active.length)},async()=>{for(;;){const i=next++;if(i>=active.length)return;evidence[i]=await inspect(active[i],i);}}));
  const conflictCalendarIds=evidence.filter(e=>e.status!=='unavailable'&&(e.busyCount??0)>0).map(e=>e.calendarId).slice(0,50);
  // Empty history is a labeled starter suggestion, never an assertion of availability.
  const primary=active.find(c=>c.primary);
  if(!conflictCalendarIds.length&&primary&&evidence.find(e=>e.calendarId===primary.id)?.status==='complete')conflictCalendarIds.push(primary.id);
  const destinations=active.filter(writable).sort((a,b)=>Number(b.primary)-Number(a.primary)||(evidence.find(e=>e.calendarId===b.id)?.busyCount??0)-(evidence.find(e=>e.calendarId===a.id)?.busyCount??0));
  return calendarRecommendations.parse({start,end,conflictCalendarIds,bookingCalendarId:destinations[0]?.id??null,evidence});
 }
}
