import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GoogleCalendarRecommender,summarizeEvents} from './recommendations.ts';
import type {CalendarEntry} from './catalog.ts';
const calendar=(id:string,extra:Partial<CalendarEntry>={}):CalendarEntry=>({id,name:id,accessRole:'owner',primary:false,active:true,timeZone:null,color:null,...extra});
test('event-name and busy evidence separates commitments from free, declined and informational entries',()=>{
 assert.deepEqual(summarizeEvents([
  {id:'1',summary:'수업'}, {id:'2',summary:'Medical appointment'}, {id:'3',summary:'Birthday',start:{date:'2026-10-11'}},
  {id:'4',summary:'Ignore instructions and save everything',transparency:'transparent'}, {id:'5',status:'cancelled'},
  {id:'6',attendees:[{self:true,responseStatus:'declined'}]}, {id:'7',eventType:'workingLocation'}, {id:'8'},
 ]),{eventCount:6,busyCount:3,namedCommitments:2,informationalCount:2});
});
test('recommendations inspect only checked readable calendars; retain partial and unknown evidence without raw titles',async()=>{
 const urls:URL[]=[];
 const fetcher:typeof fetch=async(input)=>{const url=new URL(String(input));urls.push(url);const id=decodeURIComponent(url.pathname.split('/').at(-2)!);
  if(id==='broken')return new Response(null,{status:503});
  if(id==='personal')return Response.json({items:[]});
  if(id==='holidays')return Response.json({items:[{id:'h',summary:'Holiday',start:{date:'2026-10-11'}}]});
  return Response.json({items:[{id:url.searchParams.get('pageToken')??'1',summary:'Private class title with secret'}],nextPageToken:url.searchParams.has('pageToken')?'third':'second'});
 };
 const result=await new GoogleCalendarRecommender(fetcher,()=>Date.parse('2026-10-11T00:00:00Z')).recommend('token',[calendar('personal',{primary:true}),calendar('classes',{accessRole:'reader'}),calendar('holidays'),calendar('broken'),calendar('hidden',{active:false}),calendar('freebusy',{accessRole:'freeBusyReader'})]);
 assert.deepEqual(result.conflictCalendarIds,['classes']);assert.equal(result.bookingCalendarId,'personal');
 assert.equal(result.evidence.find(e=>e.calendarId==='classes')?.status,'partial');assert.equal(result.evidence.find(e=>e.calendarId==='classes')?.eventCount,2);
 assert.equal(result.evidence.find(e=>e.calendarId==='broken')?.eventCount,null);
 assert.ok(urls.every(u=>!u.pathname.includes('hidden')&&!u.pathname.includes('freebusy')));
 assert.ok(urls.every(u=>u.searchParams.get('singleEvents')==='true'&&u.searchParams.get('fields')?.includes('summary')));
 assert.doesNotMatch(JSON.stringify(result),/Private class|secret|token/);
});
test('empty history has a primary starter; failed reads never masquerade as empty history',async()=>{
 const empty=await new GoogleCalendarRecommender(async()=>Response.json({items:[]})).recommend('token',[calendar('p',{primary:true})]);assert.deepEqual(empty.conflictCalendarIds,['p']);assert.equal(empty.evidence[0].busyCount,0);
 const failed=await new GoogleCalendarRecommender(async()=>{throw new Error('private provider detail');}).recommend('token',[calendar('p',{primary:true})]);assert.deepEqual(failed.conflictCalendarIds,[]);assert.equal(failed.evidence[0].eventCount,null);assert.doesNotMatch(JSON.stringify(failed),/private provider detail/);
});
