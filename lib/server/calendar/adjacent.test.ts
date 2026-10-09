import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GoogleAdjacentEvents,adjacentContext,travelReadRange,unexplainedBusy,type TravelCommitment} from './adjacent.ts';
import {ApplicationError} from '../errors.ts';
const candidate={start:'2030-01-02T10:00:00.000000001Z',end:'2030-01-02T10:30:00.000000001Z'};
const raw=(id:string,start:string,end:string,other={})=>({id,etag:'v1',start:{dateTime:start},end:{dateTime:end},location:'A precise venue',...other});
const page=(items:unknown[],other={})=>({timeZone:'UTC',accessRole:'reader',items,...other});
const at=(time:string)=>'2030-01-02T'+time+':00Z';
const fail=(error:unknown)=>error instanceof ApplicationError&&error.code==='PROVIDER_UNAVAILABLE';
const current=async()=>{};
test('Remote conference commitments retain busy time but never establish a physical travel endpoint',async()=>{
 const remote=[{conferenceData:{entryPoints:[{entryPointType:'video',uri:'https://private.example'}]}},{conferenceData:{conferenceSolution:{key:{type:'hangoutsMeet'}}}},{hangoutLink:'https://private.example'}];
 for(const details of remote){
  const provider=new GoogleAdjacentEvents(async()=>Response.json(page([raw('remote',at('09:00'),at('09:30'),{...details,location:'Private remote venue',description:'Private note'}),raw('physical',at('11:00'),at('12:00'),{location:'Office'})])));
  const events=await provider.read('token',['a'],candidate,current);
  assert.equal(events.length,2);assert.equal(events[0].location,null);assert.deepEqual(events[1].location,{address:'Office'});
  assert.deepEqual(events[0].interval,{start:at('09:00'),end:at('09:30')});
  assert.doesNotMatch(JSON.stringify(events),/Private|https:|conferenceData|hangoutLink/);
  const previous=adjacentContext(candidate,events,'basis').previous;
  assert.equal(previous.kind,'commitment');if(previous.kind==='commitment')assert.equal(previous.location,null);
 }
});
test('Adjacent reads use expanded recurring events, minimal fields, all pages/calendars and outward second bounds',async()=>{
 const urls:URL[]=[];let checks=0;
 const provider=new GoogleAdjacentEvents(async(url,init)=>{const u=new URL(String(url));urls.push(u);assert.equal(new Headers(init?.headers).get('authorization'),'Bearer private');assert.equal(init?.cache,'no-store');assert.equal(init?.redirect,'error');assert.ok(init?.signal);assert.equal(u.searchParams.get('singleEvents'),'true');assert.equal(u.searchParams.get('showHiddenInvitations'),'true');assert.equal(u.searchParams.get('maxAttendees'),'1');assert.equal(u.searchParams.get('timeMin'),'2029-12-02T10:00:00Z');assert.equal(u.searchParams.get('timeMax'),'2030-02-02T10:30:01Z');assert.doesNotMatch(u.searchParams.get('fields')!,/description|summary|email|hangout|uri/);assert.ok(u.searchParams.get('fields')!.includes('conferenceData(entryPoints(entryPointType),conferenceSolution(key(type)))'));
  return Response.json(urls.length===1?page([],{nextPageToken:'second'}):page([raw('event-'+urls.length,at('09:00'),at('09:30'))]));
 });
 const result=await provider.read('private',['calendar/a','other'],candidate,async()=>{checks++;});assert.equal(urls.length,3);assert.equal(checks,4);assert.match(urls[0].pathname,/calendar%2Fa/);assert.equal(urls[1].searchParams.get('pageToken'),'second');assert.equal(result.length,2);assert.ok(!JSON.stringify(result).includes('private'));assert.equal(travelReadRange(candidate).start,'2029-12-02T10:00:00.000000001Z');
});
test('Ignored noncommitments cannot erase busy events; missing/unsafe locations remain unknown',async()=>{
 const ignored=['cancelled','transparent','workingLocation','declined'].map((kind,i)=>raw('ignore-'+i,at('08:00'),at('09:00'),kind==='cancelled'?{status:kind}:kind==='transparent'?{transparency:kind}:kind==='workingLocation'?{eventType:kind}:{attendees:[{self:true,responseStatus:kind}]}));
 const p=new GoogleAdjacentEvents(async()=>Response.json(page([...ignored,raw('private',at('09:00'),at('09:30'),{location:'https://private.example.test',description:'secret'}),raw('all-day','unused','unused',{start:{date:'2030-01-02'},end:{date:'2030-01-03'},location:undefined})])));
 const result=await p.read('token',['a'],candidate,current);assert.equal(result.length,2);assert.ok(result.every(e=>e.location===null));assert.equal(result[1].interval.start,'2030-01-02T00:00:00Z');assert.ok(!JSON.stringify(result).includes('secret'));
});
test('Partial, inaccessible, malformed, repeated and oversized pages fail instead of declaring absence',async()=>{
 for(const status of [401,403,404])await assert.rejects(new GoogleAdjacentEvents(async()=>new Response('',{status})).read('token',['a'],candidate,current),(e:unknown)=>e instanceof ApplicationError&&e.code==='RECONNECT_REQUIRED');
 for(const body of [page([],{accessRole:'freeBusyReader'}),page([raw('bad',at('10:00'),at('09:00'))]),page([raw('dup',at('08:00'),at('09:00')),raw('dup',at('08:00'),at('09:00'))]),{timeZone:'UTC',accessRole:'reader'}])await assert.rejects(new GoogleAdjacentEvents(async()=>Response.json(body)).read('token',['a'],candidate,current),fail);
 let reads=0;await assert.rejects(new GoogleAdjacentEvents(async()=>{reads++;return Response.json(page([],{nextPageToken:'repeat'}));}).read('token',['a'],candidate,current),fail);assert.equal(reads,2);
 await assert.rejects(new GoogleAdjacentEvents(async()=>new Response('x'.repeat(2*1024*1024+1))).read('token',['a'],candidate,current),fail);
 let count=0;await assert.rejects(new GoogleAdjacentEvents(async()=>{count++;return Response.json(page([],{nextPageToken:'more'}));}).read('token',['a'],candidate,async()=>{if(count)throw new ApplicationError('NOT_FOUND',404);}),(e:unknown)=>e instanceof ApplicationError&&e.code==='NOT_FOUND');assert.equal(count,1,'Revocation stops the next page');
});
test('All-day and ambiguous local-time normalization follows calendar timezone without guessing a DST occurrence',async()=>{
 const p=new GoogleAdjacentEvents(async()=>Response.json(page([raw('a','','',{start:{date:'2030-01-02'},end:{date:'2030-01-03'}})],{timeZone:'Asia/Seoul'})));
 const [event]=await p.read('token',['a'],candidate,current);assert.equal(event.interval.start,'2030-01-01T15:00:00Z');
 const ambiguous=raw('a','','',{start:{dateTime:'2030-11-03T01:30:00',timeZone:'America/New_York'},end:{dateTime:'2030-11-03T02:30:00',timeZone:'America/New_York'}});
 await assert.rejects(new GoogleAdjacentEvents(async()=>Response.json(page([ambiguous]))).read('token',['a'],candidate,current),fail);
});
const commitment=(id:string,start:string,end:string,location:string|null='A'):TravelCommitment=>({id,calendarId:'calendar',eventId:id,version:'v1',interval:{start:at(start),end:at(end)},location:location?{address:location}:null});
test('Unexplained free/busy remains a location-unknown commitment, preserving partial and fractional gaps',()=>{
 const blocks=[{start:at('08:00'),end:at('10:00')}],events=[commitment('a','08:00','09:00')];
 const remainder=unexplainedBusy(blocks,events);assert.deepEqual(remainder.map(c=>c.interval),[{start:at('09:00'),end:at('10:00')}]);assert.equal(remainder[0].location,null);
 assert.deepEqual(unexplainedBusy(blocks,[...events,commitment('b','09:00','10:00')]),[]);
 const fractional={...events[0],interval:{start:at('08:00'),end:'2030-01-02T09:59:59.999999999Z'}};assert.equal(unexplainedBusy(blocks,[fractional])[0].interval.start,fractional.interval.end);
 const neighbor=adjacentContext(candidate,[...events,...remainder],'basis').previous;assert.equal(neighbor.kind,'commitment');if(neighbor.kind==='commitment')assert.equal(neighbor.location,null);
});
test('Neighbors use latest prior end and earliest next start; absence/ties remain unknown and exact overlap stays hard',()=>{
 const events=[commitment('earlier','07:00','08:00'),commitment('previous','08:30','09:00'),commitment('next','11:00','12:00'),commitment('later','13:00','14:00')];
 const result=adjacentContext(candidate,events,'basis');assert.equal(result.previous.kind,'commitment');if(result.previous.kind==='commitment')assert.equal(result.previous.id,'previous');assert.equal(result.next.kind,'commitment');if(result.next.kind==='commitment')assert.equal(result.next.id,'next');
 assert.deepEqual(adjacentContext(candidate,[],'basis').previous,{kind:'unknown'});
 const outside={...events[0],interval:{start:'2029-01-01T08:00:00Z',end:'2029-01-01T09:00:00Z'}};assert.deepEqual(adjacentContext(candidate,[outside],'basis').previous,{kind:'unknown'},'A local record outside Calendar coverage cannot establish the nearest location');
 assert.deepEqual(adjacentContext(candidate,[...events,commitment('tie','08:00','09:00','different')],'basis').previous,{kind:'unknown'});
 const overlapped=adjacentContext(candidate,[...events,commitment('overlap','10:15','10:45')],'basis');assert.equal(overlapped.previous.kind,'commitment');if(overlapped.previous.kind==='commitment')assert.equal(overlapped.previous.id,'overlap');
});
test('Calendar versions, local writes, locations and authority change context; input order does not',()=>{
 const events=[commitment('a','08:00','09:00'),commitment('b','11:00','12:00')],base=adjacentContext(candidate,events,'basis').fingerprint;
 assert.equal(adjacentContext(candidate,[...events].reverse(),'basis').fingerprint,base);
 for(const modified of [[{...events[0],version:'v2'},events[1]],[{...events[0],location:null},events[1]],[...events,commitment('local','09:00','09:30')]])assert.notEqual(adjacentContext(candidate,modified,'basis').fingerprint,base);
 assert.notEqual(adjacentContext(candidate,events,'changed').fingerprint,base);
 const duplicate={...events[0],id:'local'};assert.equal(adjacentContext(candidate,[...events,duplicate],'basis').previous.kind,'commitment');
});
