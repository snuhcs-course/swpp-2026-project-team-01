import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analysisApplication} from './calendar-analysis.ts';
import {browserDraftInput} from './setup.ts';
const choice={scanId:'81000000-0000-4000-8000-000000000001',expectedRevision:1,idempotencyKey:'82000000-0000-4000-8000-000000000001'};
test('reviewed suggestions accept explicit edited windows and indexed or manual places',()=>{
 assert.ok(analysisApplication.safeParse({...choice,windows:[{days:[1],start:'14:00',end:'16:00'}],meetingMode:'either',location:{policy:'preferred',places:[{index:0,label:'Library lounge'},{label:'Campus cafe'}]}}).success);
 assert.ok(analysisApplication.safeParse({...choice,schedule:false,meetingMode:'online'}).success);
 assert.ok(analysisApplication.safeParse(choice).success,'existing schedule-only action remains valid');
});
test('reviewed suggestions reject malformed or contradictory decisions and forged origins',()=>{
 for(const patch of [{schedule:false,windows:[{days:[1],start:'14:00',end:'16:00'}]},{meetingMode:'online',location:{policy:'per_meeting'}},{location:{policy:'preferred',places:[]}},{location:{policy:'preferred',places:[{index:5,label:'Invalid'}]}},{location:{policy:'preferred',places:[{index:0,label:'One'},{index:0,label:'Two'}]}},{location:{policy:'preferred',places:[{label:'One'},{label:'One'}]}},{origins:{source:'calendar'}},{hostId:'another'}])assert.equal(analysisApplication.safeParse({...choice,...patch}).success,false);
 assert.equal(browserDraftInput.safeParse({expectedRevision:1,idempotencyKey:choice.idempotencyKey,patch:{rules:{locations:['Venue']}},unresolved:[],origins:{'rules.locations':{source:'calendar'}}}).success,false);
});
