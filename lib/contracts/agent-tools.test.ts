import test from 'node:test';
import {z} from 'zod';
import assert from 'node:assert/strict';
import {agentTools,agentToolsForActor,agentToolCommand,agentToolScope} from './agent-tools.ts';
const requestId='10000000-0000-4000-8000-000000000001',idempotencyKey='20000000-0000-4000-8000-000000000001';

test('Requester discovery excludes host setup and private notes; decision permission stays distinct',()=>{
 assert.deepEqual(agentToolsForActor('guest').map(t=>t.name),['fmat_read_conversation','fmat_get_booking_status','fmat_review_connections','fmat_get_scheduling','fmat_get_availability','fmat_propose_availability','fmat_get_request','fmat_propose_request_details','fmat_review_decision']);
 assert.ok(!agentToolsForActor('host').some(t=>t.name==='fmat_propose_request_details'));
 const decision=agentTools.find(t=>t.name==='fmat_review_decision')!;
 assert.equal(agentToolScope(decision,'host'),'host:decide');assert.equal(agentToolScope(decision,'guest'),'request:decide');
 assert.deepEqual(agentToolCommand(decision.name,{requestId,input:{}}),{operation:'decision_review',requestId,input:{}});
 assert.match(decision.description,/No approval, agreement, decline or booking/);
});

test('Catalog mutations preserve revisions, changes and caller retry keys without manufacturing confirmation',()=>{
 const input={requestId,input:{expectedRevision:4,patch:{purpose:'Review the proposal'},clarifications:[]},idempotencyKey};
 const actual=agentToolCommand('fmat_propose_request_details',input);
 assert.deepEqual(actual,{...input,operation:'details_propose'});
 const note={requestId,input:{expectedRevision:4,text:'Private preference'},idempotencyKey};
 assert.deepEqual(agentToolCommand('fmat_save_private_note',note),{...note,operation:'private_note_save'});
 for(const tool of agentTools.filter(t=>!t.readOnly)){
  assert.match(tool.description,/identical input/);assert.match(tool.description,/conflicts/);
  assert.throws(()=>agentToolCommand(tool.name,{requestId,input:{}}));
 }
 assert.throws(()=>agentToolCommand('fmat_propose_request_details',{...input,idempotencyKey:'invalid'}));
 assert.throws(()=>agentToolCommand('fmat_propose_request_details',{...input,input:{...input.input,expectedRevision:-1}}));
});

test('Tool input cannot inject identities, credentials, operation selection or human approval',()=>{
 const valid={requestId,input:{}};
 for(const field of ['actor','credential','token','operation','confirmed','approved','agentGrantId'])
  assert.throws(()=>agentToolCommand('fmat_get_request',{...valid,[field]:'forged'}));
 assert.throws(()=>agentToolCommand('fmat_get_request',{...valid,input:{confirmed:true}}));
 assert.throws(()=>agentToolCommand('fmat_get_request',{input:{}}));
 assert.throws(()=>agentToolCommand('fmat_approve_request',valid));
 assert.throws(()=>agentToolCommand('__proto__',valid));
 assert.throws(()=>agentToolCommand('fmat_get_setup',{input:{},requestId}));
});


test('Tool discovery produces strict JSON schemas and setup keeps domain validation',()=>{
 for(const tool of agentTools){
  const schema=z.toJSONSchema(tool.inputSchema,{io:'input'});
  assert.equal(schema.type,'object');assert.equal(schema.additionalProperties,false);
  assert.ok(!('operation' in (schema.properties??{})));
 }
 for(const name of ['fmat_get_setup','fmat_get_setup_analysis'])assert.deepEqual(agentToolCommand(name,{input:{}}).input,{});
 const draft={input:{expectedRevision:0,patch:{handle:'valid-host'},unresolved:[]},idempotencyKey};
 assert.deepEqual(agentToolCommand('fmat_draft_setup',draft),{...draft,operation:'setup_draft'});
 assert.throws(()=>agentToolCommand('fmat_draft_setup',{...draft,input:{...draft.input,patch:{handle:'mcp'}}}));
 assert.throws(()=>agentToolCommand('fmat_propose_request_details',{requestId,idempotencyKey,input:{expectedRevision:0,patch:{},clarifications:[]}}));
});


test('Host request discovery bounds filters and requires complete cursors without accepting identity overrides',()=>{
 const tool=agentToolsForActor('host').find(t=>t.name==='fmat_list_requests')!;
 assert.equal(agentToolScope(tool,'host'),'host:read');
 assert.deepEqual(agentToolCommand(tool.name,{input:{}}),{operation:'requests_list',input:{search:'',status:'active'}});
 for(const input of [{search:'x'.repeat(201)},{status:'unknown'},{beforeId:requestId},{beforeCreatedAt:'2030-01-01T00:00:00Z'},{hostId:requestId}])assert.throws(()=>agentToolCommand(tool.name,{input}));
 assert.throws(()=>agentToolCommand(tool.name,{requestId,input:{}}));
});

test('availability proposals validate bounded windows and refuse human confirmation claims',()=>{
 const input={expectedRevision:1,timezone:'Asia/Seoul',windows:[{start:'2030-01-01T09:00:00+09:00',end:'2030-01-01T10:00:00+09:00'}]};
 assert.equal(agentToolCommand('fmat_propose_availability',{requestId,input,idempotencyKey}).operation,'availability_propose');
 for(const patch of [{confirmed:true},{timezone:'not-a-zone'},{windows:[]},{windows:[{start:input.windows[0].end,end:input.windows[0].start}]}])
  assert.throws(()=>agentToolCommand('fmat_propose_availability',{requestId,input:{...input,...patch},idempotencyKey}));
 assert.ok(!agentToolsForActor('host').some(t=>t.name==='fmat_get_availability'||t.name==='fmat_propose_availability'));
});
