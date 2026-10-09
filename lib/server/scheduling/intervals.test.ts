import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Temporal} from '@js-temporal/polyfill';
import {evaluateIntervals,intervalFits,sampleIntervals} from './intervals.ts';
import type {IntervalFeasibilityInput,SchedulingInterval} from '../../contracts/interval-feasibility.ts';
const slot=(start:string,end:string)=>({start,end});
const at=(hour:number,minute=0)=>`2030-01-07T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00Z`;
const base=():IntervalFeasibilityInput=>({now:at(0),requesterTimezone:'Asia/Seoul',durationMinutes:30,windows:[slot(at(8),at(18))],requesterAvailability:[slot(at(8),at(18))],requesterBusy:[],hostBusy:[],rules:{timezone:'UTC',availability:[{days:[1],start:'09:00',end:'17:00'}],focusBlocks:[],bufferMinutes:0}});

test('full intervals obey host hours, independent requester windows and elapsed duration',()=>{
 const input=base();input.windows=[slot(at(8),at(12)),slot(at(14),at(18))];input.requesterAvailability=[slot(at(10),at(16))];
 const result=evaluateIntervals(input);assert.deepEqual(result,{status:'ready',windows:[slot(at(10),at(12)),slot(at(14),at(16))],durationMinutes:30,requesterTimezone:'Asia/Seoul'});
 assert.equal(intervalFits(result,slot(at(11,30),at(12))),true);
 assert.equal(intervalFits(result,slot(at(11,45),at(12,15))),false,'checking only the start would cross a gap');
 assert.equal(intervalFits(result,slot(at(10),at(10,15))),false,'requested elapsed duration required');
 const none=evaluateIntervals({...input,requesterAvailability:[]});assert.deepEqual(none.status==='ready'?none.windows:null,[],'explicitly empty availability is not missing availability');
 assert.throws(()=>evaluateIntervals({...input,requesterBusy:undefined} as unknown as IntervalFeasibilityInput),'missing Calendar result cannot become empty');
});

test('half-open busy/focus boundaries and independent requester conflicts exclude exactly the overlap',()=>{
 const input=base();input.hostBusy=[slot(at(9,30),at(10)),slot(at(14),at(15))];input.requesterBusy=[slot(at(11),at(12))];input.rules.focusBlocks=[slot(at(13),at(13,30))];
 const result=evaluateIntervals(input);assert.deepEqual(result.status==='ready'?result.windows:null,[slot(at(9),at(9,30)),slot(at(10),at(11)),slot(at(12),at(13)),slot(at(13,30),at(14)),slot(at(15),at(17))]);
 for(const candidate of [slot(at(9),at(9,30)),slot(at(10),at(10,30)),slot(at(12,30),at(13)),slot(at(13,30),at(14))])assert.equal(intervalFits(result,candidate),true);
 for(const candidate of [slot(at(9,15),at(9,45)),slot(at(10,45),at(11,15)),slot(at(12,45),at(13,15))])assert.equal(intervalFits(result,candidate),false);
});

test('host buffers protect both sides of busy and focus, including commitments outside requested windows',()=>{
 const input=base();input.windows=[slot(at(10),at(14))];input.rules.bufferMinutes=10;input.hostBusy=[slot(at(9),at(10)),slot(at(14),at(15))];input.rules.focusBlocks=[slot(at(11),at(12))];
 const result=evaluateIntervals(input);assert.deepEqual(result.status==='ready'?result.windows:null,[slot(at(10,10),at(10,50)),slot(at(12,10),at(13,50))]);
 assert.equal(intervalFits(result,slot(at(10,20),at(10,50))),true);assert.equal(intervalFits(result,slot(at(10,21),at(10,51))),false);
 // Host buffers do not silently invent an extra requester buffer.
 input.hostBusy=[];input.rules.focusBlocks=[];input.requesterBusy=[slot(at(11),at(12))];
 assert.equal(intervalFits(evaluateIntervals(input),slot(at(10,30),at(11))),true);
});

