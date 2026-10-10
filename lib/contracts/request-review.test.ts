import {test} from 'node:test';
import assert from 'node:assert/strict';
import {conversationTool,detailsProposalInput} from './conversation-tools.ts';
import {requestReviewDecision} from './request-review.ts';
test('request extraction accepts bounded partial drafts and cannot supply decisions or authority',()=>{
 const input={expectedRevision:2,patch:{purpose:'A discussion'},clarifications:[]};
 assert.deepEqual(detailsProposalInput.parse(input),input);
 assert.equal(detailsProposalInput.safeParse({...input,patch:{}}).success,false);
 assert.equal(detailsProposalInput.safeParse({...input,patch:{},clarifications:['Which timezone?']}).success,true);
 for(const field of ['confirmed','requestId','actor','idempotencyKey'])assert.equal(detailsProposalInput.safeParse({...input,[field]:true}).success,false);
 for(const operation of ['details_update','apply','dismiss','host_approve'])assert.equal(conversationTool.safeParse({operation,input}).success,false);
 assert.equal(detailsProposalInput.safeParse({...input,patch:{windows:[{start:'2027-11-07T01:30:00',end:'2027-11-07T02:30:00'}]}}).success,false,'ambiguous local dates require offsets');
 for(const window of [null,[],{start:'2030-06-01T09:00:00Z',end:'2030-06-01T10:00:00Z',hidden:true},{start:'2030-02-30T09:00:00Z',end:'2030-02-30T10:00:00Z'}])assert.equal(detailsProposalInput.safeParse({...input,patch:{windows:[window]}}).success,false,'Malformed legacy review window remains invalid');
 assert.equal(requestReviewDecision.safeParse({reviewId:'00000000-0000-4000-8000-000000000001',expectedRevision:2,confirmed:false,idempotencyKey:'00000000-0000-4000-8000-000000000002'}).success,false);
});
