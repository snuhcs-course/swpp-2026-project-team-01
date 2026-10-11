import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activeCalendars,calendarLabel} from './calendar-display';
const entry=(id:string,name:string,active=true)=>({id,name,active,primary:false,accessRole:'owner' as const,timeZone:null,color:null});
test('Calendar choices omit inactive entries and label duplicates without exposing identifiers',()=>{
 const calendars=[entry('a@example.test','Work'),entry('b@example.test','Work'),entry('hidden','Hidden',false)];
 assert.deepEqual(activeCalendars(calendars).map(c=>c.id),['a@example.test','b@example.test']);
 assert.equal(calendarLabel(calendars[0],calendars),'Work (1)');assert.equal(calendarLabel(calendars[1],calendars),'Work (2)');
 for(const c of [entry('id@example.test','id@example.test'),entry('id','https://example.test/calendar'),entry('id','')])assert.equal(calendarLabel(c,[c]),'Untitled calendar');
});
