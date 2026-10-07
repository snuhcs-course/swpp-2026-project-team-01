import {z} from 'zod';
import {Temporal} from '@js-temporal/polyfill';
import {ianaTimezone} from '../../contracts/time.ts';

const eventId=z.string().regex(/^[0-9a-v]{5,1024}$/u);
const eventTime=z.strictObject({dateTime:z.iso.datetime({offset:true}),timeZone:ianaTimezone});
const attendee=z.strictObject({email:z.email()});
const payload=z.strictObject({
 id:eventId,summary:z.string().min(1).max(1024),description:z.string().max(16384),location:z.string().min(1).max(4096),
 start:eventTime,end:eventTime,attendees:z.array(attendee).min(1).max(2),
 extendedProperties:z.strictObject({private:z.strictObject({fmatRequestId:z.uuid(),fmatAttemptId:z.uuid(),fmatProposalVersion:z.string().regex(/^[1-9][0-9]*$/u)})}),
}).refine(p=>Temporal.Instant.compare(p.start.dateTime,p.end.dateTime)<0)
 .refine(p=>new Set(p.attendees.map(a=>a.email.toLowerCase())).size===p.attendees.length);
export const bookingTransportSnapshot=z.strictObject({
 requestId:z.uuid(),attemptId:z.uuid(),proposalVersion:z.number().int().positive(),calendarId:z.string().min(1).max(1024).refine(v=>v!=='primary'),
 eventId,payload,payloadFingerprint:z.string().regex(/^[a-f0-9]{64}$/u),connectionProviderSubject:z.string().min(1).max(300),
 phase:z.enum(['dispatched','uncertain','conflict']),
}).refine(s=>s.eventId===s.payload.id&&s.requestId===s.payload.extendedProperties.private.fmatRequestId&&s.attemptId===s.payload.extendedProperties.private.fmatAttemptId&&String(s.proposalVersion)===s.payload.extendedProperties.private.fmatProposalVersion);
export type BookingTransportSnapshot=z.infer<typeof bookingTransportSnapshot>;
const access=z.strictObject({principalKind:z.literal('host'),providerSubject:z.string().min(1),accessToken:z.string().min(1).regex(/^[^\r\n]+$/u),scopes:z.array(z.string()).refine(s=>s.includes('https://www.googleapis.com/auth/calendar.events'))});
export type BookingAccess=z.infer<typeof access>;
export type BookingProviderOutcome=
 |{outcome:'confirmed';evidence:{calendarId:string;eventId:string;payloadFingerprint:string;eventUrl:string|null;etag:string;organizer:{email:string}}}
 |{outcome:'uncertain'|'conflict';reason:string}
 |{outcome:'noncreating';reason:'provider_bad_request'|'permission_denied'|'calendar_not_found'};

