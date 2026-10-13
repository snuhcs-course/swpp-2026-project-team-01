import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {schedulingEvaluate,schedulingSelection,schedulingAgreement,schedulingState} from './scheduling.ts';
test('Publication and explicit decisions accept IDs and revisions, never client feasibility or synthetic consent',()=>{
 const target={requestId:randomUUID(),revision:1},choice={...target,publicationId:randomUUID(),candidateId:randomUUID(),confirmed:true,idempotencyKey:randomUUID()},agreement={...target,proposalVersion:1,confirmed:true,idempotencyKey:randomUUID()};
 assert.ok(schedulingSelection.safeParse(choice).success);assert.ok(schedulingAgreement.safeParse(agreement).success);
 for(const extra of [{validatedEvidence:{}},{hostApproved:true},{actor:{kind:'host'}},{start:'2030-01-01T10:00:00Z'},{confirmed:false}])assert.equal(schedulingSelection.safeParse({...choice,...extra}).success,false);
 assert.equal(schedulingAgreement.safeParse({...agreement,confirmed:false}).success,false);assert.equal(schedulingAgreement.safeParse({...agreement,proposalVersion:0}).success,false);
 assert.equal(schedulingEvaluate.safeParse({...target,candidates:[]}).success,false);
 assert.equal(schedulingState.safeParse({requestId:target.requestId,revision:1,status:'negotiating',detailsComplete:true,availability:'clarification',publication:null,proposal:null,requesterAgreed:false,canAgree:false,privateDiagnostics:[]}).success,false);
});
