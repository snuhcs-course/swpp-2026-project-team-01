import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../database/client.ts';
import { ConversationTools } from './tool-execution.ts';
import { ApplicationError } from '../errors.ts';

const auth = {
  authenticator: 'fmat-conversation', principalType: 'user',
  principalId: '81000000-0000-4000-8000-000000000001',
  attributes: { conversationId: '82000000-0000-4000-8000-000000000001', messageId: '83000000-0000-4000-8000-000000000001' },
};
const call = { sessionId: 'runtime-session', callId: 'durable-call-1' };
const command = { operation: 'private_note_save', input: { expectedRevision: 1, text: 'Private preference' } };
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' };
const errorCode = (code: string) => (error: unknown) => error instanceof ApplicationError && error.code === code;

test('tool authority comes only from current application context and rejects model-controlled authority or decisions', async () => {
  let requests = 0;
  const tools = new ConversationTools(new Database(env, async () => { requests++; return Response.json({}); }));
  for (const current of [null, {}, { ...auth, authenticator: 'vercel-oidc' }, { ...auth, principalType: 'runtime' }]) {
    await assert.rejects(tools.execute(current, call, command), errorCode('UNAUTHORIZED'));
  }
  for (const input of [
    { ...command.input, actor: { kind: 'host' } },
    { ...command.input, requestId: auth.principalId },
    { ...command.input, idempotencyKey: 'model-selected' },
    { ...command.input, grantId: auth.principalId },
  ]) await assert.rejects(tools.execute(auth, call, { ...command, input }), errorCode('INVALID_INPUT'));
  for (const operation of ['host_approve', 'requester_agree', 'setup_save', 'booking_dispatch', 'jobs_claim']) {
    await assert.rejects(tools.execute(auth, call, { operation, input: {} }), errorCode('INVALID_INPUT'));
  }
  assert.equal(requests, 0);
});

test('durable call retry uses the same server-derived key and rechecks authority in every RPC', async () => {
  const bodies: Record<string, any>[] = [];
  const tools = new ConversationTools(new Database(env, async (_url, init) => {
    bodies.push(JSON.parse(init!.body as string)); return Response.json({ revision: 2 });
  }));
  await tools.execute(auth, call, command);
  await tools.execute(auth, call, command);
  await tools.execute(auth, call, { ...command, input: { ...command.input, text: 'Changed retry' } });
  await tools.execute(auth, { ...call, callId: 'durable-call-2' }, command);
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(bodies[0].p_input.idempotencyKey, bodies[2].p_input.idempotencyKey, 'changed input must conflict under the same key');
  assert.equal(bodies[0].p_input.idempotencyKey, bodies[3].p_input.idempotencyKey, 'regenerated model call cannot repeat the message mutation');
  await tools.execute({ ...auth, attributes: { ...auth.attributes, messageId: '83000000-0000-4000-8000-000000000002' } }, call, command);
  assert.notEqual(bodies[0].p_input.idempotencyKey, bodies[4].p_input.idempotencyKey);
  assert.equal(bodies[0].p_grant_id, auth.principalId);
  assert.equal(bodies[0].p_conversation_id, auth.attributes.conversationId);
  assert.equal('p_actor' in bodies[0], false);
  assert.equal('requestId' in bodies[0].p_input, false);
});

test('revoked execution returns a safe error without fallback to an unchecked domain RPC', async () => {
  let requests = 0;
  const tools = new ConversationTools(new Database(env, async () => {
    requests++; return Response.json({ message: 'UNAUTHORIZED' }, { status: 400 });
  }));
  await assert.rejects(tools.execute(auth, call, command), errorCode('UNAUTHORIZED'));
  assert.equal(requests, 1);
});

test('authorized setup read gives model the same focused guide and remembered dismissals',async()=>{
 const state={revision:2,rulesVersion:0,calendarGeneration:'80000000-0000-4000-8000-000000000001',calendarSelected:true,confirmed:{},draft:null,review:null,nextAction:'complete_preferences',progress:{analysisDecided:true,dismissedSuggestions:['schedule']}};
 const tools=new ConversationTools(new Database(env,async()=>Response.json(state)));
 const result=await tools.execute(auth,call,{operation:'setup_read',input:{}}) as typeof state&{guide:{step:string}};
 assert.equal(result.guide.step,'profile');assert.deepEqual(result.progress,state.progress);
 await assert.rejects(tools.execute(auth,call,{operation:'setup_progress',input:{choice:'skip_analysis'}}),errorCode('INVALID_INPUT'));
});

