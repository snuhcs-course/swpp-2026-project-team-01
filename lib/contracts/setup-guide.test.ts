import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupState,type SetupState} from './setup.ts';
import {setupGuide,scheduleSuggestion} from './setup-guide.ts';
function fixture():SetupState{return setupState.parse({revision:1,rulesVersion:0,calendarGeneration:'80000000-0000-4000-8000-000000000001',calendarSelected:true,confirmed:{},draft:{revision:1,baseRulesVersion:0,settings:{handle:'example',displayName:'Example'},provenance:{},unresolved:[],clarifications:[],status:'active'},review:null,nextAction:'complete_preferences'});}
test('guidance follows connection authority and remembers optional analysis across reload',()=>{
 const s=fixture();assert.equal(setupGuide(s).step,'analysis');s.progress.analysisDecided=true;assert.equal(setupGuide(setupState.parse(JSON.parse(JSON.stringify(s)))).step,'schedule');
 s.calendarSelected=false;assert.equal(setupGuide(s).step,'calendars');s.calendarGeneration=null;assert.equal(setupGuide(s).step,'connect');
});
test('suggestions preserve known values and disappear after a persisted dismissal',()=>{
 const s=fixture();s.draft!.settings.rules={timezone:'Asia/Seoul',durationMinutes:45,bufferMinutes:0,availability:[{days:[6],start:'10:00',end:'12:00'}]};
 const proposed=scheduleSuggestion(s,'America/New_York')!;assert.equal(proposed.patch.rules!.timezone,'Asia/Seoul');assert.equal(proposed.patch.rules!.durationMinutes,45);assert.equal(proposed.patch.rules!.bufferMinutes,0);assert.deepEqual(proposed.patch.rules!.availability,s.draft!.settings.rules.availability);assert.deepEqual(proposed.defaults,['focus blocks','other preferences']);
 s.progress.dismissedSuggestions=['schedule'];assert.equal(scheduleSuggestion(setupState.parse(JSON.parse(JSON.stringify(s))),'UTC'),null);
 s.progress.dismissedSuggestions=[];assert.ok(scheduleSuggestion(s,'UTC'));
});
test('no-history defaults are proposals and cannot satisfy explicit mode or travel',()=>{
 const s=fixture();s.progress.analysisDecided=true;s.draft!.settings.rules=scheduleSuggestion(s,'UTC')!.patch.rules;
 assert.equal(setupGuide(s).step,'mode');s.draft!.settings.rules!.meetingMode='either';s.draft!.provenance['rules.meetingMode']='assistant';assert.equal(setupGuide(s).step,'answers_review');assert.equal(setupGuide(s).completed.includes('Meeting mode'),false);
 s.draft!.provenance['rules.meetingMode']='host';assert.equal(setupGuide(s).step,'location');
 Object.assign(s.draft!.settings.rules!,{locationPolicy:'per_meeting',travelMode:'PER_TRIP',travelBufferMinutes:15});s.draft!.provenance['rules.locationPolicy']='host';assert.equal(setupGuide(s).step,'transport');
 s.draft!.provenance['rules.travelMode']='host';assert.equal(setupGuide(s).step,'travel_buffer');s.draft!.provenance['rules.travelBufferMinutes']='host';assert.equal(setupGuide(s).step,'review');
});
test('online skips physical questions and current known choices are reused',()=>{
 const s=fixture();s.progress.analysisDecided=true;s.draft!.settings.rules={...scheduleSuggestion(s,'UTC')!.patch.rules,meetingMode:'online'};s.draft!.provenance['rules.meetingMode']='host';
 assert.equal(setupGuide(s).step,'review');assert.equal(setupGuide(s).total,6);
 s.draft!.clarifications=['Which week?','Which time?'];assert.equal(setupGuide(s).question,'Which week?');s.nextAction='refresh_draft';assert.equal(setupGuide(s).step,'refresh');
 s.nextAction='settings_confirmed';assert.equal(setupGuide(s).step,'confirmed');
});

test('current ready Calendar evidence takes precedence over starter suggestions in the guide',()=>{
 const s=fixture();s.progress.analysisDecided=true;s.analysisStatus='ready';assert.equal(setupGuide(s).step,'analysis_review');
 for(const status of ['failed','stale','expired','dismissed'] as const){s.analysisStatus=status;assert.equal(setupGuide(s).step,'schedule');}
});
