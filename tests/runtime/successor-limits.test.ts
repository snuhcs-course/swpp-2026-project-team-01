import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startBrowserRuntime} from './fixture-server.ts';
import {LocalSql} from '../integration/local-sql.ts';
import {Database} from '../../lib/server/database/client.ts';
import {HostSetup} from '../../lib/server/setup/commands.ts';
import {verifyHostToken} from '../../lib/server/identity/credentials.ts';
const q=(value:string)=>`'${value.replaceAll("'","''")}'`;

for(const axis of ['input','output'])test(`successor retains cumulative ${axis} allowance after process restart`,{timeout:150000},async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.ok(['127.0.0.1','localhost'].includes(new URL(local.API_URL).hostname));
 const sql=new LocalSql(),invitation=randomUUID(),email=randomUUID()+'@successor-limit.test',password=randomUUID()+randomUUID();
 const admin={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'};
 const env={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY};
 const log=resolve('.local/rebuild/successor-limit-'+randomUUID()+'.jsonl');
 let host='',scope='',runtime:Awaited<ReturnType<typeof startBrowserRuntime>>|undefined;
 try{
  const created=await fetch(local.API_URL+'/auth/v1/admin/users',{method:'POST',headers:admin,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(created.status,200);host=(await created.json()).id;
  const login=await fetch(local.API_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:local.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);const token=(await login.json()).access_token;
  await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','${email}','${createHash('sha256').update(invitation).digest('hex')}',now()+interval '1 day','successor-limit');insert into fmat.hosts(id,email,invitation_id) values('${host}','${email}','${invitation}');`);
  const setup=new HostSetup(new Database(env)),credential=await verifyHostToken(token,{env}),saved=await setup.read(credential);
  const usageLog=log+'.usage',preload=log+'.mjs';
  await writeFile(preload,`import {appendFileSync,existsSync,writeFileSync} from 'node:fs';const original=globalThis.fetch;
globalThis.fetch=async(url,init)=>{
 if(String(url).endsWith('/rpc/fmat_conversation_model_reserve')){const p=JSON.parse(init.body);appendFileSync(${JSON.stringify(usageLog)},JSON.stringify({usage:p.p_usage})+'\\n');}
 const response=await original(url,init);
 if(String(url).endsWith('/rpc/fmat_conversation_model_usage')&&response.ok&&!existsSync(${JSON.stringify(usageLog+'.lost')})){
  const p=JSON.parse(init.body);if(p.p_usage.inputTokens===1&&p.p_usage.outputTokens===1){writeFileSync(${JSON.stringify(usageLog+'.lost')},'lost committed usage receipt');return Response.json({message:'synthetic response loss'},{status:503});}
 }
 return response;
};`);
  runtime=await startBrowserRuntime(local,'http://localhost:3000',undefined,{preload,terminalInspection:true,legacyAuthenticationFailure:true,modelCallLog:log,modelContextWindowTokens:1_000_000});
  const headers={authorization:'Bearer '+token,'content-type':'application/json'};
  const post=(path:string,body:unknown)=>fetch(runtime!.origin+path,{method:'POST',headers,body:JSON.stringify(body)});
  const opened=await post('/api/conversations',{audience:'host_setup'});assert.equal(opened.status,200);scope=(await opened.json()).conversationId;
  const send=async(text:string)=>{
   const input={text,clientId:randomUUID()};
   for(let n=0;n<200;n++){
    const response=await post(`/api/conversations/${scope}/messages`,input),body=await response.json();
    if(response.status===409&&body.error?.code==='RECONCILIATION_PENDING'){await delay(100);continue;}
    assert.ok([200,202].includes(response.status),JSON.stringify(body));return body.messageId as string;
   }
   throw new Error('Same accepted input did not reconcile after restart');
  };
  const settle=async(id:string,status:string)=>{
   for(let n=0;n<400;n++){if(await sql.query(`select status from fmat.runtime_messages where id=${q(id)};`)!=='pending')break;await delay(100);}
   assert.equal(await sql.query(`select status from fmat.runtime_messages where id=${q(id)};`),status);
  };
  await settle(await send(`usage-${axis}-near-limit`),'completed');
  const failed=await send('setup-provider-authentication');await settle(failed,'failed');
  let terminal;
  for(let n=0;n<100;n++){
   const inspected:Response=await fetch(runtime.origin+`/test/runtime/terminal/${scope}`,{headers});assert.equal(inspected.status,200);
   terminal=await inspected.json();if(terminal.state==='failed')break;await delay(50);
  }
  assert.equal(terminal.state,'failed','Wait for the actual failed workflow to release its address after input settlement');
  assert.equal(terminal.evidence.usage[axis+'Tokens'],axis==='input'?99999:7999,'Retained count comes from actual eve terminal evidence');
  const input={text:'usage-small-step',clientId:randomUUID()};
  const pending=await post(`/api/conversations/${scope}/messages`,input);assert.equal(pending.status,409);
  const row=JSON.parse(await sql.query(`select jsonb_build_object('id',id,'grantId',grant_id) from fmat.runtime_messages where conversation_id=${q(scope)} and status='pending';`));
  await sql.query(`select fmat.conversation_recovery_begin(${q(row.grantId)},${q(scope)},${q(JSON.stringify({expectedGeneration:0,idempotencyKey:randomUUID(),evidence:terminal.evidence}))}::jsonb);`);
  assert.equal((await post(`/api/conversations/${scope}/messages`,input)).status,202);await settle(row.id,'completed');
  const canonical=await sql.query(`select runtime_session_id from fmat.conversation_scopes where id=${q(scope)};`);
  assert.notEqual(canonical,terminal.evidence.sessionId);
  assert.equal(await sql.query(`select attempts from fmat.model_work_attempts where name=${q('conversation:'+failed)};`),'1','failed original attempt remains charged');
  const calls=()=>readFile(log,'utf8').then(data=>data.trim().split('\n').filter(Boolean).length);
  const before=await calls();assert.equal(before,3);
  assert.equal(await sql.query(`select ${axis}_tokens from fmat.conversation_model_usage where conversation_id=${q(scope)} and generation=1;`),'1','Provider usage is durable before successful input settlement');
  assert.equal(await readFile(usageLog+'.lost','utf8'),'lost committed usage receipt');
  await runtime.restart();
  const denied=await send('This must not reach the model');await settle(denied,'failed');
  assert.equal(await calls(),before,'Cumulative allowance denies provider work after restart');
  assert.equal(await sql.query(`select count(*) from fmat.model_work_attempts where name=${q('conversation:'+denied)};`),'0','denied call does not add or refund a reservation');
  assert.equal(await sql.query(`select runtime_session_id from fmat.conversation_scopes where id=${q(scope)};`),canonical);
  assert.equal(await sql.query(`select runtime_generation from fmat.conversation_scopes where id=${q(scope)};`),'1');
  assert.deepEqual(await setup.read(credential),saved,'structured setup controls remain available and unchanged');
  const history=await fetch(runtime.origin+`/api/conversations/${scope}`,{headers});assert.equal(history.status,200);
  assert.ok((await history.json()).messages.some((message:{id:string})=>message.id===row.id),'accepted history remains accessible');
  assert.equal((await post(`/api/conversations/${scope}/messages`,input)).status,200);assert.equal(await calls(),before);
 }finally{
  await runtime?.stop();
  try{if(host){await sql.query(`delete from fmat.conversation_recoveries where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_generations where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.model_work_attempts where name in(select 'conversation:'||m.id::text from fmat.runtime_messages m join fmat.conversation_scopes s on s.id=m.conversation_id where s.host_id='${host}');delete from fmat.model_budgets where name='host:${host}';delete from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_scopes where host_id='${host}';delete from fmat.idempotency where actor_scope='host:${host}';delete from fmat.audit_events where subject_id in('${host}',${q(scope)});delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invitation}';`);const removed=await fetch(local.API_URL+'/auth/v1/admin/users/'+host,{method:'DELETE',headers:admin});assert.equal(removed.status,200);}}
  finally{sql.close();}
 }
});