test('setup link reporting rechecks current private authority and revision after public permission I/O',async()=>{
 const state={revision:2,rulesVersion:1,calendarGeneration:'80000000-0000-4000-8000-000000000001',calendarSelected:true,confirmed:{handle:'verified-host'},draft:null,review:null,nextAction:'settings_confirmed'};
 const current={...env,APP_ORIGIN:'https://release.findmeatime.com'},readiness={operation:'setup_readiness',input:{}};
 let revoked=false,stale=false,missing=false,failure=false,changed=()=>{},reads=0,profiles=0;
 const db=new Database(env,async(_url,init)=>{reads++;const body=JSON.parse(String(init?.body));assert.equal(body.p_operation,'setup_read');assert.deepEqual(body.p_input,{});assert.equal(body.p_grant_id,auth.principalId);return revoked?Response.json({message:'UNAUTHORIZED'},{status:400}):Response.json({...state,revision:stale?3:2});});
 const tools=new ConversationTools(db,current,{async profile(handle){profiles++;assert.equal(handle,'verified-host');changed();if(failure)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);if(missing)throw new ApplicationError('NOT_FOUND',404);return {handle,displayName:'Verified host',timezone:'Asia/Seoul',durationMinutes:30};}});
 assert.deepEqual(await tools.execute(auth,call,readiness),{ready:true,bookingUrl:current.APP_ORIGIN+'/verified-host',agentInstructionsUrl:current.APP_ORIGIN+'/verified-host/SKILL.md'});assert.equal(reads,2);
 missing=true;assert.deepEqual(await tools.execute(auth,call,readiness),{ready:false,reason:'calendar'});missing=false;
 failure=true;await assert.rejects(tools.execute(auth,call,readiness),errorCode('PROVIDER_UNAVAILABLE'));failure=false;
 changed=()=>{stale=true;};await assert.rejects(tools.execute(auth,call,readiness),errorCode('STALE_REVISION'));stale=false;
 changed=()=>{revoked=true;};await assert.rejects(tools.execute(auth,call,readiness),errorCode('UNAUTHORIZED'));revoked=false;changed=()=>{};
 state.nextAction='complete_preferences';const calls=profiles;assert.deepEqual(await tools.execute(auth,call,readiness),{ready:false,reason:'setup'});assert.equal(profiles,calls);
 await assert.rejects(tools.execute(auth,call,{...readiness,input:{handle:'another-host'}}),errorCode('INVALID_INPUT'));
});

test('setup suggestions reject invalid time data and injected authority before any RPC',async()=>{
 let requests=0;
 const tools=new ConversationTools(new Database(env,async()=>{requests++;return Response.json({revision:2});}));
 const patch=(rules:unknown)=>({operation:'setup_draft',input:{expectedRevision:1,patch:{rules},unresolved:[]}});
 for(const rules of [
  {timezone:'fake/timezone'},{timezone:'+09:00'},
  {availability:[{days:[1],start:'25:00',end:'26:00'}]},
  {focusBlocks:[{start:'2030-02-30T09:00:00Z',end:'2030-02-30T10:00:00Z'}]},
  {focusBlocks:[{start:'2030-06-01T09:00',end:'2030-06-01T10:00'}]},
  {focusBlocks:[{start:'2030-06-01T10:00:00Z',end:'2030-06-01T09:00:00Z'}]},
  {bufferMinutes:-1},{timezone:'Asia/Seoul',accessToken:'private-token'},
  {approved:true},{command:'calendar.insert'},
 ])await assert.rejects(tools.execute(auth,call,patch(rules)),errorCode('INVALID_INPUT'));
 assert.equal(requests,0);
 for(const timezone of ['Asia/Seoul','America/New_York','UTC']){
  await tools.execute(auth,call,patch({timezone,bufferMinutes:10}));
 }
 assert.equal(requests,3,'Valid partial preferences remain advisory draft operations');
});

test('setup model context projects server state without injected credentials or identity',async()=>{
 const state={revision:2,rulesVersion:0,calendarGeneration:null,calendarSelected:false,confirmed:{handle:'example',rules:{timezone:'Asia/Seoul'},accessToken:'private-confirmed'},draft:null,review:null,nextAction:'connect_calendar',hostId:'private-host',credential:'private-credential',accessToken:'private-token'};
 const tools=new ConversationTools(new Database(env,async()=>Response.json(state)));
 const result=await tools.execute(auth,call,{operation:'setup_read',input:{}});
 assert.doesNotMatch(JSON.stringify(result),/private-confirmed|private-host|private-credential|private-token|sb_secret_test/);
 assert.equal((result as typeof state).confirmed.rules.timezone,'Asia/Seoul');
 state.confirmed.rules={timezone:'Asia/Seoul',accessToken:'private-nested'} as typeof state.confirmed.rules;
 await assert.rejects(tools.execute(auth,call,{operation:'setup_read',input:{}}),'Unknown rule fields fail closed instead of reaching the model');
});

