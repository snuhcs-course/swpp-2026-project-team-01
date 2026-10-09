import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startBrowserRuntime} from './fixture-server.ts';
import {LocalSql} from '../integration/local-sql.ts';

async function fixture(contextWindowTokens:number){
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.ok(['127.0.0.1','localhost'].includes(new URL(local.API_URL).hostname));
 await mkdir('.local/rebuild',{recursive:true});
 const log=resolve('.local/rebuild/model-calls-'+randomUUID()+'.jsonl');
 const runtime=await startBrowserRuntime(local,'http://localhost:3000',undefined,{modelCallLog:log,modelContextWindowTokens:contextWindowTokens});
 const sql=new LocalSql(),host=randomUUID(),invitation=randomUUID(),requests=[randomUUID(),randomUUID()];
 const tokens=requests.map(()=>randomBytes(32).toString('base64url'));
 const headers=(index=0)=>({authorization:'Request '+tokens[index],'x-request-id':requests[index],'content-type':'application/json'});
 const post=(path:string,input:unknown,index=0)=>fetch(runtime.origin+path,{method:'POST',headers:headers(index),body:JSON.stringify(input)});
 const calls=async()=>{try{return (await readFile(log,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line) as {kind:string;inputHash:string});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}};
 const wait=async(predicate:()=>Promise<boolean>,label:string)=>{for(let n=0;n<300;n++){if(await predicate())return;await delay(100);}throw new Error(label);};
 async function cleanup(){
  await runtime.stop();const cleanup=new LocalSql();try{
   await cleanup.query(`delete from fmat.model_work_attempts where name in(select 'conversation:'||m.id::text from fmat.runtime_messages m join fmat.conversation_scopes s on s.id=m.conversation_id where s.host_id='${host}');delete from fmat.model_budgets where name in ('host:${host}',${requests.map(id=>`'guest:${id}'`).join(',')});delete from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_scopes where host_id='${host}';delete from fmat.requests where host_id='${host}';delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invitation}';`);
  }finally{cleanup.close();sql.close();}
 }
 try{
  await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','${host}@model.test','${createHash('sha256').update(invitation).digest('hex')}',now()+interval '1 day','model-runtime-fixture');insert into fmat.hosts(id,email,invitation_id) values('${host}','${host}@model.test','${invitation}');`);
  for(let i=0;i<requests.length;i++)await sql.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values('${requests[i]}','${host}','{}','${createHash('sha256').update(tokens[i]).digest('hex')}',now()+interval '1 day');`);
  const scopes:string[]=[];
  for(let i=0;i<requests.length;i++){const response=await post('/api/conversations',{audience:'request_shared',requestId:requests[i]},i);assert.equal(response.status,200,await response.clone().text());scopes.push((await response.json()).conversationId);}
  const send=async(text:string,index=0)=>{
   const input={clientId:randomUUID(),text};
   // Settlement can precede the runtime continuation becoming resolvable.
   // Recover the accepted input; never generate a replacement retry identity.
   for(let attempt=0;attempt<100;attempt++){
    const response=await post(`/api/conversations/${scopes[index]}/messages`,input,index),body=await response.json();
    if(response.status===409&&body.error?.code==='RECONCILIATION_PENDING'){await delay(100);continue;}
    assert.ok([200,202].includes(response.status),JSON.stringify(body));
    const id=body.messageId as string;
    assert.equal(await sql.query(`select count(*) from fmat.runtime_messages where conversation_id='${scopes[index]}' and client_id='${input.clientId}' and id='${id}';`),'1');
    return {input,id};
   }
   throw new Error('The same compaction input did not recover within the retry bound');
  };
  const status=(id:string)=>sql.query(`select status from fmat.runtime_messages where id='${id}';`);
  return {runtime,sql,requests,scopes,headers,post,calls,wait,send,status,cleanup};
 }catch(error){await cleanup();throw error;}
}

test('real Eve stops an eight-call loop, preserves charges after restart, and settles denied daily allowance',{timeout:90000},async()=>{
 const f=await fixture(100_000);
 try{
  const sent=await f.send('model-limit-loop');
  await f.wait(async()=>await f.status(sent.id)==='failed','bounded loop did not settle as failed');
  assert.equal(await f.sql.query(`select attempts from fmat.model_work_attempts where name='conversation:${sent.id}';`),'8');
  assert.equal((await f.calls()).length,8,'ninth provider invocation never started');
  assert.equal(await f.sql.query(`select revision from fmat.requests where id='${f.requests[0]}';`),'1');
  assert.equal((await f.post(`/api/conversations/${f.scopes[0]}/messages`,sent.input)).status,200);
  await f.runtime.restart();
  assert.equal((await f.post(`/api/conversations/${f.scopes[0]}/messages`,sent.input)).status,200);
  assert.equal((await f.calls()).length,8,'settled retry after restart does not call the provider');
  await f.sql.query(`insert into fmat.model_budgets values('guest:${f.requests[1]}',clock_timestamp(),3000);`);
  const denied=await f.send('daily allowance exhausted',1);
  await f.wait(async()=>await f.status(denied.id)==='failed','daily denial did not settle as failed');
  assert.equal((await f.calls()).length,8,'daily cap stops the first provider call');
  assert.equal(await f.sql.query(`select count(*) from fmat.model_work_attempts where name='conversation:${denied.id}';`),'0');
  const controller=new AbortController(),response=await fetch(f.runtime.origin+`/api/conversations/${f.scopes[1]}/stream`,{headers:f.headers(1),signal:controller.signal});
  assert.equal(response.status,200);const reader=response.body!.getReader();let output='';
  try{while(!output.includes('"type":"failed"')){const part=await reader.read();if(part.done)break;output+=new TextDecoder().decode(part.value);}}finally{controller.abort();}
  assert.match(output,/Your saved changes are preserved/);assert.doesNotMatch(output,/p_grant_id|tokenHash|reserved_cents|model_budgets/);
 }finally{await f.cleanup();}
});

test('automatic Eve compaction uses the same durable reservation boundary',{timeout:90000},async()=>{
 const f=await fixture(6000);
 try{
  const ids:string[]=[];
  for(let index=0;index<5;index++){
   const sent=await f.send('compact-fixture:'+index+' '+'x'.repeat(8500));ids.push(sent.id);
   await f.wait(async()=>await f.status(sent.id)!=='pending','compaction turn did not settle');
   assert.equal(await f.status(sent.id),'completed','compaction must complete under the current message authority');
  }
  const calls=await f.calls();assert.ok(calls.some(call=>call.kind==='compaction'),'fixture actually triggered provider-backed compaction');
  const attempts=Number(await f.sql.query(`select sum(attempts) from fmat.model_work_attempts where name in (${ids.map(id=>`'conversation:${id}'`).join(',')});`));
  assert.equal(attempts,calls.length,'every normal and compaction call is reserved');assert.ok(attempts>ids.length);
  assert.equal(await f.sql.query(`select reserved_cents from fmat.model_budgets where name='guest:${f.requests[0]}';`),String(attempts*60));
 }finally{await f.cleanup();}
});
