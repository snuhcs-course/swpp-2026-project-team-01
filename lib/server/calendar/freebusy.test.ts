import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GoogleFreeBusy} from './freebusy.ts';
import {ApplicationError} from '../errors.ts';
const start='2030-01-01T00:00:00Z',end='2030-01-02T00:00:00Z',windows=[{start,end}];
const code=(value:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===value;
test('Free/busy reads only selected IDs, merges half-open overlaps and strips provider details',async()=>{
 const provider=new GoogleFreeBusy(async(url,init)=>{assert.equal(url,'https://www.googleapis.com/calendar/v3/freeBusy');const input=JSON.parse(init?.body as string);assert.deepEqual(input.items,[{id:'one'},{id:'two'}]);assert.equal(input.groupExpansionMax,0);assert.equal(init?.redirect,'error');return Response.json({timeMin:start,timeMax:end,calendars:{one:{busy:[{start:'2029-12-31T23:00:00Z',end:'2030-01-01T03:00:00Z',summary:'private'}]},two:{busy:[{start:'2030-01-01T02:00:00Z',end:'2030-01-01T04:00:00Z'}]},unselected:{busy:[{start,end}]}}});});
 // Unexpected event-like fields are rejected without exposing the payload.
 await assert.rejects(provider.read('secret',['one','two'],windows),code('PROVIDER_UNAVAILABLE'));
 const valid=new GoogleFreeBusy(async()=>Response.json({timeMin:start,timeMax:end,calendars:{one:{busy:[{start:'2029-12-31T23:00:00Z',end:'2030-01-01T03:00:00Z'}]},two:{busy:[{start:'2030-01-01T02:00:00Z',end:'2030-01-01T04:00:00Z'}]}}}));
 assert.deepEqual(await valid.read('secret',['one','two'],windows),[{start:'2030-01-01T00:00:00.000Z',end:'2030-01-01T04:00:00.000Z'}]);
});
test('Free/busy missing calendars, per-calendar errors, malformed intervals and incomplete coverage never become free time',async()=>{
 for(const calendars of [{},{one:{errors:[{reason:'internalError'}],busy:[]}},{one:{busy:[{start:end,end:start}]}},{one:{busy:[{start:'2030-01-01T01:00:00',end}]}}]){
  await assert.rejects(new GoogleFreeBusy(async()=>Response.json({timeMin:start,timeMax:end,calendars})).read('secret',['one'],windows),code('PROVIDER_UNAVAILABLE'));
 }
 await assert.rejects(new GoogleFreeBusy(async()=>Response.json({timeMin:start,timeMax:'2030-01-01T12:00:00Z',calendars:{one:{busy:[]}}})).read('secret',['one'],windows),code('PROVIDER_UNAVAILABLE'));
 await assert.rejects(new GoogleFreeBusy(async()=>new Response('',{status:401})).read('secret',['one'],windows),code('RECONNECT_REQUIRED'));
 assert.deepEqual(await new GoogleFreeBusy(async()=>Response.json({timeMin:start,timeMax:end,calendars:{one:{busy:[]}}})).read('secret',['one'],windows),[]);
});
test('Failure in a later free/busy range discards the entire result',async()=>{
 let calls=0;const provider=new GoogleFreeBusy(async(_url,init)=>{const input=JSON.parse(init?.body as string);if(++calls===2)throw new Error('private provider error');return Response.json({timeMin:input.timeMin,timeMax:input.timeMax,calendars:{one:{busy:[]}}});});
 await assert.rejects(provider.read('secret',['one'],[...windows,{start:'2030-02-01T00:00:00Z',end:'2030-02-02T00:00:00Z'}]),code('PROVIDER_UNAVAILABLE'));assert.equal(calls,2);
});

test('Padded maximum-length windows are split after merging and retain submillisecond busy boundaries',async()=>{
 const {bufferedReadWindows}=await import('./freebusy.ts');
 const ranges=bufferedReadWindows([{start:'2030-01-01T00:00:00Z',end:'2030-02-01T00:00:00Z'}],240);
 assert.equal(ranges.length,2);assert.equal(ranges[0].start,'2029-12-31T20:00:00.000Z');assert.equal(ranges[1].end,'2030-02-01T04:00:00.000Z');
 const calls:{timeMin:string;timeMax:string}[]=[];
 const provider=new GoogleFreeBusy(async(_url,init)=>{const input=JSON.parse(init!.body as string);calls.push(input);assert.ok(Date.parse(input.timeMax)-Date.parse(input.timeMin)<=31*86400000);return Response.json({timeMin:input.timeMin,timeMax:input.timeMax,calendars:{one:{busy:calls.length===1?[{start:'2030-01-01T12:00:00.000000001Z',end:'2030-01-01T12:00:00.000000002Z'}]:[]}}});});
 assert.deepEqual(await provider.read('secret',['one'],ranges),[{start:'2030-01-01T12:00:00.000000001Z',end:'2030-01-01T12:00:00.000000002Z'}]);assert.equal(calls.length,2);
 assert.equal(calls[0].timeMax,calls[1].timeMin,'No uncovered instant between pages');
});
test('Denied or missing selected calendars require reconnection even when Google omits busy',async()=>{
 for(const reason of ['notFound','forbidden'])await assert.rejects(new GoogleFreeBusy(async()=>Response.json({timeMin:start,timeMax:end,calendars:{one:{errors:[{reason}]}}})).read('secret',['one'],windows),code('RECONNECT_REQUIRED'));
 await assert.rejects(new GoogleFreeBusy(async()=>Response.json({timeMin:start,timeMax:end,calendars:{one:{errors:[{reason:'futureUnknownError'}]}}})).read('secret',['one'],windows),code('PROVIDER_UNAVAILABLE'));
});