test('overlapping and touching input ranges coalesce without duplicate samples or fabricated gaps',()=>{
 const input=base();input.windows=[slot(at(10),at(12)),slot(at(11),at(13)),slot(at(13),at(14))];input.hostBusy=[slot(at(11),at(11,30)),slot(at(11,15),at(12)),slot(at(12),at(12,30))];
 const result=evaluateIntervals(input);assert.deepEqual(result.status==='ready'?result.windows:null,[slot(at(10),at(11)),slot(at(12,30),at(14))]);
 assert.deepEqual(sampleIntervals(result,{stepMinutes:30,limit:300}),{intervals:[slot(at(10),at(10,30)),slot(at(10,30),at(11)),slot(at(12,30),at(13)),slot(at(13),at(13,30)),slot(at(13,30),at(14))],truncated:false});
 assert.equal(sampleIntervals(result,{stepMinutes:1,limit:2}).truncated,true);
 assert.throws(()=>sampleIntervals(result,{stepMinutes:0,limit:2}));assert.throws(()=>sampleIntervals(result,{stepMinutes:5,limit:301}));
});

test('daily host rules use the host IANA date, including Sunday and a different requester day',()=>{
 const input=base();input.rules={...input.rules,timezone:'Asia/Seoul',availability:[{days:[0],start:'09:00',end:'10:00'}]};input.now='2030-01-05T00:00:00Z';input.requesterTimezone='America/Los_Angeles';input.windows=input.requesterAvailability=[slot('2030-01-05T23:00:00Z','2030-01-06T03:00:00Z')];
 const result=evaluateIntervals(input);assert.deepEqual(result.status==='ready'?result.windows:null,[slot('2030-01-06T00:00:00Z','2030-01-06T01:00:00Z')]);
 assert.equal(Temporal.Instant.from(result.windows[0].start).toZonedDateTimeISO('America/Los_Angeles').day,5);
});

test('recurring working hours change UTC offsets across daylight saving rather than repeating a fixed UTC day',()=>{
 const input=base();input.now='2030-03-08T00:00:00Z';input.rules.timezone='America/New_York';input.rules.availability=[{days:[5,1],start:'09:00',end:'10:00'}];input.windows=input.requesterAvailability=[slot('2030-03-08T00:00:00Z','2030-03-12T00:00:00Z')];
 const result=evaluateIntervals(input);assert.deepEqual(result.status==='ready'?result.windows:null,[slot('2030-03-08T14:00:00Z','2030-03-08T15:00:00Z'),slot('2030-03-11T13:00:00Z','2030-03-11T14:00:00Z')]);
});

test('ambiguous and nonexistent weekly boundaries require clarification, with no actionable windows',()=>{
 for(const [date,start,end] of [['2030-03-10','02:30','04:00'],['2030-11-03','01:30','03:00']]){
  const input=base();input.now=date+'T00:00:00Z';input.windows=input.requesterAvailability=[slot(date+'T00:00:00Z',date+'T23:59:00Z')];input.rules.timezone='America/New_York';input.rules.availability=[{days:[0],start,end}];
  const result=evaluateIntervals(input);assert.deepEqual(result,{status:'clarification',windows:[],reason:'host_clock_change',dates:[date]});assert.deepEqual(sampleIntervals(result,{stepMinutes:15,limit:10}),{intervals:[],truncated:false});assert.equal(intervalFits(result,slot(date+'T08:00:00Z',date+'T08:30:00Z')),false);
 }
});

test('unambiguous windows spanning 23/25-hour days preserve real elapsed duration and both fold offsets',()=>{
 for(const [date,last,hours] of [['2030-03-10','08:00',3],['2030-11-03','09:00',5]] as const){
  const input=base();input.now=date+'T00:00:00Z';input.rules.timezone='America/New_York';input.rules.availability=[{days:[0],start:'00:00',end:'04:00'}];input.durationMinutes=60;input.windows=input.requesterAvailability=[slot(date+'T00:00:00Z',date+'T12:00:00Z')];
  const result=evaluateIntervals(input),samples=sampleIntervals(result,{stepMinutes:60,limit:100});assert.equal(samples.intervals.length,hours);assert.equal(result.windows[0].end,date+'T'+last+':00Z');
  for(const candidate of samples.intervals)assert.equal(Temporal.Instant.from(candidate.start).until(candidate.end).total('minutes'),60);
  if(hours===5){const starts=samples.intervals.map(s=>Temporal.Instant.from(s.start).toZonedDateTimeISO('America/New_York').toString());assert.ok(starts.some(v=>v.includes('01:00:00-04:00')));assert.ok(starts.some(v=>v.includes('01:00:00-05:00')));}
 }
});

