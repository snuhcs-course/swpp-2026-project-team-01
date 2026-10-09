import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
import {generateKeyPair,exportJWK} from 'jose';
import {Database} from '../../lib/server/database/client.ts';
import {AgentIntakeBrowser} from '../../lib/server/oauth/intake-browser.ts';
import {AgentIntake} from '../../lib/server/oauth/intake.ts';
import {agentIntakeProof} from '../../lib/server/oauth/intake-proof.ts';
import {AgentCredentials,type AgentCredential} from '../../lib/server/oauth/credentials.ts';
import {AgentOAuthTokens,agentTokenGrant} from '../../lib/server/oauth/tokens.ts';
import {TokenCipher} from '../../lib/server/calendar/encryption.ts';
import {calendarScopes} from '../../lib/server/calendar/google.ts';
import type {CalendarProvider} from '../../lib/server/calendar/catalog.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {LocalSql} from './local-sql.ts';
const q=(value:string)=>`'${value.replaceAll("'","''")}'`;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const resource='https://release.findmeatime.com/mcp',redirect='https://client.example/cb',browserSecret=randomBytes(32).toString('base64url'),browser=hash(browserSecret);
const details={requesterName:'Requester',requesterEmail:'requester@example.test',purpose:'Discuss plans',timezone:'Asia/Seoul',durationMinutes:30,windows:[]};
const code=(value:string)=>(e:unknown)=>e instanceof ApplicationError&&e.code===value;

