import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalSql} from './local-sql.ts';

const q=(s:string)=>`'${s.replaceAll("'","''")}'`;
async function blocked(sql:LocalSql,name:string){
 for(let i=0;i<100;i++){if(await sql.query(`select exists(select 1 from pg_stat_activity where application_name=${q(name)} and wait_event_type='Lock');`)==='t')return;await delay(20);}
 assert.fail('budget lock wait was not observed');
}
test('conversation admission serializes cross-scope ceilings and rechecks expiry after quota waits',{timeout:60000},async()=>{
 const admin=new LocalSql(),locker=new LocalSql(),waiter=new LocalSql(),peers=Array.from({length:24},()=>new LocalSql());
 const host=randomUUID(),session=randomUUID(),invite=randomUUID(),email=host+'@quota.test';
 const scopes=Array.from({length:24},()=>({request:randomUUID(),scope:randomUUID(),grant:randomUUID(),client:randomUUID(),hash:randomBytes(32).toString('hex')}));
 const credential={kind:'host',subject:host,sessionId:session,expiresAt:new Date(Date.now()+3600000).toISOString()};
 let saved='[]';
 const accept=(n:number)=>{const row=scopes[n];return `select public.fmat_runtime_message('accept',${q(row.grant)},${q(row.scope)},${q(JSON.stringify({clientId:row.client,text:'quota fixture'}))}::jsonb);`;};
 // Capture a domain denial without terminating the psql connection.
 const attempt=(n:number)=>`do $$begin perform public.fmat_runtime_message('accept',${q(scopes[n].grant)},${q(scopes[n].scope)},${q(JSON.stringify({clientId:scopes[n].client,text:'quota fixture'}))}::jsonb);perform set_config('test.outcome','accepted',false);exception when raise_exception then perform set_config('test.outcome',sqlerrm,false);end$$;select current_setting('test.outcome');`;
 try{
  saved=await admin.query("select coalesce(jsonb_agg(to_jsonb(b)),'[]') from fmat.conversation_budgets b where name='service';");
  await admin.query(`delete from fmat.conversation_budgets where name='service';insert into auth.users(id,email,email_confirmed_at) values(${q(host)},${q(email)},now());insert into auth.sessions(id,user_id) values(${q(session)},${q(host)});insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values(${q(invite)},${q(email)},repeat('a',64),now()+interval '1 day','quota-test');insert into fmat.hosts(id,email,invitation_id) values(${q(host)},${q(email)},${q(invite)});`);
  for(const row of scopes)await admin.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values(${q(row.request)},${q(host)},'{}',${q(row.hash)},now()+interval '1 day');insert into fmat.conversation_scopes(id,host_id,request_id,audience) values(${q(row.scope)},${q(host)},${q(row.request)},'host_private');insert into fmat.conversation_grants(id,conversation_id,actor_kind,authority_key,credential,expires_at) values(${q(row.grant)},${q(row.scope)},'host',${q(session)},${q(JSON.stringify(credential))}::jsonb,now()+interval '1 hour');`);
  const outcomes=await Promise.all(peers.map((sql,n)=>sql.query(attempt(n))));
  assert.equal(outcomes.filter(s=>s==='accepted').length,20);assert.equal(outcomes.filter(s=>s==='CONVERSATION_RATE_LIMIT').length,4);
  assert.equal(await admin.query(`select count(*) from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where host_id=${q(host)});`),'20');
  assert.equal(await admin.query("select minute_used from fmat.conversation_budgets where name='service';"),'20');
  const denied=outcomes.findIndex(s=>s!=='accepted'),accepted=outcomes.findIndex(s=>s==='accepted');
  const first=await admin.query(accept(accepted));assert.ok(JSON.parse(first).id);
  assert.equal(await admin.query("select minute_used from fmat.conversation_budgets where name='service';"),'20','replay does not charge');
  // Service ceiling serializes different request principals, independent of the host ceiling.
  await admin.query(`update fmat.runtime_messages set status='completed' where conversation_id in(select id from fmat.conversation_scopes where host_id=${q(host)});update fmat.conversation_scopes set audience='request_shared' where host_id=${q(host)};update fmat.conversation_budgets set minute_used=198 where name='service';update fmat.conversation_grants set actor_kind='guest',authority_key=r.token_hash,credential=jsonb_build_object('kind','guest','requestId',s.request_id,'tokenHash',r.token_hash) from fmat.conversation_scopes s join fmat.requests r on r.id=s.request_id where s.id=conversation_id and s.host_id=${q(host)};`);
  for(const row of scopes)row.client=randomUUID();
  const serviceOutcomes=await Promise.all(peers.slice(0,8).map((sql,n)=>sql.query(attempt(n))));
  assert.equal(serviceOutcomes.filter(s=>s==='accepted').length,2);assert.equal(serviceOutcomes.filter(s=>s==='CONVERSATION_RATE_LIMIT').length,6);
  // Restore host grants; intentionally exhaust a window and hold the global lock.
  await admin.query(`update fmat.runtime_messages set status='completed' where conversation_id in(select id from fmat.conversation_scopes where host_id=${q(host)});update fmat.conversation_grants set actor_kind='host',authority_key=${q(session)},credential=${q(JSON.stringify(credential))}::jsonb where conversation_id in(select id from fmat.conversation_scopes where host_id=${q(host)});update fmat.conversation_budgets set minute_used=20,minute_started_at=clock_timestamp()-interval '59.5 seconds' where name=${q('host:'+host)};update fmat.conversation_budgets set minute_used=0 where name='service';`);
  const name='quota-wait-'+randomUUID();await waiter.query(`set application_name=${q(name)};`);
  await locker.query("begin;select 1 from fmat.conversation_budgets where name='service' for update;");
  let pending=waiter.query(attempt(denied));await blocked(admin,name);await locker.query('select pg_sleep(0.7);commit;');
  assert.equal(await pending,'accepted','minute resets after a real lock wait');
  assert.equal(await admin.query(`select minute_used from fmat.conversation_budgets where name=${q('host:'+host)};`),'1');
  await admin.query(`update fmat.runtime_messages set status='completed' where conversation_id=${q(scopes[denied].scope)};update fmat.conversation_grants set expires_at=clock_timestamp()+interval '0.5 seconds' where id=${q(scopes[denied].grant)};`);
  scopes[denied].client=randomUUID();const before=await admin.query("select row_to_json(b) from fmat.conversation_budgets b where name='service';");
  await locker.query("begin;select 1 from fmat.conversation_budgets where name='service' for update;");
  pending=waiter.query(attempt(denied));await blocked(admin,name);await locker.query('select pg_sleep(0.7);commit;');
  assert.equal(await pending,'UNAUTHORIZED','grant expires while waiting for quota');
  assert.equal(await admin.query("select row_to_json(b) from fmat.conversation_budgets b where name='service';"),before,'failed authority rolls back both quota charges');
  assert.equal(await admin.query(`select count(*) from fmat.runtime_messages where client_id=${q(scopes[denied].client)};`),'0');
 }finally{
  const cleanup=new LocalSql();
  try{
  await locker.query('rollback;').catch(()=>{});
  await cleanup.query(`delete from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where host_id=${q(host)});delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where host_id=${q(host)});delete from fmat.conversation_scopes where host_id=${q(host)};delete from fmat.requests where host_id=${q(host)};delete from fmat.hosts where id=${q(host)};delete from fmat.invitations where id=${q(invite)};delete from auth.sessions where user_id=${q(host)};delete from auth.users where id=${q(host)};delete from fmat.conversation_budgets where name='service' or name=${q('host:'+host)} or name in (${scopes.map(s=>q('guest:'+s.request)).join(',')});insert into fmat.conversation_budgets select * from jsonb_populate_recordset(null::fmat.conversation_budgets,${q(saved)}::jsonb);`);
  }finally{for(const sql of [cleanup,admin,locker,waiter,...peers])sql.close();}
 }
});