test('short gaps, past intervals and sub-millisecond busy overlap never create candidates',()=>{
 const input=base();input.now=at(10,15);input.hostBusy=[slot(at(10,45),at(11))];input.windows=[slot(at(9),at(11))];
 const result=evaluateIntervals(input);assert.deepEqual(result.status==='ready'?result.windows:null,[slot(at(10,15),at(10,45))]);
 input.now=at(0);input.windows=[slot(at(10),at(10,30))];input.hostBusy=[slot('2030-01-07T10:29:59.999999999Z',at(11))];
 assert.deepEqual(evaluateIntervals(input).windows,[],'nanosecond overlap cannot be rounded away');
 input.windows=[slot(at(1),at(2))];input.now=at(3);assert.deepEqual(evaluateIntervals(input).windows,[]);
});

test('malformed instants, offset-free timestamps, unsupported zones and oversized search windows reject',()=>{
 for(const update of [{requesterTimezone:'+09:00'},{requesterTimezone:'Not/AZone'},{durationMinutes:0},{windows:[slot('2030-01-07T10:00:00',at(12))]},{hostBusy:[slot(at(12),at(10))]},{windows:[slot('2030-01-01T00:00:00Z','2030-03-01T00:00:00Z')]}])assert.throws(()=>evaluateIntervals({...base(),...update}));
});

test('differential minute-grid oracle checks deterministic filtering across both calendars and buffers',()=>{
 let seed=317;const random=(max:number)=>{seed=(seed*1664525+1013904223)>>>0;return seed%max;};
 const origin=Date.parse(at(9)),from=(m:number)=>new Date(origin+m*60000).toISOString();
 for(let run=0;run<50;run++){
  const input=base();input.durationMinutes=5+random(25);input.rules.bufferMinutes=random(10);input.rules.availability=[{days:[1],start:'09:00',end:'12:00'}];input.windows=[slot(from(0),from(180))];input.requesterAvailability=[slot(from(10),from(160))];
  const blocks=()=>Array.from({length:4},()=>{const start=random(180);return slot(from(start),from(start+1+random(20)));});input.hostBusy=blocks();input.requesterBusy=blocks();input.rules.focusBlocks=blocks();const result=evaluateIntervals(input);
  for(let start=0;start<180;start++){const end=start+input.durationMinutes,buffer=input.rules.bufferMinutes;const overlaps=(list:SchedulingInterval[],margin:number)=>list.some(b=>start<(Date.parse(b.end)-origin)/60000+margin&&(Date.parse(b.start)-origin)/60000-margin<end);
   const expected=start>=10&&end<=160&&!overlaps([...input.hostBusy,...input.rules.focusBlocks],buffer)&&!overlaps(input.requesterBusy,0);
   assert.equal(intervalFits(result,slot(from(start),from(end))),expected,`run ${run}, minute ${start}`);
  }
 }
});

test('documented ten-minute general buffer example excludes only times inside the protected gap',()=>{
 const input=base();input.hostBusy=[slot(at(10),at(11))];input.rules.bufferMinutes=10;const result=evaluateIntervals(input);
 assert.equal(intervalFits(result,slot(at(9,20),at(9,50))),true);
 assert.equal(intervalFits(result,slot(at(9,21),at(9,51))),false);
 assert.equal(intervalFits(result,slot(at(11,10),at(11,40))),true);
});

test('half-hour clock changes are evaluated from timezone rules without a one-hour assumption',()=>{
 const input=base();input.now='2030-04-06T00:00:00Z';input.rules.timezone='Australia/Lord_Howe';input.rules.availability=[{days:[0],start:'00:00',end:'04:00'}];input.windows=input.requesterAvailability=[slot('2030-04-06T00:00:00Z','2030-04-08T00:00:00Z')];
 const result=evaluateIntervals(input);assert.deepEqual(result.windows,[slot('2030-04-06T13:00:00Z','2030-04-06T17:30:00Z')]);assert.equal(sampleIntervals(result,{stepMinutes:30,limit:100}).intervals.length,9);
});

test('overnight hours belong to the starting weekday even for a next-morning-only request',()=>{
 const input=base();input.rules.availability=[{days:[1],start:'22:00',end:'02:00'}];
 input.windows=input.requesterAvailability=[slot('2030-01-08T01:00:00Z','2030-01-08T02:30:00Z')];
 assert.deepEqual(evaluateIntervals(input).windows,[slot('2030-01-08T01:00:00Z','2030-01-08T02:00:00Z')]);
 assert.equal(intervalFits(evaluateIntervals(input),slot('2030-01-08T01:45:00Z','2030-01-08T02:15:00Z')),false);
 input.windows=input.requesterAvailability=[slot('2030-01-09T01:00:00Z','2030-01-09T02:00:00Z')];assert.deepEqual(evaluateIntervals(input).windows,[]);
});

