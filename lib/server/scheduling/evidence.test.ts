import {test} from 'node:test';
import assert from 'node:assert/strict';
import {candidateEvidence,evidenceReceipt} from './evidence.ts';
const base={candidate:{start:'2030-01-01T10:00:00.000000001Z',end:'2030-01-01T10:30:00.000000001Z'},interval:'conflict',contextFingerprint:null,travel:null,preferences:'pending',complete:false};
test('Evidence retains nanosecond input and never accepts approval, credentials or completion claims',()=>{
 assert.deepEqual(candidateEvidence.parse(base),base);
 for(const patch of [{complete:true},{preferences:'approved'},{accessToken:'secret'},{candidate:{...base.candidate,hostApproved:true}}])assert.equal(candidateEvidence.safeParse({...base,...patch}).success,false);
});
test('Travel evidence requires distinct directions, consistent aggregate status and known result fields',()=>{
 const legs=['inbound','outbound'].map(direction=>({direction,contextFingerprint:'a'.repeat(64),status:'clarification',reason:'unknown_neighbor'}));
 const value={...base,interval:'fits',contextFingerprint:'a'.repeat(64),travel:{status:'clarification',legs}};assert.equal(candidateEvidence.safeParse(value).success,true);
 for(const travel of [{status:'fits',legs},{status:'clarification',legs:[legs[0],legs[0]]},{status:'clarification',legs:[{...legs[0],secret:'private'},legs[1]]}])assert.equal(candidateEvidence.safeParse({...value,travel}).success,false);
 assert.equal(candidateEvidence.safeParse({...value,interval:'conflict'}).success,false);assert.equal(candidateEvidence.safeParse({...value,contextFingerprint:null}).success,false);
});
test('Evidence receipts expose only current assessment metadata and remain incomplete',()=>{
 const value={evaluationId:'00000000-0000-4000-8000-000000000001',requestId:'00000000-0000-4000-8000-000000000002',revision:1,rulesVersion:1,status:'checks_passed',expiresAt:'2030-01-01T10:00:00Z',complete:false};assert.deepEqual(evidenceReceipt.parse(value),value);
 for(const patch of [{evidence:base},{privateContext:{}},{complete:true},{status:'bookable'}])assert.equal(evidenceReceipt.safeParse({...value,...patch}).success,false);
});
