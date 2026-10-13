import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupState} from './setup.ts';
import {draftAnswers,chooseDraftAnswers} from './setup-answers.ts';
import {setupGuide,scheduleSuggestion} from './setup-guide.ts';
function fixture(){const s=setupState.parse({revision:3,rulesVersion:0,calendarGeneration:'80000000-0000-4000-8000-000000000001',calendarSelected:true,confirmed:{},draft:{revision:2,baseRulesVersion:0,settings:{handle:'example',displayName:'Example'},provenance:{},unresolved:[],clarifications:[],status:'active'},review:null,nextAction:'complete_preferences',progress:{analysisDecided:true,dismissedSuggestions:[]}});s.draft!.settings.rules={...scheduleSuggestion(s,'UTC')!.patch.rules,meetingMode:'either',locationPolicy:'preferred',locations:['Library lounge'],travelMode:'TRANSIT',travelBufferMinutes:20};for(const key of ['meetingMode','locationPolicy','locations','travelMode','travelBufferMinutes'])s.draft!.provenance['rules.'+key]='assistant';return s;}
test('extracted answers are reused for review but confer no host authority',()=>{
 const s=fixture(),before=structuredClone(s),answers=draftAnswers(s);assert.equal(setupGuide(s).step,'answers_review');assert.deepEqual(answers.map(a=>a.key),['mode','location','transport','travel_buffer']);assert.equal(chooseDraftAnswers(answers,[]),null);assert.equal(chooseDraftAnswers(answers,['location']),null);
 const patch=chooseDraftAnswers(answers,['mode','location','transport','travel_buffer'])!;assert.deepEqual(patch.rules,{meetingMode:'either',locationPolicy:'preferred',locations:['Library lounge'],travelMode:'TRANSIT',travelBufferMinutes:20});assert.deepEqual(s,before);assert.equal(s.review,null);
});
test('accepted answers and missing values are not guessed or requested again',()=>{
 const s=fixture();s.draft!.provenance['rules.meetingMode']='host';s.draft!.provenance['rules.locationPolicy']='host';s.draft!.provenance['rules.locations']='host';assert.deepEqual(draftAnswers(s).map(a=>a.key),['transport','travel_buffer']);delete s.draft!.settings.rules!.travelMode;assert.deepEqual(draftAnswers(s).map(a=>a.key),['travel_buffer']);s.draft!.provenance['rules.travelBufferMinutes']='host';assert.deepEqual(draftAnswers(s),[]);assert.equal(setupGuide(s).step,'transport');
});
test('online, dismissal and stale state cannot present physical guesses as choices',()=>{
 const s=fixture();s.draft!.settings.rules!.meetingMode='online';assert.deepEqual(draftAnswers(s).map(a=>a.key),['mode']);s.progress.dismissedSuggestions=['mode'];assert.deepEqual(draftAnswers(s),[]);assert.equal(setupGuide(s).step,'mode');s.progress.dismissedSuggestions=[];s.nextAction='refresh_draft';assert.deepEqual(draftAnswers(s),[]);assert.equal(setupGuide(s).step,'refresh');
});
test('partial acceptance includes only selected current values and rejects obsolete choices',()=>{
 const s=fixture(),answers=draftAnswers(s);assert.deepEqual(chooseDraftAnswers(answers,['mode']),{rules:{meetingMode:'either'}});assert.equal(chooseDraftAnswers(answers.filter(a=>a.key!=='location'),['mode','location']),null);s.draft!.clarifications=['Which station?'];const chosen=chooseDraftAnswers(answers,['mode','transport']);assert.deepEqual(chosen,{rules:{meetingMode:'either',travelMode:'TRANSIT'}});assert.deepEqual(s.draft!.clarifications,['Which station?']);
});