test('overnight Saturday rolls into Sunday in host time independently of the requester day',()=>{
 const input=base();input.now='2030-01-01T00:00:00Z';input.rules.timezone='Asia/Seoul';input.requesterTimezone='America/Los_Angeles';input.rules.availability=[{days:[6],start:'22:00',end:'02:00'}];
 input.windows=input.requesterAvailability=[slot('2030-01-05T16:00:00Z','2030-01-05T18:00:00Z')];
 assert.deepEqual(evaluateIntervals(input).windows,[slot('2030-01-05T16:00:00Z','2030-01-05T17:00:00Z')]);
});

test('overnight ranges merge with morning hours and retain buffers and midnight endpoints',()=>{
 const input=base();input.rules.availability=[{days:[1],start:'22:00',end:'02:00'},{days:[2],start:'01:00',end:'04:00'}];
 input.windows=input.requesterAvailability=[slot('2030-01-07T23:00:00Z','2030-01-08T04:00:00Z')];input.rules.bufferMinutes=10;
 input.hostBusy=[slot('2030-01-08T01:00:00Z','2030-01-08T01:30:00Z')];input.rules.focusBlocks=[slot('2030-01-08T02:30:00Z','2030-01-08T03:00:00Z')];
 assert.deepEqual(evaluateIntervals(input).windows,[slot('2030-01-07T23:00:00Z','2030-01-08T00:50:00Z'),slot('2030-01-08T01:40:00Z','2030-01-08T02:20:00Z'),slot('2030-01-08T03:10:00Z','2030-01-08T04:00:00Z')]);
 input.rules.availability=[{days:[1],start:'22:00',end:'00:00'}];assert.deepEqual(evaluateIntervals(input).windows,[slot('2030-01-07T23:00:00Z','2030-01-08T00:00:00Z')]);
});

test('overnight DST windows use next local date rather than 24 elapsed hours',()=>{
 for(const [date,start,end,hours] of [['2030-03-09','2030-03-10T03:00:00Z','2030-03-10T08:00:00Z',5],['2030-11-02','2030-11-03T02:00:00Z','2030-11-03T09:00:00Z',7]] as const){
  const input=base();input.now=date+'T00:00:00Z';input.rules.timezone='America/New_York';input.rules.availability=[{days:[6],start:'22:00',end:'04:00'}];input.durationMinutes=60;input.windows=input.requesterAvailability=[slot(start,end)];
  const result=evaluateIntervals(input);assert.deepEqual(result.windows,[slot(start,end)]);assert.equal(sampleIntervals(result,{stepMinutes:60,limit:20}).intervals.length,hours);
 }
});

test('overnight ambiguous or missing ends clarify, but unrelated previous-day rules do not',()=>{
 for(const [date,end] of [['2030-03-10','02:30'],['2030-11-03','01:30']] as const){
  const input=base();input.now=date+'T00:00:00Z';input.rules.timezone='America/New_York';input.rules.availability=[{days:[6],start:'22:00',end}];input.windows=input.requesterAvailability=[slot(date+'T05:00:00Z',date+'T10:00:00Z')];
  assert.equal(evaluateIntervals(input).status,'clarification');assert.deepEqual(evaluateIntervals(input).windows,[]);
  const monday=Temporal.PlainDate.from(date).add({days:1}).toString();input.windows=input.requesterAvailability=[slot(monday+'T13:00:00Z',monday+'T17:00:00Z')];input.rules.availability=[{days:[0],start:end,end:'04:00'},{days:[1],start:'09:00',end:'12:00'}];
  assert.equal(evaluateIntervals(input).status,'ready');assert.equal(evaluateIntervals(input).windows.length,1);
 }
});

test('distant overnight windows do not expand intervening clock-change dates',()=>{
 const input=base();input.now='2030-01-01T00:00:00Z';input.rules.timezone='America/New_York';input.rules.availability=[{days:[6],start:'22:00',end:'02:30'}];
 input.windows=input.requesterAvailability=[slot('2030-01-06T05:00:00Z','2030-01-06T06:00:00Z'),slot('2030-11-10T05:00:00Z','2030-11-10T06:00:00Z')];
 assert.deepEqual(evaluateIntervals(input).windows,input.windows);
});