test('request conversation reads and mutations minimize nested contact identity without changing source or scheduling fields',async()=>{
 const details={requesterName:'Private name sentinel',requesterEmail:'private-email-sentinel@example.test',purpose:'Discuss research',durationMinutes:30,windows:[{start:'2030-06-01T09:00:00Z',end:'2030-06-01T10:00:00Z'}]};
 const source={revision:2,status:'gathering',details,proposal:{...details,version:1},review:{patch:{requesterName:'',purpose:'New purpose'},details,status:'pending'},privateNotes:'Keep this authorized note',nested:[{requesterEmail:'nested-sentinel@example.test',requesterEmailProvided:false}]};
 const original=structuredClone(source),requests:Record<string,any>[]=[];
 const tools=new ConversationTools(new Database(env,async(_url,init)=>{requests.push(JSON.parse(String(init?.body)));return Response.json(source);}));
 for(const operation of ['request_read','details_propose','private_note_save']){
  const input=operation==='request_read'?{}:operation==='details_propose'?{expectedRevision:1,patch:{purpose:'Review'},clarifications:[]}:{expectedRevision:1,text:'Note'};
  const result=await tools.execute(auth,call,{operation,input}) as Record<string,any>;
  assert.doesNotMatch(JSON.stringify(result),/Private name sentinel|private-email-sentinel|nested-sentinel/);
  assert.deepEqual(result.details,{purpose:details.purpose,durationMinutes:30,windows:details.windows,requesterNameProvided:true,requesterEmailProvided:true});
  assert.equal(result.proposal.version,1);assert.equal(result.proposal.requesterEmailProvided,true);
  assert.deepEqual(result.review.patch,{purpose:'New purpose',requesterNameProvided:false});
  assert.equal(result.review.details.requesterEmailProvided,true);assert.equal(result.review.status,'pending');
  assert.equal(result.nested[0].requesterEmailProvided,true,'Derived presence wins over colliding source flags');
  assert.equal(result.privateNotes,source.privateNotes,'Existing audience authorization still owns private discussion');
  assert.deepEqual(source,original);
 }
 assert.equal(requests.length,3);
});

test('malformed structured contact values fail safely rather than entering model context',async()=>{
 for(const requesterEmail of [null,123,{secret:'private-invalid-sentinel'},['private-invalid-sentinel']]){
  const tools=new ConversationTools(new Database(env,async()=>Response.json({review:{details:{requesterEmail}}})));
  await assert.rejects(tools.execute(auth,call,{operation:'details_propose',input:{expectedRevision:1,patch:{purpose:'Review'},clarifications:[]}}),error=>{
   assert(error instanceof ApplicationError);assert.equal(error.code,'INTERNAL_ERROR');assert.doesNotMatch(String(error),/private-invalid-sentinel/);return true;
  });
 }
});

test('contact projection preserves missing fields and free text without mutating nested input',async()=>{
 const {requestModelContext}=await import('./request-model-context.ts');
 const source={details:{purpose:'Contact me at explicitly-written@example.test',requesterName:'  ',requesterNameProvided:true},review:{patch:{purpose:'Only a purpose change'}},messages:[{text:'A user explicitly supplied contact text'}],other:null};
 const original=structuredClone(source),result=requestModelContext(source) as typeof source;
 assert.deepEqual(source,original);assert.notEqual(result,source);assert.notEqual(result.details,source.details);
 assert.deepEqual(result.details,{purpose:source.details.purpose,requesterNameProvided:false});
 assert.deepEqual(result.review,source.review);assert.deepEqual(result.messages,source.messages);
 assert.equal(Object.hasOwn(result.review.patch,'requesterEmailProvided'),false);
 let nested:unknown={requesterEmail:'deep-contact@example.test'};for(let i=0;i<34;i++)nested={child:nested};
 assert.throws(()=>requestModelContext(nested),errorCode('INTERNAL_ERROR'));
});

test('model extraction requires intent and rejects uncertain patches before RPC while preserving valid draft retries',async()=>{
 const bodies:Record<string,any>[]=[];
 const tools=new ConversationTools(new Database(env,async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return Response.json({review:{status:'pending'}});}));
 const draft={expectedRevision:1,patch:{purpose:'Discuss research'},clarifications:[]};
 for(const input of [draft,{...draft,intent:'approve'},{...draft,intent:'question'},{...draft,intent:'unknown'},
  {...draft,intent:'question',patch:{requesterEmail:'private@example.test'},clarifications:['Which address?']},
  {...draft,intent:'unknown',patch:{windows:[]},clarifications:['Which time?']},
  {...draft,intent:'question',patch:{}},
 ])await assert.rejects(tools.proposeRequestExtraction(auth,call,input),errorCode('INVALID_INPUT'));
 assert.equal(bodies.length,0);
 for(const intent of ['details','availability'])await tools.proposeRequestExtraction(auth,call,{...draft,intent});
 assert.deepEqual(bodies[0],bodies[1],'Intent labels do not change a logical domain draft or its retry identity');
 assert.equal(Object.hasOwn(bodies[0].p_input,'intent'),false);
 assert.deepEqual(bodies[0].p_input.patch,draft.patch);
 for(const intent of ['question','unknown'])await tools.proposeRequestExtraction(auth,call,{...draft,intent,patch:{},clarifications:['Which timezone?']});
 assert.deepEqual(bodies[2],bodies[3]);assert.deepEqual(bodies[2].p_input.patch,{});assert.deepEqual(bodies[2].p_input.clarifications,['Which timezone?']);
 assert.equal(bodies.length,4);
});