// The caller must obtain a fenced, durably dispatched snapshot and refreshed
// host credential. This transport never grants approval, retries an insert,
// changes a destination, releases a reservation, or mutates database state.
export class GoogleBookingProvider {
 constructor(private readonly fetcher:typeof fetch=fetch){}
 insert(credential:BookingAccess,snapshot:BookingTransportSnapshot){return this.request('insert',credential,snapshot);}
 reconcile(credential:BookingAccess,snapshot:BookingTransportSnapshot){return this.request('get',credential,snapshot);}
 private async request(operation:'insert'|'get',credential:BookingAccess,input:BookingTransportSnapshot):Promise<BookingProviderOutcome>{
  const auth=access.parse(credential),snapshot=bookingTransportSnapshot.parse(input);
  if(auth.providerSubject!==snapshot.connectionProviderSubject)throw new Error('BOOKING_CREDENTIAL_MISMATCH');
  if(operation==='insert'&&snapshot.phase!=='dispatched')throw new Error('BOOKING_RECONCILIATION_REQUIRED');
  const url=new URL('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(snapshot.calendarId)+'/events'+(operation==='get'?'/'+encodeURIComponent(snapshot.eventId):''));
  if(operation==='insert')url.searchParams.set('sendUpdates','all');
  try{
   const response=await this.fetcher(url,{method:operation==='insert'?'POST':'GET',headers:{authorization:'Bearer '+auth.accessToken,...(operation==='insert'?{'content-type':'application/json'}:{})},
    ...(operation==='insert'?{body:JSON.stringify(snapshot.payload)}:{}),signal:AbortSignal.timeout(15_000),cache:'no-store',redirect:'error'});
   const body=await boundedJson(response);
   if(!response.ok){
    // Only structured, definitive insert rejection can release uncertainty.
    // Rate limits, redirects, unknown errors and every failed lookup stay pending.
    const error=z.object({error:z.object({code:z.number().int(),errors:z.array(z.object({reason:z.string()})).min(1)})}).safeParse(body);
    if(operation==='insert'&&error.success&&error.data.error.code===response.status){
     const reasons=error.data.error.errors.map(e=>e.reason);
     if(response.status===400&&reasons.every(r=>['badRequest','invalid','invalidParameter','required'].includes(r)))return {outcome:'noncreating',reason:'provider_bad_request'};
     if([401,403].includes(response.status)&&reasons.every(r=>['authError','forbidden','insufficientPermissions'].includes(r)))return {outcome:'noncreating',reason:'permission_denied'};
     if(response.status===404&&reasons.every(r=>r==='notFound'))return {outcome:'noncreating',reason:'calendar_not_found'};
    }
    return {outcome:'uncertain',reason:response.status===409?'event_identity_exists':operation==='get'&&[404,410].includes(response.status)?'event_not_observed':'provider_unavailable'};
   }
   return verifyEvent(snapshot,body);
  }catch{return {outcome:'uncertain',reason:'provider_response_unavailable'};}
 }
}
async function boundedJson(response:Response):Promise<unknown>{
 const reader=response.body?.getReader();if(!reader)throw new Error();
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>256*1024){await reader.cancel();throw new Error();}chunks.push(value);}}finally{reader.releaseLock();}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function verifyEvent(snapshot:BookingTransportSnapshot,body:unknown):BookingProviderOutcome{
 const time=z.object({dateTime:z.iso.datetime({offset:true}),timeZone:z.string().optional(),date:z.string().optional()});
 const event=z.object({id:z.string(),status:z.enum(['confirmed','tentative','cancelled']),etag:z.string().min(1),summary:z.string(),description:z.string(),location:z.string(),
  organizer:z.object({email:z.email()}),start:time,end:time,attendees:z.array(z.object({email:z.email(),additionalGuests:z.number().optional(),resource:z.boolean().optional(),optional:z.boolean().optional()})).max(200),
  attendeesOmitted:z.boolean().optional(),recurrence:z.array(z.string()).optional(),recurringEventId:z.string().optional(),eventType:z.string().optional(),transparency:z.string().optional(),guestsCanModify:z.boolean().optional(),
  extendedProperties:z.object({private:z.record(z.string(),z.string())}),htmlLink:z.string().optional(),
 }).safeParse(body);
 if(!event.success)return {outcome:'uncertain',reason:'incomplete_provider_evidence'};
 const actual=event.data,expected=snapshot.payload;
 const emails=(items:{email:string}[])=>items.map(a=>a.email.toLowerCase()).sort();
 const matches=actual.id===snapshot.eventId&&actual.status!=='cancelled'&&actual.summary===expected.summary&&actual.description===expected.description&&actual.location===expected.location
  &&!actual.start.date&&!actual.end.date&&Temporal.Instant.compare(actual.start.dateTime,expected.start.dateTime)===0&&Temporal.Instant.compare(actual.end.dateTime,expected.end.dateTime)===0
  &&JSON.stringify(emails(actual.attendees))===JSON.stringify(emails(expected.attendees))&&!actual.attendeesOmitted&&!actual.recurrence?.length&&!actual.recurringEventId
  &&(!actual.eventType||actual.eventType==='default')&&actual.transparency!=='transparent'&&!actual.guestsCanModify
  &&actual.attendees.every(a=>!a.additionalGuests&&!a.resource&&!a.optional)
  &&Object.entries(expected.extendedProperties.private).every(([key,value])=>actual.extendedProperties.private[key]===value);
 if(!matches)return {outcome:'conflict',reason:'event_snapshot_mismatch'};
 let eventUrl:string|null=null;
 if(actual.htmlLink){try{const url=new URL(actual.htmlLink);if(url.protocol==='https:'&&url.hostname==='www.google.com'&&!url.username&&!url.password&&!url.port&&url.pathname.startsWith('/calendar/'))eventUrl=url.href;}catch{/* A malformed optional link cannot expose provider text. */}}
 return {outcome:'confirmed',evidence:{calendarId:snapshot.calendarId,eventId:snapshot.eventId,payloadFingerprint:snapshot.payloadFingerprint,eventUrl,etag:actual.etag,organizer:{email:actual.organizer.email}}};
}
