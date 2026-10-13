import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
import {LocalSql} from './local-sql.ts';
const q=(value:string)=>`'${value.replaceAll("'","''")}'`;

test('intake admission serializes host/service ceilings and checks rollover after lock waits',async()=>{
 const db=new LocalSql(),lock=new LocalSql(),wait=new LocalSql(),peers=Array.from({length:8},()=>new LocalSql());
 const hosts=[randomUUID(),randomUUID()],invitations=[randomUUID(),randomUUID()],name=`intake-budget-${randomUUID()}`;
 let saved:string|undefined;
 const take=(host:string)=>`select fmat.oauth_intake_take_budget(${q(host)});`;
 try{
  saved=await db.query("select coalesce(jsonb_agg(to_jsonb(b)),'[]') from fmat.oauth_intake_budgets b;");
  await db.query('delete from fmat.oauth_intake_budgets;');
  for(const [i,host] of hosts.entries()){
   const email=`intake-${host}@example.test`,hash=createHash('sha256').update(host).digest('hex');
   await db.query(`insert into auth.users(id,email,email_confirmed_at) values(${q(host)},${q(email)},now());insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values(${q(invitations[i])},${q(email)},${q(hash)},now()+interval '1 day','intake-budget');insert into fmat.hosts(id,email,invitation_id) values(${q(host)},${q(email)},${q(invitations[i])});`);
  }
  assert.equal(await db.query(take(hosts[0])),'t');
  await db.query(`update fmat.oauth_intake_budgets set used=28 where bucket=${q('host:'+hosts[0])};`);
  const hostResults=await Promise.all(peers.map(p=>p.query(take(hosts[0]))));
  assert.equal(hostResults.filter(value=>value==='t').length,2);assert.equal(hostResults.filter(value=>value==='f').length,6);
  assert.equal(await db.query("select used from fmat.oauth_intake_budgets where bucket='service';"),'3');
  await db.query("update fmat.oauth_intake_budgets set used=298 where bucket='service';");
  const serviceResults=await Promise.all(peers.map(p=>p.query(take(hosts[1]))));
  assert.equal(serviceResults.filter(value=>value==='t').length,2);assert.equal(serviceResults.filter(value=>value==='f').length,6);
  assert.equal(await db.query("select used from fmat.oauth_intake_budgets where bucket='service';"),'300');
  assert.equal(await db.query(`select used from fmat.oauth_intake_budgets where bucket=${q('host:'+hosts[1])};`),'2');

  await wait.query(`set application_name=${q(name)};begin;`);
  await lock.query("begin;select 1 from fmat.oauth_intake_budgets where bucket='service' for update;");
  let settled=false;
  const pending=wait.query(take(hosts[1])).finally(()=>{settled=true;});
  // Attach a rejection handler before observing another connection; always
  // release the lock in finally so a failed observation cannot strand a query.
  void pending.catch(()=>{});
  let observed=false;
  try{
   for(let n=0;n<60;n++){
    if(settled){await pending;throw Error('Intake admission did not wait on the service lock');}
    if(await db.query(`select exists(select 1 from pg_stat_activity where application_name=${q(name)} and wait_event_type='Lock');`)==='t'){observed=true;break;}
    await setTimeout(50);
   }
   assert.ok(observed,'observed actual service-budget lock wait');
   // Move the boundary after the waiting transaction started, then let wall
   // time cross it. now() would retain the exhausted old window.
   await lock.query("update fmat.oauth_intake_budgets set window_started_at=clock_timestamp()-interval '59 minutes 59.8 seconds' where bucket='service';select pg_sleep(0.3);commit;");
   assert.equal(await pending,'t');
   await wait.query('commit;');
   assert.equal(await db.query("select used from fmat.oauth_intake_budgets where bucket='service';"),'1');
  }finally{
   await lock.query('rollback;').catch(()=>{});
   await pending.catch(()=>{});
   await wait.query('rollback;').catch(()=>{});
  }
 }finally{
  try{
   await lock.query('rollback;').catch(()=>{});await wait.query('rollback;').catch(()=>{});
   if(saved!==undefined)await db.query(`delete from fmat.oauth_intake_budgets;insert into fmat.oauth_intake_budgets select * from jsonb_populate_recordset(null::fmat.oauth_intake_budgets,${q(saved)}::jsonb);`);
   await db.query(`delete from fmat.hosts where id in(${hosts.map(q).join(',')});delete from fmat.invitations where id in(${invitations.map(q).join(',')});delete from auth.users where id in(${hosts.map(q).join(',')});`);
  }finally{for(const sql of [db,lock,wait,...peers])sql.close();}
 }
});
