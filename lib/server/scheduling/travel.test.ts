import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateTravel,type TravelInput,type CachedLeg} from './travel.ts';
import {routeFingerprint,type RoutesProvider} from '../routes/google.ts';
import type {RouteRequest} from '../../contracts/travel.ts';
const now=Date.parse('2030-01-01T00:00:00Z'),at=(time:string)=>'2030-01-02T'+time+':00Z';
function input():TravelInput{return {contextFingerprint:'a'.repeat(64),candidate:{start:at('10:00'),end:at('10:30')},meetingMode:'in_person',location:{placeId:'meeting'},previous:{kind:'commitment',id:'previous',interval:{start:at('08:00'),end:at('09:00')},location:{placeId:'previous'}},next:{kind:'commitment',id:'next',interval:{start:at('11:30'),end:at('12:00')},location:{placeId:'next'}},mode:'DRIVE',bufferMinutes:10,travelBufferMinutes:5};}
function fixture(inbound=2700,outbound=2700){const calls:RouteRequest[]=[];const provider:RoutesProvider={async estimate(request){calls.push(request);return {status:'success',fingerprint:routeFingerprint(request),departureTime:request.departureTime,checkedAt:new Date(now).toISOString(),durationNanoseconds:(BigInt('placeId' in request.origin&&request.origin.placeId==='previous'?inbound:outbound)*1000000000n).toString(),distanceMeters:1000};}};return {calls,provider};}
test('Both trips use correct direction/departure and count general and extra travel buffers once',async()=>{
 const {provider,calls}=fixture();const result=await evaluateTravel(input(),provider,{now});assert.equal(result.status,'fits');assert.deepEqual(calls.map(c=>[c.origin,c.destination,c.departureTime]),[[{placeId:'previous'},{placeId:'meeting'},at('09:10')],[{placeId:'meeting'},{placeId:'next'},at('10:40')]]);
 assert.ok(result.legs.every(l=>l.requiredNanoseconds==='3000000000000'&&l.availableNanoseconds==='3000000000000'));
});
test('Inbound and outbound deficits independently reject the meeting, including a fractional-second overrun',async()=>{
 for(const [a,b,leg] of [[2701,2700,0],[2700,2701,1]] as const){const result=await evaluateTravel(input(),fixture(a,b).provider,{now});assert.equal(result.status,'conflict');assert.equal(result.legs[leg].status,'conflict');assert.equal(result.legs[1-leg].status,'fits');}
 const base=fixture().provider,result=await evaluateTravel(input(),{async estimate(request){const r=await base.estimate(request);if(r.status==='success')r.durationNanoseconds=(BigInt(r.durationNanoseconds)+1n).toString();return r;}},{now});assert.equal(result.status,'conflict');
});
test('Missing neighbors, locations and per-trip mode remain clarification with no guessed routes',async()=>{
 for(const mutate of [(i:TravelInput)=>{i.previous={kind:'unknown'};},(i:TravelInput)=>{if(i.previous.kind==='commitment')i.previous.location=null;},(i:TravelInput)=>{i.mode='PER_TRIP';}]){const value=input();mutate(value);const {provider}=fixture();assert.equal((await evaluateTravel(value,provider,{now})).status,'clarification');}
 const value=input();value.previous=value.next={kind:'none'};value.location=null;const {provider,calls}=fixture();assert.equal((await evaluateTravel(value,provider,{now})).status,'clarification');assert.equal(calls.length,0);
 value.location={placeId:'venue'};assert.equal((await evaluateTravel(value,provider,{now})).status,'fits');assert.equal(calls.length,0);
 value.meetingMode='online';value.previous=value.next={kind:'unknown'};assert.equal((await evaluateTravel(value,provider,{now})).status,'fits');assert.equal(calls.length,0);
});
test('No route, unsupported coverage, provider failure and thrown errors never become zero travel',async()=>{
 for(const status of ['no_route','unsupported','failure','throws'] as const){const provider:RoutesProvider={async estimate(request){const base={fingerprint:routeFingerprint(request),checkedAt:new Date(now).toISOString()};if(status==='throws')throw new Error('private transport message');if(status==='unsupported')return {status,reason:'location',...base};if(status==='failure')return {status,reason:'unavailable',...base};return {status,...base};}};const result=await evaluateTravel(input(),provider,{now});assert.equal(result.status,'clarification');assert.ok(result.legs.every(l=>l.status==='clarification'));assert.ok(!JSON.stringify(result).includes('private transport'));}
});
test('Cache reuse requires matching whole context and exact trip; changed context or expired evidence recomputes',async()=>{
 const first=fixture(),result=await evaluateTravel(input(),first.provider,{now}),cached:CachedLeg[]=result.legs.map(l=>({contextFingerprint:l.contextFingerprint,estimate:l.estimate!}));
 const second=fixture();await evaluateTravel(input(),second.provider,{now,cached});assert.equal(second.calls.length,0);
 for(const change of [(i:TravelInput)=>{i.contextFingerprint='b'.repeat(64);},(i:TravelInput)=>{if(i.previous.kind==='commitment')i.previous.id='replacement-event';},(i:TravelInput)=>{i.travelBufferMinutes=6;},(i:TravelInput)=>{i.location={placeId:'other'};}]){const value=input();change(value);const next=fixture();await evaluateTravel(value,next.provider,{now,cached});assert.equal(next.calls.length,2);}
 const expired=fixture();await evaluateTravel(input(),expired.provider,{now:now+300001,cached});assert.equal(expired.calls.length,2);
});
test('Future, stale, mismatched and malformed estimates cannot prove fit',async()=>{
 for(const alter of [(r:any)=>{r.checkedAt=new Date(now+1).toISOString();},(r:any)=>{r.checkedAt=new Date(now-300001).toISOString();},(r:any)=>{r.fingerprint='0'.repeat(64);},(r:any)=>{r.departureTime=at('09:11');},(r:any)=>{r.durationNanoseconds='-1';}]){
  const good=fixture().provider;const result=await evaluateTravel(input(),{async estimate(request){const value=await good.estimate(request);alter(value);return value;}},{now});assert.equal(result.status,'clarification');assert.ok(result.legs.every(l=>l.reason==='stale_estimate'));
 }
});
test('Overlapping adjacent commitments are hard conflicts before route or mode decisions',async()=>{
 const value=input();if(value.previous.kind==='commitment')value.previous.interval.end=at('10:01');value.mode='PER_TRIP';const {provider,calls}=fixture();const result=await evaluateTravel(value,provider,{now});assert.equal(result.status,'conflict');assert.equal(result.legs[0].reason,'overlap');assert.equal(calls.length,0);
});
test('A past trip cannot be reused as proof of a future trip from an assumed current location',async()=>{
 const {provider,calls}=fixture();const result=await evaluateTravel(input(),provider,{now:Date.parse(at('09:11'))});assert.equal(result.status,'clarification');assert.equal(result.legs[0].reason,'departure_context');assert.equal(calls.length,1,'Only the still-future outbound trip is requested');
});
test('Explicit per-trip choices preserve different inbound and outbound modes',async()=>{
 const value=input();value.mode='PER_TRIP';value.inboundMode='WALK';value.outboundMode='BICYCLE';const {provider,calls}=fixture();assert.equal((await evaluateTravel(value,provider,{now})).status,'fits');assert.deepEqual(calls.map(c=>c.mode),['WALK','BICYCLE']);
});

