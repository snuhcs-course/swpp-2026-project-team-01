import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash,randomBytes} from 'node:crypto';
import {mkdtemp,writeFile,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startBrowserRuntime} from './fixture-server.ts';
import {LocalSql} from '../integration/local-sql.ts';
import {Database} from '../../lib/server/database/client.ts';
import {HostSetup} from '../../lib/server/setup/commands.ts';
import {verifyHostToken} from '../../lib/server/identity/credentials.ts';
const q=(value:string)=>`'${value.replaceAll("'","''")}'`;

test('actual terminal workflow recovers original pending input with historical context and one draft effect',{timeout:180000},async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.ok(['127.0.0.1','localhost'].includes(new URL(local.API_URL).hostname));
 const sql=new LocalSql(),invitation=randomUUID(),email=randomUUID()+'@successor-runtime.test',password=randomUUID()+randomUUID(),dispatchSecret=randomBytes(32).toString('hex');
 const admin={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'};
 const env={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY};
 let host='',scope='',runtime:Awaited<ReturnType<typeof startBrowserRuntime>>|undefined;
 try{
  const created=await fetch(local.API_URL+'/auth/v1/admin/users',{method:'POST',headers:admin,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(created.status,200);host=(await created.json()).id;
  const login=await fetch(local.API_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:local.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);const token=(await login.json()).access_token;
  await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','${email}','${createHash('sha256').update(invitation).digest('hex')}',now()+interval '1 day','successor-runtime');insert into fmat.hosts(id,email,invitation_id) values('${host}','${email}','${invitation}');`);
  const setup=new HostSetup(new Database(env)),credential=await verifyHostToken(token,{env});
  const saved=await setup.draft(credential,{expectedRevision:0,idempotencyKey:randomUUID(),patch:{displayName:'Existing draft',rules:{timezone:'Asia/Seoul',bufferMinutes:10}},unresolved:['Meeting hours still needed']});
  const fault=await mkdtemp(resolve('.local/rebuild/successor-ack-')),marker=join(fault,'binding-ack-lost'),recoveryMarker=join(fault,'recovery-ack-lost'),toolMarker=join(fault,'tool-ack-lost'),settleMarker=join(fault,'settle-ack-lost'),preload=join(fault,'fault.mjs');
  await writeFile(preload,`import {existsSync,writeFileSync} from 'node:fs';
const original=globalThis.fetch;
globalThis.fetch=async(url,init)=>{
 const response=await original(url,init);
 if(!String(url).includes('/rpc/')||!response.ok)return response;
 const params=JSON.parse(init?.body??'{}');
 const faultMarker=String(url).endsWith('/rpc/fmat_conversation_recovery')&&params.p_operation==='begin'?${JSON.stringify(recoveryMarker)}:
  String(url).endsWith('/rpc/fmat_runtime_successor')&&params.p_operation==='bind'?${JSON.stringify(marker)}:
  String(url).endsWith('/rpc/fmat_conversation_tool')&&params.p_operation==='setup_draft'?${JSON.stringify(toolMarker)}:
  String(url).endsWith('/rpc/fmat_runtime_message')&&params.p_operation==='settle'&&params.p_input?.status==='completed'&&existsSync(${JSON.stringify(toolMarker)})?${JSON.stringify(settleMarker)}:null;
 if(faultMarker&&!existsSync(faultMarker)){
  // Make the post-commit/pre-ack window observable even on a fast runner.
  if(faultMarker===${JSON.stringify(settleMarker)})await new Promise(resolve=>setTimeout(resolve,250));
  writeFileSync(faultMarker,'committed acknowledgment lost');
  return Response.json({message:'synthetic acknowledgment loss'},{status:503});
 }
 return response;
};`);
  runtime=await startBrowserRuntime(local,'http://localhost:3000',dispatchSecret,{terminalInspection:true,preload,creationAckFault:true,legacyAuthenticationFailure:true});
  const headers={authorization:'Bearer '+token,'content-type':'application/json'};
  const post=(path:string,body:unknown)=>fetch(runtime!.origin+path,{method:'POST',headers,body:JSON.stringify(body)});
  const opened=await post('/api/conversations',{audience:'host_setup'});assert.equal(opened.status,200);scope=(await opened.json()).conversationId;
  async function settle(id:string,status:string){
   for(let n=0;n<400;n++){if(await sql.query(`select status from fmat.runtime_messages where id=${q(id)};`)!=='pending')break;await delay(100);}
   assert.equal(await sql.query(`select status from fmat.runtime_messages where id=${q(id)};`),status);
  }
  async function send(text:string){
   const response=await post(`/api/conversations/${scope}/messages`,{text,clientId:randomUUID()}),body=await response.json();
   assert.ok([200,202].includes(response.status),JSON.stringify(body));return body.messageId as string;
  }
  const initial=await send('retained-archive-sentinel');await settle(initial,'completed');
  const failed=await send('setup-provider-authentication');await settle(failed,'failed');
  const oldRuntime=await sql.query(`select runtime_session_id from fmat.conversation_scopes where id=${q(scope)};`);
  const inspection=await fetch(runtime.origin+`/test/runtime/terminal/${scope}`,{headers});assert.equal(inspection.status,200);
  const terminal=await inspection.json();assert.equal(terminal.state,'failed');assert.equal(terminal.evidence.sessionId,oldRuntime);
  const oldCharge=await sql.query(`select attempts from fmat.model_work_attempts where name=${q('conversation:'+failed)};`);
  const input={text:'recovery-context-fixture',clientId:randomUUID()};
  const pending=await post(`/api/conversations/${scope}/messages`,input);assert.equal(pending.status,409);assert.equal((await pending.json()).error.code,'RECONCILIATION_PENDING');
  const row=JSON.parse(await sql.query(`select jsonb_build_object('id',id,'grantId',grant_id,'clientId',client_id,'fingerprint',input_fingerprint,'text',text) from fmat.runtime_messages where conversation_id=${q(scope)} and status='pending';`));
  assert.equal(row.clientId,input.clientId);assert.equal(row.text,input.text);assert.deepEqual(await setup.read(credential),saved);
  const recoveryPath=`/api/conversations/${scope}/recovery`,recoveryInput={expectedGeneration:0,idempotencyKey:randomUUID()};
  const status=await fetch(runtime.origin+recoveryPath,{headers});assert.equal(status.status,200);
  assert.deepEqual(await status.json(),{conversationId:scope,generation:0,state:'recovery_required'});
  assert.equal((await fetch(runtime.origin+recoveryPath)).status,401);
  assert.equal((await fetch(runtime.origin+recoveryPath,{method:'POST',headers:{...headers,origin:'https://foreign.test'},body:JSON.stringify(recoveryInput)})).status,403);
  assert.equal((await post(recoveryPath,{...recoveryInput,evidence:terminal.evidence})).status,400);
  const lost=await post(recoveryPath,recoveryInput);assert.equal(lost.status,503);await access(recoveryMarker);
  const duplicate=await Promise.all([post(recoveryPath,recoveryInput),post(recoveryPath,recoveryInput)]);
  const recovered=await Promise.all(duplicate.map(async response=>{assert.equal(response.status,200);return response.json();}));
  assert.deepEqual(recovered[0],recovered[1]);assert.equal(recovered[0].state,'recovering');assert.equal(recovered[0].generation,1);
  assert.doesNotMatch(JSON.stringify(recovered),/sessionId|eventId|usage|grantId|private-runtime/);
  assert.equal((await post(recoveryPath,{...recoveryInput,idempotencyKey:randomUUID()})).status,409);
  const reloaded=await fetch(runtime.origin+recoveryPath,{headers});assert.equal(reloaded.status,200);assert.deepEqual(await reloaded.json(),recovered[0]);
  await sql.query(`update fmat.runtime_messages set next_dispatch_at=clock_timestamp()-interval '1 second' where id=${q(row.id)};`);
  const dispatch=()=>fetch(runtime!.origin+'/api/internal/conversations/dispatch',{method:'POST',headers:{authorization:'Bearer '+dispatchSecret}});
  assert.equal((await fetch(runtime.origin+'/api/internal/conversations/dispatch',{method:'POST'})).status,401);
  const responses=await Promise.all([dispatch(),dispatch()]);for(const response of responses)assert.equal(response.status,200);
  const reports=await Promise.all(responses.map(response=>response.json()));assert.equal(reports.reduce((n,r)=>n+r.claimed,0),1);assert.equal(reports.reduce((n,r)=>n+r.sent,0),0,'accepted creation acknowledgment was lost rather than reported sent');
  await settle(row.id,'completed');await access(marker);await access(toolMarker);
  // SQL visibility precedes receipt of the RPC response in the child process.
  // Wait for the injected lost acknowledgment as a separate required event.
  for(let n=0;n<100;n++){
   try{await access(settleMarker);break;}catch(error){
    if((error as NodeJS.ErrnoException).code!=='ENOENT'||n===99)throw error;
    await delay(100);
   }
  }
  const current=await setup.read(credential);assert.equal(current.revision,saved.revision+1);assert.equal(current.draft?.settings.rules?.preferences,'Recovered preference');assert.equal(current.draft?.settings.displayName,'Existing draft');
  const newRuntime=await sql.query(`select runtime_session_id from fmat.conversation_scopes where id=${q(scope)};`);assert.ok(newRuntime&&newRuntime!==oldRuntime);
  assert.equal(await sql.query(`select count(*) from fmat.conversation_generations where conversation_id=${q(scope)};`),'2');
  assert.equal(await sql.query(`select count(*) from fmat.conversation_successors where conversation_id=${q(scope)} and bound_at is not null;`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.audit_events where subject_id=${q(scope)} and operation='conversation_successor_bound';`),'1');
  const identity=JSON.parse(await sql.query(`select jsonb_build_object('id',id,'grantId',grant_id,'clientId',client_id,'fingerprint',input_fingerprint,'text',text) from fmat.runtime_messages where id=${q(row.id)};`));assert.deepEqual(identity,row);
  assert.equal(await sql.query(`select attempts from fmat.model_work_attempts where name=${q('conversation:'+failed)};`),oldCharge,'retired failed attempts are not refunded');
  const charge=await sql.query(`select attempts from fmat.model_work_attempts where name=${q('conversation:'+row.id)};`);assert.ok(Number(charge)>0);
  const retry=await post(`/api/conversations/${scope}/messages`,input);assert.equal(retry.status,200);assert.equal((await retry.json()).messageId,row.id);
  assert.equal(await sql.query(`select attempts from fmat.model_work_attempts where name=${q('conversation:'+row.id)};`),charge,'completed retry does not run another model step');assert.deepEqual(await setup.read(credential),current);
  async function stream(cursor:number,expected:string){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
   const response=await fetch(runtime!.origin+`/api/conversations/${scope}/stream?cursor=${cursor}`,{headers,signal:controller.signal});assert.equal(response.status,200);
   const reader=response.body!.getReader();let output='';try{while(!output.includes(expected)){const part=await reader.read();if(part.done)break;output+=new TextDecoder().decode(part.value);}}
   finally{clearTimeout(timer);controller.abort();await reader.cancel().catch(()=>{});}
   assert.ok(output.includes(expected));assert.doesNotMatch(output,/synthetic-private|creationKey|leaseToken/);return output;
  }
  const output=await stream(0,'Recovered with retained historical context and one saved draft.');
  assert.ok(output.includes('retained-archive-sentinel'));assert.ok(output.includes('g1:turn_0'),'successor turn ID cannot overwrite the archived turn');
  await runtime.restart();
  const suffix=await stream(terminal.evidence.tailIndex+1,'Recovered with retained historical context and one saved draft.');assert.equal(suffix.includes('retained-archive-sentinel'),false,'old boundary resumes exactly at successor events');
  const later=await send('after-recovery');await settle(later,'completed');await stream(terminal.evidence.tailIndex+1,'Reply 3: after-recovery');
  assert.equal(await sql.query(`select runtime_session_id from fmat.conversation_scopes where id=${q(scope)};`),newRuntime,'normal continuation retains the bound successor');
  const archive=await send('recovery-archive-fixture');await settle(archive,'completed');await stream(terminal.evidence.tailIndex+1,'Read the retained archive through the authorized history tool.');
  assert.deepEqual(await setup.read(credential),current,'archived assistant text cannot change saved setup');
  const healthy=await post(recoveryPath,{expectedGeneration:1,idempotencyKey:randomUUID()});assert.equal(healthy.status,200);assert.equal((await healthy.json()).state,'active');
  assert.equal(await sql.query(`select count(*) from fmat.conversation_recoveries where conversation_id=${q(scope)};`),'1','ordinary active runtime cannot be replaced');
 }finally{
  await runtime?.stop();
  try{if(host){await sql.query(`delete from fmat.conversation_recoveries where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_generations where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.model_work_attempts where name in(select 'conversation:'||m.id::text from fmat.runtime_messages m join fmat.conversation_scopes s on s.id=m.conversation_id where s.host_id='${host}');delete from fmat.model_budgets where name='host:${host}';delete from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_scopes where host_id='${host}';delete from fmat.idempotency where actor_scope='host:${host}';delete from fmat.audit_events where subject_id in('${host}',${q(scope)});delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invitation}';`);const removed=await fetch(local.API_URL+'/auth/v1/admin/users/'+host,{method:'DELETE',headers:admin});assert.equal(removed.status,200);}}
  finally{sql.close();}
 }
});
