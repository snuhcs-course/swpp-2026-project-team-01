import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GoogleBookingProvider,type BookingAccess,type BookingTransportSnapshot} from './booking.ts';
const requestId='10000000-0000-4000-8000-000000000001',attemptId='20000000-0000-4000-8000-000000000002';
const auth:BookingAccess={principalKind:'host',providerSubject:'host-google',accessToken:'private-token',scopes:['https://www.googleapis.com/auth/calendar.events']};
function snapshot():BookingTransportSnapshot{return {requestId,attemptId,proposalVersion:2,calendarId:'selected/calendar+id@example.com',eventId:'fmat123abc',connectionProviderSubject:'host-google',phase:'dispatched',payloadFingerprint:'a'.repeat(64),payload:{id:'fmat123abc',summary:'Meeting: Review',description:'Requested by Guest\nReview',location:'https://meet.example.com/review',start:{dateTime:'2030-01-01T10:00:00.000000001Z',timeZone:'Asia/Seoul'},end:{dateTime:'2030-01-01T10:30:00.000000001Z',timeZone:'Asia/Seoul'},attendees:[{email:'guest@example.com'},{email:'host@example.com'}],extendedProperties:{private:{fmatRequestId:requestId,fmatAttemptId:attemptId,fmatProposalVersion:'2'}}}};}
function event(){return {...snapshot().payload,status:'confirmed',etag:'"version-1"',htmlLink:'https://www.google.com/calendar/event?eid=public-event',organizer:{email:'calendar-owner@example.com'},privateProviderField:'must not escape'};}
const error=(status:number,reason:string)=>Response.json({error:{code:status,message:'private provider detail',errors:[{reason}]}},{status});
test('Calendar insert uses only the frozen selected destination/payload and returns minimized matching evidence',async()=>{
 let count=0;
 const provider=new GoogleBookingProvider(async(url,init)=>{count++;const target=new URL(String(url));assert.equal(target.origin,'https://www.googleapis.com');assert.equal(target.pathname,'/calendar/v3/calendars/selected%2Fcalendar%2Bid%40example.com/events');assert.equal(target.search,'?sendUpdates=all');assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');assert.ok(init?.signal);assert.deepEqual(JSON.parse(init!.body as string),snapshot().payload);assert.equal(new Headers(init?.headers).get('authorization'),'Bearer private-token');return Response.json(event());});
 const result=await provider.insert(auth,snapshot());assert.deepEqual(result,{outcome:'confirmed',evidence:{calendarId:snapshot().calendarId,eventId:snapshot().eventId,payloadFingerprint:'a'.repeat(64),eventUrl:event().htmlLink,etag:'"version-1"'}});assert.equal(count,1);assert.doesNotMatch(JSON.stringify(result),/privateProviderField|guest@example|private-token/);
});
test('A lost successful insert response reconciles the same event without another POST',async()=>{
 let stored:ReturnType<typeof event>|undefined,posts=0,gets=0;
 const provider=new GoogleBookingProvider(async(url,init)=>{if(init?.method==='POST'){posts++;stored=event();throw new Error('connection closed after creation');}gets++;assert.equal(new URL(String(url)).pathname,'/calendar/v3/calendars/selected%2Fcalendar%2Bid%40example.com/events/fmat123abc');assert.equal(init?.body,undefined);return Response.json(stored);});
 assert.deepEqual(await provider.insert(auth,snapshot()),{outcome:'uncertain',reason:'provider_response_unavailable'});
 for(let i=0;i<3;i++)assert.equal((await provider.reconcile(auth,{...snapshot(),phase:'uncertain'})).outcome,'confirmed');
 assert.equal(posts,1);assert.equal(gets,3);
 await assert.rejects(provider.insert(auth,{...snapshot(),phase:'uncertain'}),/BOOKING_RECONCILIATION_REQUIRED/);assert.equal(posts,1);
});
test('Duplicate insert ID and immediate not-found observations never prove booking or authorize replacement',async()=>{
 let calls=0;const provider=new GoogleBookingProvider(async(_url,init)=>{calls++;return init?.method==='POST'?error(409,'duplicate'):error(404,'notFound');});
 assert.deepEqual(await provider.insert(auth,snapshot()),{outcome:'uncertain',reason:'event_identity_exists'});
 assert.deepEqual(await provider.reconcile(auth,{...snapshot(),phase:'uncertain'}),{outcome:'uncertain',reason:'event_not_observed'});assert.equal(calls,2);
 assert.equal((await new GoogleBookingProvider(async()=>error(410,'deleted')).reconcile(auth,snapshot())).outcome,'uncertain');
});
test('Changed association, interval, attendee or meeting details produce conflict rather than booked evidence',async()=>{
 const changes:((e:Record<string,unknown>)=>void)[]=[
  e=>{e.id='foreign123';},e=>{e.status='cancelled';},e=>{e.summary='changed';},e=>{e.description='private notes';},e=>{e.location='changed';},
  e=>{e.start={dateTime:'2030-01-01T10:00:00.000000002Z'};},e=>{e.end={dateTime:'2030-01-01T11:00:00Z'};},
  e=>{e.start={dateTime:snapshot().payload.start.dateTime,date:'2030-01-01'};},
  e=>{e.extendedProperties={private:{...snapshot().payload.extendedProperties.private,fmatRequestId:attemptId}};},
  e=>{e.extendedProperties={private:{...snapshot().payload.extendedProperties.private,fmatAttemptId:requestId}};},
  e=>{e.extendedProperties={private:{...snapshot().payload.extendedProperties.private,fmatProposalVersion:'1'}};},
  e=>{e.attendees=[{email:'attacker@example.com'}];},e=>{e.attendees=[...snapshot().payload.attendees,{email:'guest@example.com'}];},
  e=>{e.attendees=[{email:'guest@example.com',additionalGuests:1},{email:'host@example.com'}];},
  e=>{e.attendeesOmitted=true;},e=>{e.recurrence=['RRULE:FREQ=DAILY'];},e=>{e.recurringEventId='another';},e=>{e.eventType='focusTime';},e=>{e.transparency='transparent';},e=>{e.guestsCanModify=true;},
 ];
 for(const change of changes){const value:Record<string,unknown>=structuredClone(event());change(value);const result=await new GoogleBookingProvider(async()=>Response.json(value)).reconcile(auth,snapshot());assert.deepEqual(result,{outcome:'conflict',reason:'event_snapshot_mismatch'});}
});
test('Provider time normalization and attendee order/case/RSVP metadata do not create false conflicts',async()=>{
 const value={...event(),start:{dateTime:'2030-01-01T19:00:00.000000001+09:00'},end:{dateTime:'2030-01-01T19:30:00.000000001+09:00'},attendees:[{email:'HOST@example.com',responseStatus:'declined'},{email:'Guest@example.com',responseStatus:'needsAction'}]};
 assert.equal((await new GoogleBookingProvider(async()=>Response.json(value)).reconcile(auth,snapshot())).outcome,'confirmed');
});
test('Only explicit structured insert rejection is noncreating; lookup failures always retain uncertainty',async()=>{
 for(const [status,reason,expected] of [[400,'badRequest','provider_bad_request'],[401,'authError','permission_denied'],[403,'forbidden','permission_denied'],[404,'notFound','calendar_not_found']] as const){
  const provider=new GoogleBookingProvider(async()=>error(status,reason));assert.deepEqual(await provider.insert(auth,snapshot()),{outcome:'noncreating',reason:expected});assert.equal((await provider.reconcile(auth,snapshot())).outcome,'uncertain');
 }
 for(const [status,reason]of [[403,'rateLimitExceeded'],[429,'rateLimitExceeded'],[500,'backendError'],[503,'backendError'],[400,'futureUnknownReason']] as const)assert.equal((await new GoogleBookingProvider(async()=>error(status,reason)).insert(auth,snapshot())).outcome,'uncertain');
 for(const body of [{error:{code:401,errors:[{reason:'badRequest'}]}},{error:{code:400,errors:[]}},{error:{code:400,errors:[{reason:'badRequest'},{reason:'backendError'}]}}])assert.equal((await new GoogleBookingProvider(async()=>Response.json(body,{status:400})).insert(auth,snapshot())).outcome,'uncertain');
});
test('Malformed, missing, oversized and unreadable responses leave an uncertain result without retry or leaking errors',async()=>{
 const fixtures:(()=>Response)[]=[()=>new Response('secret-not-json'),()=>new Response(null,{status:204}),()=>Response.json({id:'fmat123abc'}),()=>new Response('x'.repeat(256*1024+1)),()=>new Response('private html',{status:403}),()=>new Response(new ReadableStream({start(controller){controller.error(new Error('secret'));}}))];
 for(const fixture of fixtures){let calls=0;const result=await new GoogleBookingProvider(async()=>{calls++;return fixture();}).insert(auth,snapshot());assert.equal(result.outcome,'uncertain');assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(result),/secret|private html/);}
});
test('Transport rejects guest credentials, changed account, alias destination and inconsistent immutable input before network access',async()=>{
 let calls=0;const provider=new GoogleBookingProvider(async()=>{calls++;return Response.json(event());});
 for(const input of [{...auth,principalKind:'guest'},{...auth,scopes:['https://www.googleapis.com/auth/calendar.events.freebusy']},{...auth,providerSubject:'different-account'},{...auth,accessToken:'header\ninjection'}])await assert.rejects(provider.insert(input as BookingAccess,snapshot()));
 for(const input of [{...snapshot(),calendarId:'primary'},{...snapshot(),eventId:'invalid-hyphen'},{...snapshot(),requestId:attemptId},{...snapshot(),phase:'prepared'},{...snapshot(),payload:{...snapshot().payload,privateNotes:'unexpected'}},{...snapshot(),payload:{...snapshot().payload,end:snapshot().payload.start}},{...snapshot(),payload:{...snapshot().payload,attendees:[{email:'guest@example.com'},{email:'GUEST@example.com'}]}}])await assert.rejects(provider.insert(auth,input as BookingTransportSnapshot));
 assert.equal(calls,0);
});
test('Untrusted event links are omitted while valid matching booking evidence remains usable',async()=>{
 for(const htmlLink of ['javascript:alert(1)','https://www.google.com.attacker.example/calendar/event','https://attacker@www.google.com/calendar/event','https://www.google.com:444/calendar/event','https://www.google.com/redirect','not a url']){
  const result=await new GoogleBookingProvider(async()=>Response.json({...event(),htmlLink})).reconcile(auth,snapshot());assert.equal(result.outcome,'confirmed');if(result.outcome==='confirmed')assert.equal(result.evidence.eventUrl,null);
 }
});