test('agent intake atomically creates its reserved request and recovers concurrent, lost and changed attempts',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const pair=await generateKeyPair('ES256',{extractable:true});
 const env={...process.env,APP_ORIGIN:'https://release.findmeatime.com',SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,
  TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),AGENT_INTAKE_PROOF_KEY:randomBytes(32).toString('base64'),
  AGENT_OAUTH_SIGNING_JWK:JSON.stringify({...await exportJWK(pair.privateKey),kid:'intake-fixture'})};
 const db=new LocalSql(),database=new Database(env),host=randomUUID(),invite=randomUUID(),client=randomUUID(),handle='create-'+host.slice(0,8);
 const cipher=new TokenCipher(env),tokens=new AgentOAuthTokens(env),credentials=new AgentCredentials(env,database);
 let savedRegistry:string|undefined,savedIntake:string|undefined,reads=0,refreshes=0,gate:()=>Promise<void>=async()=>{};
 const provider:CalendarProvider={async refresh(bundle){refreshes++;return {...bundle,expiresAt:Date.now()+3600000};},async list(){reads++;await gate();return [{id:'calendar',name:'Private calendar',accessRole:'owner',primary:true,timeZone:'Asia/Seoul',color:null}];}};
 const service=new AgentIntake(database,env,provider),handoff=new AgentIntakeBrowser(database,env);
 const encrypted=()=>cipher.seal({accessToken:'private-access',refreshToken:'private-refresh',expiresAt:Date.now()+3600000,subject:'fixture',scopes:[...calendarScopes.host]},'google:host:'+host);
 async function fixture(){
  const start=await database.rpc('fmat_oauth_authorization_start',{p_input:{clientId:client,resource,redirectUri:redirect,scope:'request:intake request:read request:write',handle,
   codeChallenge:createHash('sha256').update('A'.repeat(43)).digest('base64url'),codeChallengeMethod:'S256',state:'opaque',browserHash:browser}}) as {authorizationId:string};
  assert.ok(start.authorizationId);
  const consent=await database.rpc('fmat_oauth_intake_consent',{p_id:start.authorizationId,p_browser_hash:browser,p_decision:'grant',p_code_hash:hash(randomUUID())}) as {decision:string};assert.equal(consent.decision,'grant');
  const state=JSON.parse(await db.query(`select jsonb_build_object('intake',id,'request',reserved_request_id,'grant',grant_id) from fmat.oauth_intakes where authorization_id=${q(start.authorizationId)};`));
  const grant=agentTokenGrant.parse(await database.rpc('fmat_oauth_grant_check',{p_id:state.grant,p_client_id:client,p_resource:resource,p_actor_kind:'intake',p_actor_id:state.intake,p_scope:'request:intake request:read request:write'}));
  const token=await tokens.issue(grant,async()=>{});
  return {...state,authorization:start.authorizationId,credential:await credentials.verify(token),key:randomUUID()} as {intake:string;request:string;grant:string;authorization:string;credential:AgentCredential;key:string};
 }
 const count=()=>db.query(`select count(*) from fmat.requests where host_id=${q(host)};`);
 async function providerRace(f:Awaited<ReturnType<typeof fixture>>,mutate:()=>Promise<unknown>,expected:RegExp|ReturnType<typeof code>){
  let arrived!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>arrived=r),wait=new Promise<void>(r=>release=r);
  gate=async()=>{arrived();await wait;};
  const pending=service.create(f.credential,{idempotencyKey:f.key,details}),rejected=assert.rejects(pending,expected);
  try{await entered;await mutate();}finally{release();gate=async()=>{};}
  await rejected;
  assert.equal(await db.query(`select request_id is null from fmat.oauth_intakes where id=${q(f.intake)};`),'t');
  assert.equal(await db.query(`select count(*) from fmat.requests where id=${q(f.request)};`),'0');
 }
 try{
  savedRegistry=await db.query("select coalesce(jsonb_agg(to_jsonb(b)),'[]') from fmat.oauth_budgets b;");
  savedIntake=await db.query("select coalesce(jsonb_agg(to_jsonb(b)),'[]') from fmat.oauth_intake_budgets b;");
  await db.query('delete from fmat.oauth_budgets;delete from fmat.oauth_intake_budgets;');
  await db.query(`insert into auth.users(id,email,email_confirmed_at) values(${q(host)},'intake-create@example.test',now());insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values(${q(invite)},'intake-create@example.test',${q(hash(invite))},now()+interval '1 day','intake-create');insert into fmat.hosts(id,email,invitation_id,handle,display_name,rules,conflict_calendar_ids,booking_calendar_id) values(${q(host)},'intake-create@example.test',${q(invite)},${q(handle)},'Public host','{"timezone":"Asia/Seoul","durationMinutes":30}',array['calendar'],'calendar');insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential) values('host',${q(host)},'synthetic-subject',array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],${q(encrypted())});insert into fmat.oauth_clients(id,name,redirect_uris,resource) values(${q(client)},'Intake creation fixture',array[${q(redirect)}],${q(resource)});`);
  for(const role of ['anon','authenticated'])assert.equal(await db.query(`select has_function_privilege(${q(role)},'public.fmat_agent_intake(uuid,uuid,text,uuid,text,bigint,text,jsonb)','execute');`),'f');
  for(const role of ['anon','authenticated'])assert.equal(await db.query(`select has_function_privilege(${q(role)},'public.fmat_oauth_intake_handoff(uuid,text,text,text)','execute');`),'f');
  for(const role of ['anon','authenticated','service_role'])assert.equal(await db.query(`select has_function_privilege(${q(role)},'fmat.insert_request(uuid,jsonb,text,jsonb,uuid)','execute');`),'f');
  const f=await fixture(),intent={idempotencyKey:f.key,details};
  assert.equal((await service.create(f.credential,{idempotencyKey:f.key,details:{purpose:'Ask first'}})).status,'clarification');
  assert.equal(reads,0);assert.equal(await count(),'0');
  assert.equal((await handoff.state(f.authorization,browserSecret)).state,'pending');await assert.rejects(handoff.claim(f.authorization,browserSecret),/invalid_grant/);
  await assert.rejects(service.create(f.credential,{...intent,hostId:host}),code('INVALID_INPUT'));
  await assert.rejects(service.create({...f.credential},intent),/invalid_token/);
  const firsts=await Promise.all(Array.from({length:8},()=>service.create(f.credential,intent)));
  assert.ok(firsts.every(value=>value.status==='created'&&value.requestId===f.request));assert.equal(await count(),'1');
  assert.equal(await db.query(`select count(*) from fmat.audit_events where operation='request_create' and subject_id=${q(f.request)};`),'1');
  assert.equal(await db.query(`select count(*) from fmat.idempotency where actor_scope=${q('intake:'+f.intake)};`),'1');
  assert.equal(await db.query(`select token_hash from fmat.requests where id=${q(f.request)};`),hash(agentIntakeProof(f.intake,f.request,env)));
  assert.equal(await db.query(`select contact_verified_email is null and requester_agreed_version is null and host_approved_version is null and event is null from fmat.requests where id=${q(f.request)};`),'t');
  const before=reads;assert.deepEqual(await service.create(f.credential,intent),{status:'created',requestId:f.request});assert.equal(reads,before);
  const handed=await handoff.claim(f.authorization,browserSecret);assert.equal(handed.requestId,f.request);assert.equal(handed.proof,agentIntakeProof(f.intake,f.request,env));
  assert.deepEqual(await handoff.claim(f.authorization,browserSecret),handed);
  await assert.rejects(handoff.claim(f.authorization,randomBytes(32).toString('base64url')),/invalid_grant/);
  await assert.rejects(new AgentIntakeBrowser(database,{...env,AGENT_INTAKE_PROOF_KEY:randomBytes(32).toString('base64')}).claim(f.authorization,browserSecret),/invalid_grant/);
  const lostHandoff=new AgentIntakeBrowser({async rpc(name,params){const result=await database.rpc(name,params);if(name==='fmat_oauth_intake_handoff'&&params.p_proof_hash!==null)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);return result;}},env);
  await assert.rejects(lostHandoff.claim(f.authorization,browserSecret),code('PROVIDER_UNAVAILABLE'));assert.deepEqual(await handoff.claim(f.authorization,browserSecret),handed);

  await assert.rejects(service.create(f.credential,{...intent,details:{...details,purpose:'Changed'}}),code('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(service.create(f.credential,{...intent,idempotencyKey:randomUUID()}),code('IDEMPOTENCY_CONFLICT'));
  const different=await fixture();
  const results=await Promise.allSettled(['One','Two'].map(purpose=>service.create(different.credential,{idempotencyKey:different.key,details:{...details,purpose}})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&code('IDEMPOTENCY_CONFLICT')(r.reason)).length,1);assert.equal(await count(),'2');
  const lost=await fixture();let dropped=false;
  const unreliable=new AgentIntake({async rpc(name,params){const value=await database.rpc(name,params);if(name==='fmat_agent_intake'&&params.p_operation==='create'&&!dropped){dropped=true;throw new ApplicationError('PROVIDER_UNAVAILABLE',503);}return value;}},env,provider);
  assert.deepEqual(await unreliable.create(lost.credential,{idempotencyKey:lost.key,details}),{status:'created',requestId:lost.request});assert.equal(dropped,true);assert.equal(await count(),'3');
  const stale=await fixture();await providerRace(stale,()=>db.query(`update fmat.hosts set rules_version=rules_version+1 where id=${q(host)};`),code('STALE_REVISION'));
  assert.deepEqual(await service.create(stale.credential,{idempotencyKey:stale.key,details}),{status:'created',requestId:stale.request});
  const revoked=await fixture();await providerRace(revoked,()=>database.rpc('fmat_oauth_intake_revoke',{p_id:revoked.authorization,p_browser_hash:browser}),/invalid_token/);
  const disconnected=await fixture();await providerRace(disconnected,()=>db.query(`update fmat.calendar_connections set revoked_at=clock_timestamp(),encrypted_credential=null where principal_kind='host' and principal_id=${q(host)};`),/invalid_token/);
  await db.query(`update fmat.calendar_connections set revoked_at=null,encrypted_credential=${q(encrypted())} where principal_kind='host' and principal_id=${q(host)};`);
  await assert.rejects(handoff.claim(revoked.authorization,browserSecret),/invalid_grant/);
  const disabled=await fixture();await providerRace(disabled,()=>db.query(`update fmat.oauth_clients set disabled_at=clock_timestamp() where id=${q(client)};`),/invalid_token/);
  await db.query(`update fmat.oauth_clients set disabled_at=null where id=${q(client)};`);
  assert.equal(await count(),'4');
  // Bound retry depends on request authority, not ongoing public readiness.
  await db.query(`update fmat.hosts set handle=null where id=${q(host)};`);
  assert.deepEqual(await service.create(f.credential,intent),{status:'created',requestId:f.request});
  await db.query(`update fmat.hosts set handle=${q(handle)} where id=${q(host)};update fmat.requests set token_hash=${q(hash('rotated'))} where id=${q(f.request)};`);
  await assert.rejects(service.create(f.credential,intent),/invalid_token/);
  await assert.rejects(handoff.claim(f.authorization,browserSecret),/invalid_grant/);
  await db.query(`update fmat.requests set token_hash=${q(hash(agentIntakeProof(f.intake,f.request,env)))} where id=${q(f.request)};`);
  await assert.rejects(service.create(f.credential,intent),/invalid_token/);
  // Distinct pending intakes share one expiring host credential. A failed CAS
  // may retry, but no connection lock upgrade deadlocks and no grant retargets.
  const left=await fixture(),right=await fixture();
  const expiring=cipher.seal({accessToken:'old-access',refreshToken:'old-refresh',expiresAt:Date.now()-1,subject:'fixture',scopes:[...calendarScopes.host]},'google:host:'+host);
  await db.query(`update fmat.calendar_connections set encrypted_credential=${q(expiring)} where principal_id=${q(host)};`);
  const parallel=await Promise.allSettled([left,right].map(item=>service.create(item.credential,{idempotencyKey:item.key,details})));
  for(let n=0;n<parallel.length;n++){
   const item=[left,right][n]!;
   if(parallel[n]!.status==='rejected')assert.ok(code('STALE_REVISION')((parallel[n] as PromiseRejectedResult).reason));
   assert.deepEqual(await service.create(item.credential,{idempotencyKey:item.key,details}),{status:'created',requestId:item.request});
  }
  assert.ok(refreshes>=1);assert.equal(await count(),'6');
  assert.equal(await db.query(`select count(*) from fmat.booking_attempts where request_id in(select id from fmat.requests where host_id=${q(host)});`),'0');
  // Seed the immutable fifteen-minute boundary at insertion, then let real
  // time expire during provider I/O. No trigger or immutable state is bypassed.
  const deadline={authorization:randomUUID(),intake:randomUUID(),grant:randomUUID(),request:randomUUID(),key:randomUUID()};
  await db.query(`insert into fmat.oauth_authorizations(id,client_id,resource,redirect_uri,scope,code_challenge,state,browser_hash,created_at,expires_at,decision,decided_at) values(${q(deadline.authorization)},${q(client)},${q(resource)},${q(redirect)},'request:intake request:read request:write',repeat('A',43),'s',${q(browser)},statement_timestamp(),statement_timestamp()+interval '10 minutes','grant',statement_timestamp());insert into fmat.oauth_grants(id,authorization_id,client_id,resource,scope,actor_kind,actor_id,host_id,created_at,expires_at) values(${q(deadline.grant)},${q(deadline.authorization)},${q(client)},${q(resource)},'request:intake request:read request:write','intake',${q(deadline.intake)},${q(host)},statement_timestamp()-interval '14 minutes 58 seconds',statement_timestamp()+interval '1 day');insert into fmat.oauth_intakes(id,authorization_id,host_id,reserved_request_id,browser_hash,created_at,grant_id,granted_at,create_expires_at) values(${q(deadline.intake)},${q(deadline.authorization)},${q(host)},${q(deadline.request)},${q(browser)},statement_timestamp()-interval '15 minutes',${q(deadline.grant)},statement_timestamp()-interval '14 minutes 58 seconds',statement_timestamp()+interval '2 seconds');`);
  const deadlineGrant=agentTokenGrant.parse(await database.rpc('fmat_oauth_grant_check',{p_id:deadline.grant,p_client_id:client,p_resource:resource,p_actor_kind:'intake',p_actor_id:deadline.intake,p_scope:'request:intake request:read request:write'}));
  const deadlineCredential=await credentials.verify(await tokens.issue(deadlineGrant,async()=>{}));
  await providerRace({...deadline,credential:deadlineCredential},()=>setTimeout(2200),/invalid_token/);
  assert.equal(await db.query(`select revoked_at is not null from fmat.oauth_grants where id=${q(deadline.grant)};`),'t');
  const expiry=await fixture(),claims=expiry.credential.claims;
  const args={p_grant_id:claims.grant_id,p_client_id:claims.client_id,p_resource:claims.aud,p_intake_id:claims.sub,p_scope:claims.scope,p_token_expires_at:claims.exp};
  const context=await database.rpc('fmat_agent_intake',{...args,p_operation:'context',p_input:{}}) as {grant:{connectionId:string;generation:string;rulesVersion:number}};
  const input={details,idempotencyKey:expiry.key,tokenHash:hash(agentIntakeProof(expiry.intake,expiry.request,env)),connectionId:context.grant.connectionId,generation:context.grant.generation,rulesVersion:context.grant.rulesVersion};
  for(const changed of [{p_client_id:randomUUID()},{p_resource:'https://foreign.example/mcp'},{p_intake_id:randomUUID()},{p_scope:'request:read'},{p_token_expires_at:1}]){
   const result=await database.rpc('fmat_agent_intake',{...args,...changed,p_operation:'create',p_input:input}) as {error:string};
   assert.ok(['invalid_grant','invalid_scope','invalid_token'].includes(result.error));
  }
  await assert.rejects(database.rpc('fmat_agent_intake',{...args,p_operation:'create',p_input:{...input,hostId:randomUUID()}}),code('INVALID_INPUT'));
  // Force a wait after insertion, binding and audit, at the final retry receipt.
  // Token expiry must roll back all those domain effects, not just the result.
  const locker=new LocalSql(),waiter=new LocalSql(),waitName='intake-create-'+randomUUID();
  let pending:Promise<string>|undefined;
  try{
   await waiter.query(`set application_name=${q(waitName)};`);
   await locker.query(`begin;insert into fmat.idempotency(actor_scope,operation,key,input) values(${q('intake:'+expiry.intake)},'request_create',${q(expiry.key)},'{}');`);
   const exp=Math.floor(Date.now()/1000)+2;
   pending=waiter.query(`select public.fmat_agent_intake(${q(claims.grant_id)},${q(claims.client_id)},${q(claims.aud)},${q(claims.sub)},${q(claims.scope)},${exp},'create',${q(JSON.stringify(input))}::jsonb);`);void pending.catch(()=>{});
   let observed=false;
   for(let n=0;n<50;n++){
    if(await db.query(`select exists(select 1 from pg_stat_activity where application_name=${q(waitName)} and wait_event_type='Lock');`)==='t'){observed=true;break;}
    await setTimeout(20);
   }
   assert.equal(observed,true,'creation reaches an observed database lock wait');
   await locker.query('select pg_sleep(2.1);rollback;');
   assert.equal(JSON.parse(await pending).error,'invalid_token');
   assert.equal(await db.query(`select request_id is null from fmat.oauth_intakes where id=${q(expiry.intake)};`),'t');
   assert.equal(await db.query(`select count(*) from fmat.requests where id=${q(expiry.request)};`),'0');
   assert.equal(await db.query(`select count(*) from fmat.audit_events where subject_id=${q(expiry.request)};`),'0');
   assert.equal(await db.query(`select count(*) from fmat.idempotency where actor_scope=${q('intake:'+expiry.intake)};`),'0');
   assert.deepEqual(await service.create(expiry.credential,{idempotencyKey:expiry.key,details}),{status:'created',requestId:expiry.request},'a still-current token can retry after the expired operation rolled back');
  }finally{await locker.query('rollback;').catch(()=>{});await pending?.catch(()=>{});locker.close();waiter.close();}

 }finally{
  const cleanup=new LocalSql();
  try{
   await cleanup.query(`delete from fmat.idempotency where actor_scope in(select 'intake:'||id from fmat.oauth_intakes where host_id=${q(host)});delete from fmat.audit_events where subject_id in(select id::text from fmat.requests where host_id=${q(host)});delete from fmat.oauth_codes where grant_id in(select id from fmat.oauth_grants where client_id=${q(client)});delete from fmat.oauth_refresh_tokens where grant_id in(select id from fmat.oauth_grants where client_id=${q(client)});delete from fmat.oauth_intakes where host_id=${q(host)};delete from fmat.oauth_grants where client_id=${q(client)};delete from fmat.oauth_authorizations where client_id=${q(client)};delete from fmat.oauth_clients where id=${q(client)};delete from fmat.requests where host_id=${q(host)};delete from fmat.calendar_connections where principal_kind='host' and principal_id=${q(host)};delete from fmat.hosts where id=${q(host)};delete from fmat.invitations where id=${q(invite)};delete from auth.users where id=${q(host)};`);
   if(savedRegistry!==undefined)await cleanup.query(`delete from fmat.oauth_budgets;insert into fmat.oauth_budgets select * from jsonb_populate_recordset(null::fmat.oauth_budgets,${q(savedRegistry)}::jsonb);`);
   if(savedIntake!==undefined)await cleanup.query(`delete from fmat.oauth_intake_budgets;insert into fmat.oauth_intake_budgets select * from jsonb_populate_recordset(null::fmat.oauth_intake_budgets,${q(savedIntake)}::jsonb);`);
  }finally{cleanup.close();db.close();}
 }
});