test('Explicit manual allowances replace unavailable estimates per leg and preserve both buffers',async()=>{
 const {travelLegFingerprint}=await import('./travel.ts');const value=input(),id='00000000-0000-4000-8000-000000000001';
 const allowance={id,direction:'inbound' as const,contextFingerprint:travelLegFingerprint(value,'inbound'),durationMinutes:45,mode:'WALK' as const,boundary:{at:at('09:00'),location:{placeId:'previous'}},reason:'Explicit host estimate'};
 const {provider,calls}=fixture();const result=await evaluateTravel(value,provider,{now,allowances:[allowance]});assert.equal(result.status,'fits');assert.equal(calls.length,1);assert.equal(result.legs[0].manualAllowanceId,id);assert.equal(result.legs[0].requiredNanoseconds,'3000000000000');assert.equal(result.legs[0].request?.mode,'WALK');
 const tooLong=await evaluateTravel(value,provider,{now,allowances:[{...allowance,durationMinutes:46}]});assert.equal(tooLong.legs[0].status,'conflict');assert.equal(tooLong.legs[0].reason,'insufficient_gap');
});
test('Unknown neighbors require explicit manual endpoint and boundary; changed context rejects reuse',async()=>{
 const {travelLegFingerprint}=await import('./travel.ts');const value=input();value.previous={kind:'unknown'};value.next={kind:'unknown'};
 const allowances=(['inbound','outbound'] as const).map(direction=>({id:direction==='inbound'?'00000000-0000-4000-8000-000000000001':'00000000-0000-4000-8000-000000000002',direction,contextFingerprint:travelLegFingerprint(value,direction),durationMinutes:30,mode:'TRANSIT' as const,boundary:{at:at(direction==='inbound'?'09:00':'11:30'),location:{placeId:direction}},reason:'Host supplied context'}));
 const {provider,calls}=fixture();assert.equal((await evaluateTravel(value,provider,{now,allowances})).status,'fits');assert.equal(calls.length,0);
 value.contextFingerprint='b'.repeat(64);assert.equal((await evaluateTravel(value,provider,{now,allowances})).status,'clarification');
});
test('Manual inputs cannot change a known boundary or location, waive overlaps or assume past departures',async()=>{
 const {travelLegFingerprint}=await import('./travel.ts');
 for(const kind of ['boundary','location','overlap','past'] as const){
  const value=input();if(kind==='overlap'&&value.previous.kind==='commitment')value.previous.interval.end=at('10:01');
  const allowance={id:'00000000-0000-4000-8000-000000000001',direction:'inbound' as const,contextFingerprint:travelLegFingerprint(value,'inbound'),durationMinutes:1,mode:'DRIVE' as const,boundary:{at:at(kind==='boundary'?'08:00':kind==='overlap'?'10:01':'09:00'),location:{placeId:kind==='location'?'invented':'previous'}},reason:'Test'};
  const result=await evaluateTravel(value,fixture().provider,{now:kind==='past'?Date.parse(at('09:11')):now,allowances:[allowance]});assert.notEqual(result.legs[0].status,'fits');if(kind==='overlap')assert.equal(result.legs[0].status,'conflict');
 }
});

test('A past origin is replaced only by an explicit current place and time without enlarging a known gap',async()=>{
 const {travelLegFingerprint}=await import('./travel.ts');const value=input(),later=Date.parse(at('09:20'));
 const allowance={id:'00000000-0000-4000-8000-000000000001',direction:'inbound' as const,contextFingerprint:travelLegFingerprint(value,'inbound'),durationMinutes:20,mode:'WALK' as const,boundary:{at:at('09:21'),location:{placeId:'explicit-current-origin'}},reason:'Host confirms current location and available time'};
 const result=await evaluateTravel(value,fixture().provider,{now:later,allowances:[allowance]});assert.equal(result.legs[0].status,'fits');assert.equal(result.legs[0].request?.departureTime,at('09:31'));assert.deepEqual(result.legs[0].request?.origin,allowance.boundary.location);
 const past=await evaluateTravel(value,fixture().provider,{now:later,allowances:[{...allowance,boundary:{...allowance.boundary,at:at('09:00')}}]});assert.equal(past.legs[0].status,'clarification');
});
