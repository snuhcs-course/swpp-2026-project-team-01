import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {startBrowserRuntime} from './fixture-server.ts';
import {LocalSql} from '../integration/local-sql.ts';
import {Database} from '../../lib/server/database/client.ts';
import {HostSetup} from '../../lib/server/setup/commands.ts';
import {verifyHostToken} from '../../lib/server/identity/credentials.ts';

const outcomes=[['setup-provider-outage','failed'],['setup-provider-timeout','failed'],['setup-provider-missing-key','failed'],['setup-provider-authentication','failed'],['setup-provider-rate-limit','failed'],['setup-provider-credit-exhausted','failed'],['setup-provider-refusal','completed']] as const;
for(const [text,status] of outcomes)test(`real host runtime preserves saved setup for ${text}`,{timeout:150000},async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.ok(['127.0.0.1','localhost'].includes(new URL(local.API_URL).hostname));
 const sql=new LocalSql(),invitation=randomUUID(),email=randomUUID()+'@setup-runtime.test',password=randomUUID()+randomUUID();
 const admin={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'};
 const env={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY};
 let host='',runtime:Awaited<ReturnType<typeof startBrowserRuntime>>|undefined;
 try{
  const created=await fetch(local.API_URL+'/auth/v1/admin/users',{method:'POST',headers:admin,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(created.status,200);host=(await created.json()).id;
  const login=await fetch(local.API_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:local.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);const token=(await login.json()).access_token;
  await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','${email}','${createHash('sha256').update(invitation).digest('hex')}',now()+interval '1 day','setup-runtime');insert into fmat.hosts(id,email,invitation_id) values('${host}','${email}','${invitation}');`);
  const setup=new HostSetup(new Database(env)),credential=await verifyHostToken(token,{env});
  const saved=await setup.draft(credential,{expectedRevision:0,idempotencyKey:randomUUID(),patch:{displayName:'Existing draft',rules:{timezone:'Asia/Seoul',bufferMinutes:10}},unresolved:['Meeting hours still needed']});
  runtime=await startBrowserRuntime(local,'http://localhost:3000',undefined,{terminalInspection:true});
  const headers={authorization:'Bearer '+token,'content-type':'application/json'};
  const post=(path:string,body:unknown)=>fetch(runtime!.origin+path,{method:'POST',headers,body:JSON.stringify(body)});
  const opened=await post('/api/conversations',{audience:'host_setup'});assert.equal(opened.status,200);const scope=(await opened.json()).conversationId;
   const input={text,clientId:randomUUID()};let id='';
   for(let attempt=0;attempt<100;attempt++){
    const response=await post(`/api/conversations/${scope}/messages`,input),body=await response.json();
    if(response.status===409&&body.error?.code==='RECONCILIATION_PENDING'){await delay(100);continue;}
    assert.ok([200,202].includes(response.status),JSON.stringify(body));id=body.messageId;break;
   }
   assert.ok(id,'Expected accepted input for '+text);
   for(let attempt=0;attempt<400;attempt++){
    if(await sql.query(`select status from fmat.runtime_messages where id='${id}';`)!=='pending')break;
    await delay(100);
   }
   assert.equal(await sql.query(`select status from fmat.runtime_messages where id='${id}';`),status);
   assert.deepEqual(await setup.read(credential),saved,'Provider outcome must not edit draft, provenance, clarifications, review or confirmed policy');
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
   const stream:Response=await fetch(runtime.origin+`/api/conversations/${scope}/stream`,{headers,signal:controller.signal});assert.equal(stream.status,200);
   const reader=stream.body!.getReader();let output='';
   const expected=status==='failed'?'Your saved changes are preserved':'I cannot provide a setup suggestion.';
   const currentOutcome=()=>output.includes(text)&&output.slice(output.indexOf(text)).includes(expected);
   try{while(!currentOutcome()){const part=await reader.read();if(part.done)break;output+=new TextDecoder().decode(part.value);}}
   finally{clearTimeout(timer);controller.abort();await reader.cancel().catch(()=>{});}
   assert.ok(currentOutcome(),'Stream must include this input followed by its own terminal feedback');
   assert.doesNotMatch(output,/synthetic-private-provider-detail|synthetic-private-timeout-detail/);
   const attempts=await sql.query(`select attempts from fmat.model_work_attempts where name='conversation:${id}';`);
   assert.ok(Number(attempts)>=1&&Number(attempts)<=8,'Provider failures remain within the durable per-input allowance');
   assert.equal((await post(`/api/conversations/${scope}/messages`,input)).status,200,'Settled replay returns the existing outcome');
   assert.equal(await sql.query(`select attempts from fmat.model_work_attempts where name='conversation:${id}';`),attempts,'Settled replay cannot invoke another provider step');
   if(['setup-provider-authentication','setup-provider-missing-key','setup-provider-credit-exhausted'].includes(text)){
    const canonical=await sql.query(`select runtime_session_id from fmat.conversation_scopes where id='${scope}';`);
    const inspection=await fetch(runtime.origin+`/test/runtime/terminal/${scope}`,{headers});
    assert.equal(inspection.status,200);assert.deepEqual(await inspection.json(),{state:'active'},'Configuration failure leaves the canonical workflow resumable');
    assert.equal((await fetch(runtime.origin+`/test/runtime/terminal/${scope}`)).status,401,'Inspection requires current participant authority');
    const followup=await post(`/api/conversations/${scope}/messages`,{text:'Explicitly continue after configuration correction',clientId:randomUUID()});
    assert.ok([200,202].includes(followup.status));const continued=(await followup.json()).messageId;assert.ok(continued);
    for(let attempt=0;attempt<400;attempt++){
     if(await sql.query(`select status from fmat.runtime_messages where id='${continued}';`)!=='pending')break;
     await delay(100);
    }
    assert.equal(await sql.query(`select status from fmat.runtime_messages where id='${continued}';`),'completed');
    assert.equal(await sql.query(`select runtime_session_id from fmat.conversation_scopes where id='${scope}';`),canonical);
    assert.equal(await sql.query(`select runtime_generation from fmat.conversation_scopes where id='${scope}';`),'0');
    assert.equal(await sql.query(`select attempts from fmat.model_work_attempts where name='conversation:${id}';`),attempts,'Later continuation cannot refund or replay the failed input');
    assert.deepEqual(await setup.read(credential),saved);
   }
   if(text==='setup-provider-refusal'){
    const inspection=await fetch(runtime.origin+`/test/runtime/terminal/${scope}`,{headers});
    assert.equal(inspection.status,200);assert.deepEqual(await inspection.json(),{state:'active'},'A waiting workflow cannot authorize replacement');
   }
 }finally{
  await runtime?.stop();
  try{if(host){await sql.query(`delete from fmat.model_work_attempts where name in(select 'conversation:'||m.id::text from fmat.runtime_messages m join fmat.conversation_scopes s on s.id=m.conversation_id where s.host_id='${host}');delete from fmat.model_budgets where name='host:${host}';delete from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_scopes where host_id='${host}';delete from fmat.idempotency where actor_scope='host:${host}';delete from fmat.audit_events where subject_id='${host}';delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invitation}';`);const removed=await fetch(local.API_URL+'/auth/v1/admin/users/'+host,{method:'DELETE',headers:admin});assert.equal(removed.status,200);}}
  finally{sql.close();}
 }
});
