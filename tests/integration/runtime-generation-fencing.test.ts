import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalSql} from './local-sql.ts';
const q=(s:string)=>`'${s.replaceAll("'","''")}'`;
async function blocked(sql:LocalSql,names:string[]){
 for(let n=0;n<100;n++){
  if(Number(await sql.query(`select count(*) from pg_stat_activity where application_name in(${names.map(q).join(',')}) and wait_event_type='Lock';`))===names.length)return;
  await delay(20);
 }
 assert.fail('Expected every retired operation to wait on the recovery transaction');
}
test('runtime fencing serializes committed tools and queued obsolete execution with recovery',{timeout:45000},async()=>{
 const admin=new LocalSql(),locker=new LocalSql(),waiter=new LocalSql(),peers=Array.from({length:6},()=>new LocalSql());
 const host=randomUUID(),session=randomUUID(),invitation=randomUUID(),scope=randomUUID(),grant=randomUUID(),message=randomUUID(),email=host+'@fencing.test';
 const credential={kind:'host',subject:host,sessionId:session,expiresAt:new Date(Date.now()+3600000).toISOString()};
 const original='original-'+scope,successor='successor-'+scope;
 const draft={expectedRevision:0,patch:{displayName:'One committed draft'},unresolved:[],idempotencyKey:'fence-'+message};
 const tool=(id:string)=>`public.fmat_conversation_tool(${q(grant)},${q(scope)},'setup_draft',${q(JSON.stringify(draft))}::jsonb,${q(id)})`;
 const recovery=(generation:number,id:string)=>`fmat.conversation_recovery_begin(${q(grant)},${q(scope)},${q(JSON.stringify({expectedGeneration:generation,idempotencyKey:randomUUID(),evidence:{generation,sessionId:id,eventId:'event-'+id,tailIndex:20,usage:{inputTokens:20,outputTokens:2,cacheReadTokens:0,cacheWriteTokens:0}}}))}::jsonb)`;
 const attempt=(call:string)=>`do $$begin perform ${call};perform set_config('test.outcome','unexpected-success',false);exception when raise_exception then perform set_config('test.outcome',sqlerrm,false);end$$;select current_setting('test.outcome');`;
 try{
  await admin.query(`insert into auth.users(id,email,email_confirmed_at) values(${q(host)},${q(email)},now());insert into auth.sessions(id,user_id) values(${q(session)},${q(host)});insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values(${q(invitation)},${q(email)},${q(createHash('sha256').update(invitation).digest('hex'))},now()+interval '1 day','fencing-fixture');insert into fmat.hosts(id,email,invitation_id) values(${q(host)},${q(email)},${q(invitation)});insert into fmat.conversation_scopes(id,host_id,audience,runtime_session_id) values(${q(scope)},${q(host)},'host_setup',${q(original)});insert into fmat.conversation_grants(id,conversation_id,actor_kind,authority_key,credential,expires_at) values(${q(grant)},${q(scope)},'host',${q(session)},${q(JSON.stringify(credential))}::jsonb,now()+interval '1 hour');insert into fmat.runtime_messages(id,conversation_id,grant_id,client_id,text) values(${q(message)},${q(scope)},${q(grant)},gen_random_uuid(),'Keep my input');insert into fmat.model_work_attempts values(${q('conversation:'+message)},3);`);
  const waitName='tool-before-recovery-'+scope;await waiter.query(`set application_name=${q(waitName)};`);
  // A tool that owns the runtime lock commits before recovery can retire it.
  const committed=await locker.query(`begin;select ${tool(original)};`);
  const recovering=waiter.query(`select ${recovery(0,original)};`);await blocked(admin,[waitName]);
  assert.equal(await admin.query(`select runtime_generation from fmat.conversation_scopes where id=${q(scope)};`),'0');
  await locker.query('commit;');assert.equal(JSON.parse(await recovering).generation,1);
  // Future leased binding is simulated explicitly; no runtime creation occurs.
  await admin.query(`update fmat.conversation_scopes set runtime_session_id=${q(successor)} where id=${q(scope)};update fmat.conversation_generations set runtime_session_id=${q(successor)} where conversation_id=${q(scope)} and generation=1;`);
  assert.equal(await admin.query(`select ${tool(successor)};`),committed,'successor reuses the exact already-committed mutation');
  const lease=randomUUID();await admin.query(`update fmat.runtime_messages set dispatch_token=${q(lease)},dispatch_until=clock_timestamp()+interval '90 seconds',dispatch_generation=1 where id=${q(message)};`);
  const messageBefore=await admin.query(`select to_jsonb(m) from fmat.runtime_messages m where id=${q(message)};`);
  const draftBefore=await admin.query(`select coalesce(jsonb_agg(to_jsonb(d)),'[]') from fmat.setup_drafts d where conversation_id in(select id from fmat.setup_conversations where host_id=${q(host)});`);
  await locker.query(`begin;select ${recovery(1,successor)};`);
  const calls=[
   [tool(successor),'FORBIDDEN'],
   [`public.fmat_conversation_tool(${q(grant)},${q(scope)},'context_read','{}')`,'FORBIDDEN'],
   [`public.fmat_conversation_model_reserve(${q(grant)},${q(scope)},${q(message)},${q(successor)})`,'FORBIDDEN'],
   [`public.fmat_runtime_message('deliver',${q(grant)},${q(scope)},jsonb_build_object('messageId',${q(message)},'sessionId',${q(successor)}))`,'RECONCILIATION_PENDING'],
   [`public.fmat_runtime_message('settle',${q(grant)},${q(scope)},jsonb_build_object('messageId',${q(message)},'sessionId',${q(successor)},'status','completed'))`,'FORBIDDEN'],
   [`public.fmat_runtime_dispatch('finish',jsonb_build_object('messageId',${q(message)},'leaseToken',${q(lease)},'outcome','revoked'))`,'LEASE_LOST'],
  ];
  const names=peers.map((_,n)=>'fence-'+n+'-'+scope);
  for(let n=0;n<peers.length;n++)await peers[n].query(`set application_name=${q(names[n])};`);
  const queued=peers.map((sql,n)=>sql.query(attempt(calls[n][0])));
  await blocked(admin,names);await locker.query('commit;');
  assert.deepEqual(await Promise.all(queued),calls.map(c=>c[1]),'every old operation rechecks the generation after waiting');
  assert.equal(await admin.query(`select to_jsonb(m) from fmat.runtime_messages m where id=${q(message)};`),messageBefore,'old dispatcher and settlement preserve pending successor input');
  assert.equal(await admin.query(`select coalesce(jsonb_agg(to_jsonb(d)),'[]') from fmat.setup_drafts d where conversation_id in(select id from fmat.setup_conversations where host_id=${q(host)});`),draftBefore,'retired tool does not change saved draft');
  assert.equal(await admin.query(`select attempts from fmat.model_work_attempts where name=${q('conversation:'+message)};`),'3','retired provider work is not reserved');
  assert.equal(await admin.query(`select runtime_generation from fmat.conversation_scopes where id=${q(scope)};`),'2');
 }finally{
  await locker.query('rollback;').catch(()=>{});
  const cleanup=new LocalSql();
  try{await cleanup.query(`delete from fmat.conversation_recoveries where conversation_id=${q(scope)};delete from fmat.conversation_generations where conversation_id=${q(scope)};delete from fmat.runtime_messages where conversation_id=${q(scope)};delete from fmat.conversation_grants where conversation_id=${q(scope)};delete from fmat.conversation_scopes where id=${q(scope)};delete from fmat.model_work_attempts where name=${q('conversation:'+message)};delete from fmat.idempotency where actor_scope=${q('host:'+host)};delete from fmat.audit_events where subject_id in(${q(host)},${q(scope)});delete from fmat.hosts where id=${q(host)};delete from fmat.invitations where id=${q(invitation)};delete from auth.sessions where user_id=${q(host)};delete from auth.users where id=${q(host)};`);}
  finally{for(const sql of [admin,locker,waiter,cleanup,...peers])sql.close();}
 }
});
