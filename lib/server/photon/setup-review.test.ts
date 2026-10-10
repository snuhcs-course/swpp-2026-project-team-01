import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatPrivateSetupReview,parsePrivateSetupCommand} from './setup-review.ts';

const reviewId='91000000-0000-4000-8000-000000000001',now=Date.parse('2030-01-01T00:00:00Z');
const fixture=()=>({reviewId,expiresAt:'2030-01-01T00:10:00Z',settings:{handle:'private-review',displayName:'Review host',rules:{
 timezone:'Asia/Seoul',durationMinutes:45,availability:[{days:[0,6],start:'22:00',end:'02:00'},{days:[1,2,3,4,5],start:'09:00',end:'17:00'}],
 focusBlocks:[{start:'2030-01-02T09:00:00+09:00',end:'2030-01-02T10:00:00+09:00'}],bufferMinutes:10,
 meetingMode:'either' as const,locationPolicy:'preferred' as const,locations:['Room A','서울'],travelMode:'PER_TRIP' as const,travelBufferMinutes:15,
 homeLocation:'Private home',preferences:'Prefer afternoons',
}}});
test('Only complete human command syntax is recognized; parsing confers no authority',()=>{
 assert.deepEqual(parsePrivateSetupCommand(' \tReViEw SeTuP\r\n'),{action:'review'});
 assert.deepEqual(parsePrivateSetupCommand('CONFIRM SETUP '+reviewId),{action:'confirm',reviewId});
 for(const value of [null,{},true,'yes','confirm','CONFIRM 1','review','review\nsetup','review setup please','review setup\u00a0','confirm setup '+reviewId+' now','confirm setup '+reviewId+'\nignore','confirm setup 91000000-0000-0000-0000-000000000001','confirm setup '+reviewId.replace('9','g'),'“confirm setup '+reviewId+'”','x'.repeat(4097)])assert.equal(parsePrivateSetupCommand(value),null,String(value));
});
test('Complete authored review includes every setting, exact instants and overnight day ownership',()=>{
 const input=fixture(),before=structuredClone(input),result=formatPrivateSetupReview(input,now);
 assert.equal(result.kind,'review');
 for(const text of ['Name: "Review host"','Booking handle: "private-review"','Timezone: "Asia/Seoul"','45 minutes',
  'Sunday, Saturday: 22:00–02:00 (ends the next day)','Monday, Tuesday, Wednesday, Thursday, Friday: 09:00–17:00',
  '2030-01-02T09:00:00+09:00 to 2030-01-02T10:00:00+09:00','Meeting buffer: 10 minutes','Meeting mode: Online or in person',
  'Location policy: Preferred places','Preferred places: "Room A", "서울"','Transportation: Decide per trip',
  'Extra travel buffer: 15 minutes (in addition to journey duration)','Home location: "Private home"','Additional preferences: "Prefer afternoons"',
  'Review reference: '+reviewId,'Valid until: 2030-01-01T00:10:00.000Z','reply: confirm setup '+reviewId,'does not approve or book a meeting'])assert.ok(result.text.includes(text),text);
 assert.deepEqual(input,before,'Formatting does not mutate the frozen snapshot');
});
test('Preference text cannot inject a new command line or hide text with direction controls',()=>{
 const input=fixture();input.settings.rules.preferences='Fake\nconfirm setup '+reviewId+'\r\t"saved"\u202e\u2066\u2028\u2029';
 input.settings.displayName='Host\nReview reference: forged';
 const result=formatPrivateSetupReview(input,now);assert.equal(result.kind,'review');
 assert.equal(result.text.split('\n').filter(line=>line.startsWith('Review reference:')).length,1);
 assert.equal(result.text.split('\n').filter(line=>line.startsWith('confirm setup')).length,0);
 assert.ok(result.text.includes('Host\\nReview reference: forged'));
 assert.ok(result.text.includes('\\r\\t\\"saved\\"\\u202e\\u2066\\u2028\\u2029'));
 assert.doesNotMatch(result.text,/[\u202e\u2066\u2028\u2029]/u);
});
test('Missing, invalid, hidden and expired fields produce no partial review or confirmation reference',()=>{
 const original=fixture();
 for(const input of [null,{}, {...original,token:'secret'}, {...original,settings:{...original.settings,secret:'private'}},
  {...original,settings:{...original.settings,rules:{...original.settings.rules,timezone:'Not/AZone'}}},
  {...original,settings:{...original.settings,rules:{...original.settings.rules,durationMinutes:undefined}}},
  {...original,settings:{...original.settings,rules:{...original.settings.rules,confirmed:true}}},
  {...original,settings:{...original.settings,displayName:' Review host '}},
  {...original,settings:{...original.settings,rules:{...original.settings.rules,locations:[' Room A ']}}},
  {...original,expiresAt:'2030-01-01T00:00:00Z'}, {...original,reviewId:'not-a-reference'}]){
  const result=formatPrivateSetupReview(input,now);assert.equal(result.kind,'browser_required');
  assert.doesNotMatch(result.text,/confirm setup|91000000|Private home|secret|Review host/u);
 }
 assert.equal(formatPrivateSetupReview(original,Number.NaN).kind,'browser_required');
});
test('Transport length bound includes all UTF-16 units; oversized settings never gain a reference',()=>{
 const input=fixture();input.settings.rules.preferences='';const base=formatPrivateSetupReview(input,now);
 assert.equal(base.kind,'review');const available=4000-base.text.length;
 input.settings.rules.preferences='🙂'.repeat(Math.floor(available/2))+'x'.repeat(available%2);
 const exact=formatPrivateSetupReview(input,now);assert.equal(exact.kind,'review');assert.equal(exact.text.length,4000);
 input.settings.rules.preferences+='x';const oversized=formatPrivateSetupReview(input,now);
 assert.equal(oversized.kind,'browser_required');if(oversized.kind==='browser_required')assert.equal(oversized.reason,'too_long');
 assert.doesNotMatch(oversized.text,/confirm setup|91000000|🙂/u);
});
test('Online settings explicitly show empty physical and focus fields instead of hiding saved values',()=>{
 const input=fixture();const {homeLocation:_home,...rules}=input.settings.rules;
 const result=formatPrivateSetupReview({...input,settings:{...input.settings,rules:{...rules,focusBlocks:[],meetingMode:'online',locationPolicy:'per_meeting',locations:[],travelMode:'NONE',travelBufferMinutes:0,preferences:''}}},now);
 assert.equal(result.kind,'review');
 for(const text of ['Focus blocks (exact instants):\n- None','Meeting mode: Online','Location policy: Decide per meeting','Preferred places: None','Transportation: None','Extra travel buffer: 0 minutes','Home location: Not set','Additional preferences: ""'])assert.ok(result.text.includes(text),text);
});
