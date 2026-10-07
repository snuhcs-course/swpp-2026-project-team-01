import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePreferences} from './preferences.ts';
import {confirmPreference,preferenceChoice,type VerifiedPreferenceDecision} from '../../contracts/preference-decision.ts';
const input=()=>({basis:'a'.repeat(64),candidate:{start:'2030-01-01T10:00:00Z',end:'2030-01-01T10:30:00Z'},details:{mode:'in_person',location:'Venue A'},rules:{meetingMode:'in_person' as const,locationPolicy:'preferred' as const,locations:['Venue A'],preferences:''}});
const id='00000000-0000-4000-8000-000000000001';
test('Configured mode and exact preferred location are deterministic; prose remains unresolved',()=>{
 assert.equal(evaluatePreferences(input()).status,'satisfied');
 const value=input();value.rules.preferences='Prefer short morning meetings';assert.equal(evaluatePreferences(value).checks[2].status,'unresolved');
 value.details.location='Venue A branch';assert.equal(evaluatePreferences(value).checks[1].status,'unresolved');
 value.details.mode='online';assert.equal(evaluatePreferences(value).checks[0].status,'unresolved');assert.equal(evaluatePreferences(value).checks[1].status,'satisfied');
});
test('Current explicit host decisions satisfy only the named preference and exact context',()=>{
 const value=input();value.rules.preferences='Host-only priority';const first=evaluatePreferences(value);
 const decision:VerifiedPreferenceDecision={id,key:'additional',classification:'preference',decision:'exception',reason:'Private reason',contextFingerprint:first.contextFingerprint};
 const result=evaluatePreferences(value,[decision]);assert.equal(result.status,'satisfied');assert.deepEqual(result.checks[2],{key:'additional',status:'exception',decisionId:id});assert.ok(!JSON.stringify(result).includes('Private reason'));
 for(const mutate of [(v:ReturnType<typeof input>)=>{v.basis='b'.repeat(64);},(v:ReturnType<typeof input>)=>{v.candidate.end='2030-01-01T10:31:00Z';},(v:ReturnType<typeof input>)=>{v.rules.preferences='Changed';}]){const changed=structuredClone(value);mutate(changed);assert.equal(evaluatePreferences(changed,[decision]).checks[2].status,'unresolved');}
 assert.equal(evaluatePreferences(value,[{...decision,decision:'satisfied'}]).checks[2].status,'satisfied');
});
test('Preference decisions cannot name hard rules, fabricate classification or fill missing details',()=>{
 for(const key of ['busy','focus','duration','buffer','travel'])assert.equal(preferenceChoice.safeParse({key,classification:'preference',decision:'exception',reason:'No'}).success,false);
 assert.equal(preferenceChoice.safeParse({key:'additional',classification:'hard',decision:'exception',reason:'No'}).success,false);
 assert.equal(preferenceChoice.safeParse({key:'meeting_mode',classification:'preference',decision:'satisfied',reason:'No'}).success,false);
 const value=input();value.details.location='';const first=evaluatePreferences(value);assert.equal(evaluatePreferences(value,[{id,key:'location',classification:'preference',decision:'exception',reason:'Cannot supply missing venue',contextFingerprint:first.contextFingerprint}]).checks[1].status,'unresolved');
 assert.equal(confirmPreference.safeParse({requestId:id,revision:1,evaluationId:id,idempotencyKey:id,confirmed:false,choice:{key:'additional',classification:'preference',decision:'exception',reason:'No'}}).success,false);
});
