import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {startBrowserRuntime} from './fixture-server.ts';
import {LocalSql} from '../integration/local-sql.ts';

test('managed terminal diagnostic model uses real recovery, archive and draft boundaries locally',{timeout:120000},async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const sql=new LocalSql(),host=randomUUID(),invitation=randomUUID(),request=randomUUID(),token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex');
 const admin={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'};
 let runtime:Awaited<ReturnType<typeof startBrowserRuntime>>|undefined,scope='';
 try{
  assert.equal((await fetch(local.API_URL+'/auth/v1/admin/users',{method:'POST',headers:admin,body:JSON.stringify({id:host,email:`managed-terminal-${host}@example.test`,email_confirm:true})})).status,200);
  await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','managed-terminal-${host}@example.test','${hash}',now()+interval '1 day','managed-terminal-local');insert into fmat.hosts(id,email,invitation_id) values('${host}','managed-terminal-${host}@example.test','${invitation}');insert into fmat.requests(id,host_id,details,token_hash,expires_at) values('${request}','${host}','{}','${hash}',now()+interval '1 day');`);
  runtime=await startBrowserRuntime(local,'http://localhost:3000',undefined,{managedTerminal:{hostId:host,requestId:request}});
  const headers={authorization:'Request '+token,'x-request-id':request,'content-type':'application/json'};
  const post=(path:string,body:unknown)=>fetch(runtime!.origin+path,{method:'POST',headers,body:JSON.stringify(body)});
  const opened=await post('/api/conversations',{audience:'request_shared',requestId:request});assert.equal(opened.status,200);scope=(await opened.json()).conversationId;
  async function send(text:string,status:string){const response=await post(`/api/conversations/${scope}/messages`,{text,clientId:randomUUID()});assert.ok([200,202].includes(response.status));const {messageId}=await response.json();for(let n=0;n<200;n++){if(await sql.query(`select status from fmat.runtime_messages where id='${messageId}';`)!=='pending')break;await delay(100);}assert.equal(await sql.query(`select status from fmat.runtime_messages where id='${messageId}';`),status);}
  await send('managed-terminal-archive','completed');await send('managed-terminal-authentication','failed');
  // Input failure is settled before eve releases its session address and
  // persists the terminal stream tail. Wait for the actual recovery boundary;
  // never infer terminality from the domain message's earlier failed status.
  let terminalState='active';const terminalDeadline=Date.now()+20_000;
  while(Date.now()<terminalDeadline){
   const status:Response=await fetch(runtime.origin+`/api/conversations/${scope}/recovery`,{headers,signal:AbortSignal.timeout(10_000)});
   assert.equal(status.status,200);const observed=await status.json();assert.equal(observed.generation,0);
   terminalState=observed.state;
   assert.ok(['active','unavailable','recovery_required'].includes(terminalState),terminalState);
   if(terminalState==='recovery_required')break;
   await delay(100);
  }
  assert.equal(terminalState,'recovery_required','The bound workflow must have verified terminal evidence before recovery');
  const recovery=await post(`/api/conversations/${scope}/recovery`,{expectedGeneration:0,idempotencyKey:randomUUID()});assert.equal(recovery.status,200);assert.equal((await recovery.json()).generation,1);
  await send('managed-terminal-recover','completed');
  assert.equal(await sql.query(`select count(*) from fmat.request_detail_reviews where request_id='${request}';`),'2');
  assert.equal(await sql.query(`select revision from fmat.requests where id='${request}';`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.conversation_recoveries where conversation_id='${scope}';`),'1');
  assert.equal(await sql.query(`select input_tokens>=100 and output_tokens>=10 from fmat.conversation_generations where conversation_id='${scope}' and generation=0;`),'t');
  assert.equal(await sql.query(`select count(*) from fmat.booking_attempts where request_id='${request}';`),'0');
 }finally{
  await runtime?.stop();
  try{await sql.query(`delete from fmat.conversation_recoveries where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_generations where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.model_work_attempts where name in(select 'conversation:'||m.id::text from fmat.runtime_messages m join fmat.conversation_scopes s on s.id=m.conversation_id where s.host_id='${host}');delete from fmat.model_budgets where name in('host:${host}','guest:${request}');delete from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_scopes where host_id='${host}';delete from fmat.idempotency where actor_scope='guest:${hash}';delete from fmat.audit_events where subject_id in('${host}','${request}','${scope}');delete from fmat.request_history where request_id='${request}';delete from fmat.requests where id='${request}';delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invitation}';`);assert.equal((await fetch(local.API_URL+'/auth/v1/admin/users/'+host,{method:'DELETE',headers:admin})).status,200);}finally{sql.close();}
 }
});
