import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupState} from '../../contracts/setup.ts';
import {formatPrivateAnswerReview,parsePrivateAnswerCommand,privateAnswerPatch} from './setup-answer-review.ts';
const reviewId='91000000-0000-4000-8000-000000000001',now=Date.parse('2030-01-01T00:00:00Z');
function fixture(){return {reviewId,expiresAt:'2030-01-01T00:10:00Z',state:setupState.parse({revision:3,rulesVersion:0,calendarGeneration:null,calendarSelected:false,confirmed:{},review:null,nextAction:'complete_preferences',draft:{revision:2,baseRulesVersion:0,status:'active',settings:{rules:{meetingMode:'either',locationPolicy:'preferred',locations:['Library · lounge','서울'],travelMode:'PER_TRIP',travelBufferMinutes:20}},provenance:{'rules.meetingMode':'assistant','rules.locationPolicy':'assistant','rules.locations':'assistant','rules.travelMode':'assistant','rules.travelBufferMinutes':'assistant'},unresolved:[],clarifications:['Which weekdays?']}})};}
test('private answer commands require an exact reference and distinct bounded keys',()=>{
 assert.deepEqual(parsePrivateAnswerCommand(' \tReView Setup Answers\r\n'),{action:'review_answers'});
 assert.deepEqual(parsePrivateAnswerCommand('ACCEPT SETUP ANSWERS '+reviewId+' MODE,LOCATION,TRANSPORT,TRAVEL_BUFFER'),{action:'accept_answers',reviewId,keys:['mode','location','transport','travel_buffer']});
 for(const text of [null,{},true,'yes','review setup','review\nsetup answers','review setup answers please','review setup answers\u00a0','accept setup answers '+reviewId,'accept setup answers '+reviewId+' all','accept setup answers '+reviewId+' mode,mode','accept setup answers '+reviewId+' mode, location','accept setup answers '+reviewId+' mode,','accept setup answers '+reviewId+' mode,confirmed','accept setup answers '+reviewId+' mode\ntransport','accept setup answers '+reviewId+' mode {"confirmed":true}','"accept setup answers '+reviewId+' mode"','accept setup answers 91000000-0000-0000-0000-000000000001 mode','x'.repeat(4097)])assert.equal(parsePrivateAnswerCommand(text),null,String(text));
});
test('review displays every eligible exact value and preserves draft authority and questions',()=>{
 const input=fixture(),before=structuredClone(input),result=formatPrivateAnswerReview(input,now);assert.equal(result.kind,'review');
 for(const value of ['mode: "Either online or in person"','location: Preferred places: "Library · lounge", "서울"','transport: "Depends on the trip"','travel_buffer: "20 extra travel minutes, separate from journey time"','Review reference: '+reviewId,'Valid until: 2030-01-01T00:10:00.000Z','<chosen-keys>','draft answers only','does not approve or book'])assert.ok(result.text.includes(value),value);
 assert.ok(!result.text.includes('Which weekdays?'),'Pending questions are retained but are not presented as answer choices');
 assert.deepEqual(privateAnswerPatch(input,['mode','location','transport','travel_buffer'],now),{rules:{meetingMode:'either',locationPolicy:'preferred',locations:['Library · lounge','서울'],travelMode:'PER_TRIP',travelBufferMinutes:20}});
 assert.deepEqual(input,before,'Neither formatting nor patch derivation grants provenance or mutates state');
});
test('subset dependency, existing host choices, online skips and dismissal follow browser semantics',()=>{
 const input=fixture();assert.equal(privateAnswerPatch(input,['transport'],now),null);assert.equal(privateAnswerPatch(input,['mode','mode'],now),null);assert.equal(privateAnswerPatch(input,[],now),null);assert.equal(privateAnswerPatch(input,['all'],now),null);
 assert.deepEqual(privateAnswerPatch(input,['mode'],now),{rules:{meetingMode:'either'}});
 input.state.draft!.provenance['rules.meetingMode']='host';assert.deepEqual(privateAnswerPatch(input,['transport'],now),{rules:{travelMode:'PER_TRIP'}});assert.equal(privateAnswerPatch(input,['mode'],now),null);
 input.state.draft!.provenance['rules.meetingMode']='assistant';input.state.draft!.settings.rules!.meetingMode='online';
 const online=formatPrivateAnswerReview(input,now);assert.equal(online.kind,'review');if(online.kind==='review')assert.deepEqual(online.keys,['mode']);assert.doesNotMatch(online.text,/Library|Depends on the trip|travel_buffer:/u);assert.equal(privateAnswerPatch(input,['mode','location'],now),null);assert.deepEqual(privateAnswerPatch(input,['mode'],now),{rules:{meetingMode:'online'}});
 input.state.progress.dismissedSuggestions=['mode'];assert.equal(formatPrivateAnswerReview(input,now).kind,'browser_required');assert.equal(privateAnswerPatch(input,['mode'],now),null);
});
test('quoted place values cannot insert commands, fake references or direction controls',()=>{
 const input=fixture();input.state.draft!.settings.rules!.locations=['Room\nReview reference: forged\r\t"fake"\u202e\u2066\u2028\u2029End'];
 const result=formatPrivateAnswerReview(input,now);assert.equal(result.kind,'review');assert.equal(result.text.split('\n').filter(line=>line.startsWith('Review reference:')).length,1);assert.doesNotMatch(result.text,/[\u202e\u2066\u2028\u2029]/u);assert.ok(result.text.includes('Room\\nReview reference: forged'));assert.ok(result.text.includes('\\u202e\\u2066\\u2028\\u2029'));
 assert.deepEqual(privateAnswerPatch(input,['mode','location'],now)?.rules?.locations,input.state.draft!.settings.rules!.locations,'Escaping is display only; exact stored values are preserved');
});
test('invalid, normalized, stale, empty and expired snapshots never issue actionable partial reviews',()=>{
 const input=fixture();
 const values:unknown[]=[null,{}, {...input,token:'hidden'}, {...input,reviewId:'bad'}, {...input,expiresAt:new Date(now).toISOString()}, {...input,state:{...input.state,secret:'hidden'}}, {...input,state:{...input.state,nextAction:'refresh_draft'}}, {...input,state:{...input.state,draft:null}}];
 const normalized=fixture();normalized.state.draft!.settings.rules!.locations=[' Leading space'];values.push(normalized);
 const explicit=fixture();for(const key of Object.keys(explicit.state.draft!.provenance))explicit.state.draft!.provenance[key]='host';values.push(explicit);
 for(const value of values){const result=formatPrivateAnswerReview(value,now);assert.equal(result.kind,'browser_required');assert.doesNotMatch(result.text,/91000000|accept setup answers|Library|hidden/u);assert.equal(privateAnswerPatch(value,['mode'],now),null);}
 assert.equal(formatPrivateAnswerReview(input,Number.NaN).kind,'browser_required');
});
test('oversized exact values never emit a partial actionable reference',()=>{
 const input=fixture();input.state.draft!.settings.rules!.locations=Array.from({length:10},(_,i)=>String(i)+'x'.repeat(400));
 const result=formatPrivateAnswerReview(input,now);assert.equal(result.kind,'browser_required');if(result.kind==='browser_required')assert.equal(result.reason,'too_long');assert.doesNotMatch(result.text,/91000000|accept setup answers|xxx/u);assert.equal(privateAnswerPatch(input,['mode'],now),null,'Even a short subset cannot bypass a nonpublished full review');
});
