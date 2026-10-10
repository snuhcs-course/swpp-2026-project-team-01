import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalSql} from './local-sql.ts';

const q=(value:string)=>`'${value.replaceAll("'","''")}'`;
async function blocked(sql:LocalSql,name:string){
 for(let i=0;i<100;i++){if(await sql.query(`select exists(select 1 from pg_stat_activity where application_name=${q(name)} and wait_event_type='Lock');`)==='t')return;await delay(20);}
 assert.fail('reservation lock wait was not observed');
}
test('model reservations serialize work and daily ceilings, preserve restart attempts and recheck expiry',{timeout:60000},async()=>{
 const admin=new LocalSql(),locker=new LocalSql(),waiter=new LocalSql(),peers=Array.from({length:12},()=>new LocalSql());
 const host=randomUUID(),session=randomUUID(),invite=randomUUID(),email=host+'@model.test';
 const scopes=Array.from({length:12},()=>({request:randomUUID(),scope:randomUUID(),grant:randomUUID(),message:randomUUID(),hash:randomBytes(32).toString('hex')}));
 const credential={kind:'host',subject:host,sessionId:session,expiresAt:new Date(Date.now()+3600000).toISOString()};
 let saved='[]';
 const attempt=(n:number)=>{const row=scopes[n];return `do $$begin perform public.fmat_conversation_model_reserve(${q(row.grant)},${q(row.scope)},${q(row.message)},${q('model-'+row.scope)});perform set_config('test.outcome','reserved',false);exception when raise_exception then perform set_config('test.outcome',sqlerrm,false);end$$;select current_setting('test.outcome');`;};
 try{
  saved=await admin.query("select coalesce(jsonb_agg(to_jsonb(b)),'[]') from fmat.model_budgets b where name='service';");
  await admin.query(`delete from fmat.model_budgets where name='service';insert into auth.users(id,email,email_confirmed_at) values(${q(host)},${q(email)},now());insert into auth.sessions(id,user_id) values(${q(session)},${q(host)});insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values(${q(invite)},${q(email)},repeat('a',64),now()+interval '1 day','model-test');insert into fmat.hosts(id,email,invitation_id) values(${q(host)},${q(email)},${q(invite)});`);
  for(const row of scopes)await admin.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values(${q(row.request)},${q(host)},'{}',${q(row.hash)},now()+interval '1 day');insert into fmat.conversation_scopes(id,host_id,request_id,audience,runtime_session_id) values(${q(row.scope)},${q(host)},${q(row.request)},'host_private',${q('model-'+row.scope)});insert into fmat.conversation_grants(id,conversation_id,actor_kind,authority_key,credential,expires_at) values(${q(row.grant)},${q(row.scope)},'host',${q(session)},${q(JSON.stringify(credential))}::jsonb,now()+interval '1 hour');insert into fmat.runtime_messages(id,conversation_id,grant_id,client_id,text) values(${q(row.message)},${q(row.scope)},${q(row.grant)},gen_random_uuid(),'model fixture');`);
  const sameWork=await Promise.all(peers.map(sql=>sql.query(attempt(0))));
  assert.equal(sameWork.filter(v=>v==='reserved').length,8);assert.equal(sameWork.filter(v=>v==='MODEL_LIMIT').length,4);
  const restarted=new LocalSql();try{assert.equal(await restarted.query(attempt(0)),'MODEL_LIMIT','fresh process retains durable work ceiling');}finally{restarted.close();}
  await admin.query(`update fmat.model_budgets set reserved_cents=2880 where name=${q('host:'+host)};`);
  const principal=await Promise.all(peers.slice(1).map((sql,n)=>sql.query(attempt(n+1))));
  assert.equal(principal.filter(v=>v==='reserved').length,2);assert.equal(principal.filter(v=>v==='MODEL_LIMIT').length,9);
  assert.equal(await admin.query("select reserved_cents from fmat.model_budgets where name='service';"),'600','denied concurrent principals did not charge service');
  // Different guest principals compete for only two remaining global calls.
  await admin.query(`update fmat.conversation_scopes set audience='request_shared' where host_id=${q(host)};update fmat.conversation_grants set actor_kind='guest',authority_key=r.token_hash,credential=jsonb_build_object('kind','guest','requestId',s.request_id,'tokenHash',r.token_hash) from fmat.conversation_scopes s join fmat.requests r on r.id=s.request_id where s.id=conversation_id and s.host_id=${q(host)};update fmat.model_budgets set reserved_cents=29880 where name='service';`);
  const service=await Promise.all(peers.slice(1).map((sql,n)=>sql.query(attempt(n+1))));
  assert.equal(service.filter(v=>v==='reserved').length,2);assert.equal(service.filter(v=>v==='MODEL_LIMIT').length,9);
  assert.equal(await admin.query("select reserved_cents from fmat.model_budgets where name='service';"),'30000');
  const index=service.findIndex(v=>v==='MODEL_LIMIT')+1,row=scopes[index];
  const name='model-wait-'+randomUUID();await waiter.query(`set application_name=${q(name)};`);
  await admin.query("update fmat.model_budgets set window_started_at=clock_timestamp()-interval '23 hours 59 minutes 59.5 seconds' where name='service';");
  await locker.query("begin;select 1 from fmat.model_budgets where name='service' for update;");
  let pending=waiter.query(attempt(index));await blocked(admin,name);await locker.query('select pg_sleep(0.7);commit;');
  assert.equal(await pending,'reserved','window resets using time after lock wait');
  assert.equal(await admin.query("select reserved_cents from fmat.model_budgets where name='service';"),'60');
  await admin.query(`update fmat.conversation_grants set expires_at=clock_timestamp()+interval '0.5 seconds' where id=${q(row.grant)};`);
  const before=await admin.query(`select jsonb_build_object('budgets',(select jsonb_agg(b order by name) from fmat.model_budgets b),'work',(select attempts from fmat.model_work_attempts where name=${q('conversation:'+row.message)}));`);
  await locker.query("begin;select 1 from fmat.model_budgets where name='service' for update;");
  pending=waiter.query(attempt(index));await blocked(admin,name);await locker.query('select pg_sleep(0.7);commit;');
  assert.equal(await pending,'UNAUTHORIZED');
  assert.equal(await admin.query(`select jsonb_build_object('budgets',(select jsonb_agg(b order by name) from fmat.model_budgets b),'work',(select attempts from fmat.model_work_attempts where name=${q('conversation:'+row.message)}));`),before,'expiry rolls back every counter');
 }finally{
  const cleanup=new LocalSql();try{
   await locker.query('rollback;').catch(()=>{});
   await cleanup.query(`delete from fmat.model_work_attempts where name in (${scopes.map(s=>q('conversation:'+s.message)).join(',')});delete from fmat.model_budgets where name='service' or name=${q('host:'+host)} or name in (${scopes.map(s=>q('guest:'+s.request)).join(',')});insert into fmat.model_budgets select * from jsonb_populate_recordset(null::fmat.model_budgets,${q(saved)}::jsonb);delete from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where host_id=${q(host)});delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where host_id=${q(host)});delete from fmat.conversation_scopes where host_id=${q(host)};delete from fmat.requests where host_id=${q(host)};delete from fmat.hosts where id=${q(host)};delete from fmat.invitations where id=${q(invite)};delete from auth.sessions where user_id=${q(host)};delete from auth.users where id=${q(host)};`);
  }finally{for(const sql of [cleanup,admin,locker,waiter,...peers])sql.close();}
 }
});
