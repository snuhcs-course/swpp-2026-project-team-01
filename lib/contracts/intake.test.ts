import {test} from 'node:test';
import assert from 'node:assert/strict';
import {intakeDetails} from './intake.ts';
test('public intake preserves partial/bilingual intent and rejects private fields and invalid timezones',()=>{
 const input={requesterName:' 요청자 ',requesterEmail:' Guest@Example.test ',purpose:'회의 계획',timezone:'Asia/Seoul',durationMinutes:30};
 assert.deepEqual(intakeDetails.parse(input),{...input,requesterName:'요청자',requesterEmail:'guest@example.test',windows:[]});
 for(const extra of [{hostApproved:true},{actor:{kind:'host'}},{timezone:'wrong-zone'},{durationMinutes:0},{windows:[{start:'2026-11-01T01:30:00',end:'2026-11-01T02:30:00'}]},{mode:'online',location:'javascript:alert(1)'}])assert.equal(intakeDetails.safeParse({...input,...extra}).success,false);
});
