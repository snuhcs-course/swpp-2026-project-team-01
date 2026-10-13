import {test} from 'node:test';
import assert from 'node:assert/strict';
import {weeklyHoursLabel,weeklyDaySegments} from './weekly-hours.ts';
test('overnight display keeps starting weekday and splits the visual range at midnight',()=>{
 const windows=[{days:[1],start:'22:00',end:'02:00'}];
 assert.equal(weeklyHoursLabel(windows[0]),'22:00–02:00 (+1 day)');
 assert.deepEqual(weeklyDaySegments(windows,1),[{start:1320,end:1440,label:'22:00–02:00 (+1 day)'}]);
 assert.deepEqual(weeklyDaySegments(windows,2),[{start:0,end:120,label:'00:00–02:00 (from Monday)'}]);assert.deepEqual(weeklyDaySegments(windows,3),[]);
});
test('weekly display handles week rollover, midnight ends and mixed same-day windows',()=>{
 const windows=[{days:[6],start:'23:00',end:'01:00'},{days:[0],start:'09:00',end:'12:00'}];
 assert.deepEqual(weeklyDaySegments(windows,0),[{start:0,end:60,label:'00:00–01:00 (from Saturday)'},{start:540,end:720,label:'09:00–12:00'}]);
 assert.deepEqual(weeklyDaySegments([{days:[0],start:'22:00',end:'00:00'}],1),[]);
 assert.equal(weeklyHoursLabel({start:'09:00',end:'17:00'}),'09:00–17:00');
});
