import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
import {generateKeyPair,exportJWK} from 'jose';
import {Database} from '../../lib/server/database/client.ts';
import {AgentCredentials} from '../../lib/server/oauth/credentials.ts';
import {AgentOAuthTokens,agentTokenGrant} from '../../lib/server/oauth/tokens.ts';
import {AgentOperations} from '../../lib/server/oauth/operations.ts';
import {AgentConversations} from '../../lib/server/oauth/conversations.ts';
import {agentHistory} from '../../lib/server/oauth/history.ts';
import {LocalSql} from './local-sql.ts';
const q=(v:string)=>`'${v.replaceAll("'","''")}'`,hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const scope='request:decide request:intake request:read request:write',resource='https://release.findmeatime.com/mcp';

test('bound intake inherits requester operations and current authority without promoting its token subject',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const pair=await generateKeyPair('ES256',{extractable:true});
 const env={APP_ORIGIN:'https://release.findmeatime.com',SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),AGENT_OAUTH_SIGNING_JWK:JSON.stringify({...await exportJWK(pair.privateKey),kid:'intake-operations'})};
 const db=new LocalSql(),lock=new LocalSql(),wait=new LocalSql(),host=randomUUID(),invite=randomUUID(),client=randomUUID(),name='bound-'+randomUUID();
 const database=new Database(env),tokens=new AgentOAuthTokens(env),credentials=new AgentCredentials(env,database),operations=new AgentOperations(database),conversations=new AgentConversations(database);
 async function fixture(bound=true){
  const id={request:randomUUID(),intake:randomUUID(),grant:randomUUID(),authorization:randomUUID(),conversation:randomUUID()};
  await db.query(`insert into fmat.oauth_authorizations(id,client_id,resource,redirect_uri,scope,code_challenge,state,browser_hash,created_at,expires_at,decision,decided_at) values(${q(id.authorization)},${q(client)},${q(resource)},'https://client.example/cb',${q(scope)},repeat('A',43),'s',repeat('b',64),statement_timestamp(),statement_timestamp()+interval '10 minutes','grant',statement_timestamp());insert into fmat.oauth_grants(id,authorization_id,client_id,resource,scope,actor_kind,actor_id,host_id,created_at,expires_at) values(${q(id.grant)},${q(id.authorization)},${q(client)},${q(resource)},${q(scope)},'intake',${q(id.intake)},${q(host)},clock_timestamp(),clock_timestamp()+interval '1 day');`);
  if(bound)await db.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at,private_notes) values(${q(id.request)},${q(host)},'{"requesterName":"Requester","requesterEmail":"requester@example.test","purpose":"Meet","timezone":"UTC","durationMinutes":30,"windows":[],"mode":"","location":""}',${q(hash(id.request))},clock_timestamp()+interval '1 day','PRIVATE HOST NOTE');insert into fmat.conversation_scopes(id,host_id,request_id,audience,runtime_session_id) values(${q(id.conversation)},${q(host)},${q(id.request)},'request_shared',${q('runtime-'+id.conversation)});`);
  await db.query(`insert into fmat.oauth_intakes(id,authorization_id,host_id,reserved_request_id,browser_hash,created_at,grant_id,granted_at,create_expires_at,request_id,token_hash,bound_at) values(${q(id.intake)},${q(id.authorization)},${q(host)},${q(id.request)},repeat('b',64),statement_timestamp(),${q(id.grant)},statement_timestamp(),statement_timestamp()+interval '15 minutes',${bound?q(id.request):'null'},${bound?q(hash(id.request)):'null'},${bound?'statement_timestamp()':'null'});`);
  const grant=agentTokenGrant.parse(await database.rpc('fmat_oauth_grant_check',{p_id:id.grant,p_client_id:client,p_resource:resource,p_actor_kind:'intake',p_actor_id:id.intake,p_scope:scope}));
  const credential=await credentials.verify(await tokens.issue(grant,async()=>{}));
  return {...id,grantProjection:grant,credential};
 }
 type Fixture=Awaited<ReturnType<typeof fixture>>;
 const params=(f:Fixture,operation:string,request:string|null=f.request,input:unknown={},key:string|null=null)=>({p_grant_id:f.grant,p_client_id:client,p_resource:resource,p_actor_kind:'intake',p_actor_id:f.intake,p_scope:scope,p_token_expires_at:f.credential.claims.exp,p_operation:operation,p_request_id:request,p_input:input,p_idempotency_key:key});
 const raw=(f:Fixture,operation:string,request:string|null=f.request,input:unknown={},key:string|null=null)=>database.rpc('fmat_agent_operation',params(f,operation,request,input,key));
 async function blocked(pending:Promise<string>){
  let done=false;void pending.finally(()=>{done=true;}).catch(()=>{});
  for(let n=0;n<60;n++){if(done){await pending;throw Error('Expected lock wait');}if(await db.query(`select exists(select 1 from pg_stat_activity where application_name=${q(name)} and wait_event_type='Lock');`)==='t')return;await setTimeout(20);}throw Error('No observed lock wait');
 }
 const sql=(f:Fixture)=>`select public.fmat_agent_operation(${q(f.grant)},${q(client)},${q(resource)},'intake',${q(f.intake)},${q(scope)},${f.credential.claims.exp},'request_read',${q(f.request)},'{}',null);`;
 try{
  await db.query(`insert into auth.users(id,email,email_confirmed_at) values(${q(host)},'bound-intake@example.test',now());insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values(${q(invite)},'bound-intake@example.test',${q(hash(invite))},now()+interval '1 day','bound-intake');insert into fmat.hosts(id,email,invitation_id,handle,display_name,rules,conflict_calendar_ids,booking_calendar_id) values(${q(host)},'bound-intake@example.test',${q(invite)},${q('bound-'+host.slice(0,8))},'Host','{"timezone":"UTC","durationMinutes":30}',array['calendar'],'calendar');insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential) values('host',${q(host)},'fixture',array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],'encrypted-private-fixture');insert into fmat.oauth_clients(id,name,redirect_uris,resource) values(${q(client)},'Bound intake fixture',array['https://client.example/cb'],${q(resource)});`);
  await wait.query(`set application_name=${q(name)};`);
  await db.query(`create function pg_temp.operation_error(sql text) returns text language plpgsql as $$begin execute sql;return 'NO_ERROR';exception when others then return SQLERRM;end$$;`);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await db.query(`select has_function_privilege(${q(role)},'fmat.oauth_bound_grant(fmat.oauth_grants)','execute');`),'f');
  const pending=await fixture(false),f=await fixture(),foreign=await fixture();
  const writable=new Set(['setup_draft','private_note_save','details_propose','availability_propose']);
  const all=['setup_read','setup_analysis_read','setup_draft','request_read','private_note_save','details_propose','decision_review','requests_list','conversation_resolve','availability_read','availability_propose','scheduling_read','booking_status','connection_review','setup_review'];
  for(const operation of all){
   assert.deepEqual(await raw(pending,operation,pending.request,{},writable.has(operation)?randomUUID():null),{error:'invalid_grant'},operation+' denies unbound intake');
   await assert.rejects(raw(f,operation,foreign.request,operation==='conversation_resolve'?{audience:'request_shared'}:{},writable.has(operation)?randomUUID():null),operation+' denies foreign/host access');
  }
  for(const operation of ['setup_read','setup_analysis_read','setup_draft','requests_list','setup_review','private_note_save'])await assert.rejects(raw(f,operation,operation==='private_note_save'?f.request:null,{},writable.has(operation)?randomUUID():null));
  for(const operation of ['request_read','availability_read','scheduling_read','booking_status','connection_review','decision_review'] as const){
   const result=await operations.execute(f.credential,{operation,requestId:f.request,input:{}});assert.ok(result);
   assert.doesNotMatch(JSON.stringify(result),/PRIVATE HOST NOTE|encrypted-private-fixture|runtime-/);
   if(operation==='request_read')assert.equal((result as {id:string}).id,f.request);
   if(operation==='decision_review')assert.equal((result as {requiresHumanConfirmation:boolean}).requiresHumanConfirmation,true);
  }
  const intent={operation:'details_propose',requestId:f.request,idempotencyKey:randomUUID(),input:{expectedRevision:1,patch:{purpose:'Proposed'},clarifications:[]}};
  const draft=await operations.execute(f.credential,intent);assert.deepEqual(await operations.execute(f.credential,intent),draft);
  await assert.rejects(operations.execute(f.credential,{...intent,input:{...intent.input,patch:{purpose:'Changed'}}}));
  const availability={operation:'availability_propose',requestId:f.request,idempotencyKey:randomUUID(),input:{expectedRevision:1,timezone:'UTC',windows:[{start:new Date(Date.now()+86400000).toISOString(),end:new Date(Date.now()+90000000).toISOString()}]}};
  assert.ok(await operations.execute(f.credential,availability));
  assert.equal(await db.query(`select revision=1 and requester_agreed_version is null and host_approved_version is null from fmat.requests where id=${q(f.request)};`),'t','proposals and decision review confer no human approval');
  assert.deepEqual(await conversations.resolve(f.credential,{audience:'request_shared',requestId:f.request}),{conversationId:f.conversation,sessionId:'runtime-'+f.conversation});
  for(const target of [{audience:'host_setup'},{audience:'host_private',requestId:f.request},{audience:'request_shared',requestId:foreign.request}])await assert.rejects(conversations.resolve(f.credential,target));
  const narrow=await credentials.verify(await tokens.issue({...f.grantProjection,scope:'request:read'},async()=>{}));
  assert.ok(await operations.execute(narrow,{operation:'request_read',requestId:f.request,input:{}}));
  await assert.rejects(operations.execute(narrow,intent),/invalid_scope/);
  await assert.rejects(operations.execute(narrow,{operation:'decision_review',requestId:f.request,input:{}}),/invalid_scope/);
  assert.equal(narrow.claims.sub,f.intake);assert.equal(narrow.claims.actor_kind,'intake');
  // Scheduling's private evaluator must independently enforce the intake binding.
  const foreignEvaluation=`select fmat.evaluate_availability('current_context',${q(JSON.stringify({kind:'agent',grantId:f.grant,tokenExpiresAt:f.credential.claims.exp}))}::jsonb,${q(JSON.stringify({requestId:foreign.request,revision:1}))}::jsonb,null);`;
  assert.equal(await db.query(`select pg_temp.operation_error(${q(foreignEvaluation)});`),'FORBIDDEN');
  const history=await agentHistory(narrow,{target:{audience:'request_shared',requestId:f.request}},sessionId=>{
   assert.equal(sessionId,'runtime-'+f.conversation);
   return {getStreamTailIndex:async()=>1,getEventStream:async()=>new ReadableStream({start(controller){controller.enqueue({type:'message.completed',data:{message:'Shared answer'}});controller.enqueue({type:'action.result',data:{secret:'PRIVATE TOOL OUTPUT'}});controller.close();}})};
  },new AbortController().signal,conversations,env);
  assert.equal(history.events.length,2);assert.deepEqual(history.events[1],{cursor:2,type:'cursor'});assert.match(JSON.stringify(history.events),/Shared answer/);assert.doesNotMatch(JSON.stringify(history),/PRIVATE TOOL OUTPUT|runtime-/);
  await db.query(`update fmat.calendar_connections set revoked_at=clock_timestamp(),encrypted_credential=null where principal_id=${q(host)};`);
  assert.equal((await operations.execute(f.credential,{operation:'request_read',requestId:f.request,input:{}}) as {id:string}).id,f.request,'bound access does not require published Calendar readiness');
  await db.query(`update fmat.calendar_connections set revoked_at=null,encrypted_credential='encrypted-private-fixture' where principal_id=${q(host)};`);
  // History checks again after runtime I/O; revocation discards the whole page.
  await assert.rejects(agentHistory(f.credential,{target:{audience:'request_shared',requestId:f.request}},()=>({getStreamTailIndex:async()=>{await database.rpc('fmat_oauth_intake_revoke',{p_id:f.authorization,p_browser_hash:'b'.repeat(64)});return -1;},getEventStream:async()=>new ReadableStream()}),new AbortController().signal,conversations,env),/invalid_token/);
  await assert.rejects(operations.execute(f.credential,intent),/invalid_token/,'cached draft replay checks current authority');
  for(const change of ['rotation','closure','request-expiry','proof-expiry','client','host'] as const){
   const item=await fixture();
   const mutation={rotation:`update fmat.requests set token_hash=${q(hash('rotated'))} where id=${q(item.request)};`,closure:`update fmat.requests set status='withdrawn' where id=${q(item.request)};`,'request-expiry':`update fmat.requests set expires_at=clock_timestamp()-interval '1 second' where id=${q(item.request)};`,'proof-expiry':`update fmat.requests set token_expires_at=clock_timestamp()-interval '1 second' where id=${q(item.request)};`,client:`update fmat.oauth_clients set disabled_at=clock_timestamp() where id=${q(client)};`,host:`update fmat.hosts set revoked_at=clock_timestamp() where id=${q(host)};`}[change];
   await db.query(mutation);
   assert.deepEqual(await raw(item,'request_read'),{error:'invalid_grant'},change);
   await assert.rejects(conversations.resolve(item.credential,{audience:'request_shared',requestId:item.request}),/invalid_token/);
   if(change==='rotation'){await db.query(`update fmat.requests set token_hash=${q(hash(item.request))} where id=${q(item.request)};`);assert.deepEqual(await raw(item,'request_read'),{error:'invalid_grant'});}
   if(change==='client')await db.query(`update fmat.oauth_clients set disabled_at=null where id=${q(client)};`);
   if(change==='host')await db.query(`update fmat.hosts set revoked_at=null where id=${q(host)};`);
  }
  const raced=await fixture();
  await lock.query(`begin;select public.fmat_oauth_intake_revoke(${q(raced.authorization)},repeat('b',64));`);
  let reading=wait.query(sql(raced));void reading.catch(()=>{});await blocked(reading);await lock.query('commit;');assert.equal(JSON.parse(await reading).error,'invalid_grant');
  const rotated=await fixture();await lock.query(`begin;update fmat.requests set token_hash=${q(hash('race'))} where id=${q(rotated.request)};`);
  reading=wait.query(sql(rotated));void reading.catch(()=>{});await blocked(reading);await lock.query('commit;');assert.equal(JSON.parse(await reading).error,'invalid_grant');
  const expiry=await fixture();
  await lock.query(`begin;select 1 from fmat.oauth_intakes where id=${q(expiry.intake)} for update;`);
  const exp=Math.floor(Date.now()/1000)+2;
  reading=wait.query(sql(expiry).replace(`,${expiry.credential.claims.exp},'request_read'`,`,${exp},'request_read'`));void reading.catch(()=>{});
  await blocked(reading);await lock.query('select pg_sleep(2.1);commit;');assert.equal(JSON.parse(await reading).error,'invalid_token','token expiry after intake lock wait denies the result');
  // Resolve the binding after the intake lock wait, never from a stale pending
  // snapshot. Use the actual atomic creation RPC inside the blocking transaction.
  const claims=pending.credential.claims;
  const context=await database.rpc('fmat_agent_intake',{p_grant_id:pending.grant,p_client_id:client,p_resource:resource,p_intake_id:pending.intake,p_scope:scope,p_token_expires_at:claims.exp,p_operation:'context',p_input:{}}) as {grant:{connectionId:string;generation:string;rulesVersion:number}};
  const creation={details:{requesterName:'Requester',requesterEmail:'requester@example.test',purpose:'Created while waiting',timezone:'UTC',durationMinutes:30,windows:[]},idempotencyKey:randomUUID(),tokenHash:hash(pending.request),connectionId:context.grant.connectionId,generation:context.grant.generation,rulesVersion:context.grant.rulesVersion};
  await lock.query(`begin;select public.fmat_agent_intake(${q(pending.grant)},${q(client)},${q(resource)},${q(pending.intake)},${q(scope)},${claims.exp},'create',${q(JSON.stringify(creation))}::jsonb);`);
  reading=wait.query(sql(pending));void reading.catch(()=>{});await blocked(reading);await lock.query('commit;');assert.equal(JSON.parse(await reading).id,pending.request,'waiting operation observes the committed request binding');
  const open=await fixture();
  // Different intakes may share a host but must acquire UPDATE before grant
  // SHARE when reading scheduling, so neither performs a lock upgrade cycle.
  assert.ok((await Promise.all([open,foreign].map(item=>operations.execute(item.credential,{operation:'scheduling_read',requestId:item.request,input:{}})))).every(Boolean));
 }finally{
  await lock.query('rollback;').catch(()=>{});const cleanup=new LocalSql();
  try{await cleanup.query(`delete from fmat.idempotency where actor_scope in(select 'intake:'||id from fmat.oauth_intakes where host_id=${q(host)});delete from fmat.audit_events where subject_id in(select id::text from fmat.requests where host_id=${q(host)});delete from fmat.oauth_intakes where host_id=${q(host)};delete from fmat.oauth_grants where client_id=${q(client)};delete from fmat.oauth_authorizations where client_id=${q(client)};delete from fmat.oauth_clients where id=${q(client)};delete from fmat.conversation_scopes where host_id=${q(host)};delete from fmat.requests where host_id=${q(host)};delete from fmat.calendar_connections where principal_id=${q(host)};delete from fmat.hosts where id=${q(host)};delete from fmat.invitations where id=${q(invite)};delete from auth.users where id=${q(host)};`);}finally{cleanup.close();db.close();lock.close();wait.close();}
 }
});
