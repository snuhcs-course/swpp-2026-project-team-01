import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Database} from '../../lib/server/database/client.ts';
import type {Credential} from '../../lib/server/identity/credentials.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {LocalSql} from './local-sql.ts';

const q=(value:string)=>`'${value.replaceAll("'","''")}'`;
const code=(expected:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===expected;
export async function verifyRankingBudget(database:Database,sql:LocalSql,credential:Credential,hostCredential:Credential,target:{requestId:string;revision:number;checkId:string;basis:string}){
 const host=await sql.query(`select host_id from fmat.requests where id=${q(target.requestId)};`);
 const names=['service','host:'+host,'guest:'+target.requestId];
 const saved=await sql.query(`select coalesce(jsonb_agg(to_jsonb(b)),'[]') from fmat.model_budgets b where name in (${names.map(q).join(',')});`);
 const start=await sql.query(`select availability_check_started_at from fmat.requests where id=${q(target.requestId)};`);
 const locker=new LocalSql(),waiter=new LocalSql(),name='rank-wait-'+randomUUID();
 let pending:Promise<string>|undefined;
 try{
  const snapshot=await database.rpc('fmat_candidate_ranking',{p_operation:'read',p_credential:credential,p_input:target}) as {fingerprint:string;input:{candidates:{id:string}[]}};
  const input={...target,fingerprint:snapshot.fingerprint};
  const reserve=(actor=credential,p_input:unknown=input)=>database.rpc('fmat_candidate_ranking',{p_operation:'reserve',p_credential:actor,p_input});
  await assert.rejects(reserve(credential,{...input,fingerprint:'0'.repeat(64)}),code('STALE_REVISION'));
  const outcomes=await Promise.allSettled(Array.from({length:8},(_,n)=>reserve(n%2?hostCredential:credential)));
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,2);
  assert.equal(outcomes.filter(r=>r.status==='rejected'&&code('MODEL_LIMIT')(r.reason)).length,6);
  assert.equal(await sql.query(`select attempts from fmat.model_work_attempts where name=${q('ranking:'+target.checkId)};`),'2');
  assert.equal(await sql.query(`select count(*) from fmat.candidate_rankings where check_id=${q(target.checkId)};`),'0','reservations alone never create a result');
  // Give this fixture one remaining attempt, then expire its evaluation while
  // the service lock is held. No provider is involved in this database probe.
  await sql.query(`update fmat.model_work_attempts set attempts=1 where name=${q('ranking:'+target.checkId)};update fmat.requests set availability_check_started_at=clock_timestamp()-interval '4 minutes 59.5 seconds' where id=${q(target.requestId)};`);
  const before=await sql.query("select reserved_cents from fmat.model_budgets where name='service';");
  await waiter.query(`set application_name=${q(name)};`);
  await locker.query("begin;select 1 from fmat.model_budgets where name='service' for update;");
  pending=waiter.query(`do $$begin perform public.fmat_candidate_ranking('reserve',${q(JSON.stringify(credential))}::jsonb,${q(JSON.stringify(input))}::jsonb);perform set_config('test.outcome','reserved',false);exception when raise_exception then perform set_config('test.outcome',sqlerrm,false);end$$;select current_setting('test.outcome');`);
  let observed=false;for(let i=0;i<100;i++){if(await sql.query(`select exists(select 1 from pg_stat_activity where application_name=${q(name)} and wait_event_type='Lock');`)==='t'){observed=true;break;}await delay(20);}
  assert.ok(observed,'ranking actually waits for service allowance');
  await locker.query('select pg_sleep(0.7);commit;');assert.equal(await pending,'REVISION_CONFLICT');
  assert.equal(await sql.query("select reserved_cents from fmat.model_budgets where name='service';"),before);
  assert.equal(await sql.query(`select attempts from fmat.model_work_attempts where name=${q('ranking:'+target.checkId)};`),'1','expiry rolls back the attempted charge');
  await sql.query(`update fmat.requests set availability_check_started_at=${q(start)} where id=${q(target.requestId)};`);
  await database.rpc('fmat_candidate_ranking',{p_operation:'save',p_credential:credential,p_input:{...input,orderedIds:snapshot.input.candidates.map(c=>c.id)}});
  await assert.rejects(reserve(),code('STALE_REVISION'));
  assert.equal(await sql.query("select reserved_cents from fmat.model_budgets where name='service';"),before,'saved result cannot authorize another provider attempt');
 }finally{
  const cleanup=new LocalSql();try{
   await locker.query('rollback;').catch(()=>{});await pending?.catch(()=>{});
   await cleanup.query(`update fmat.requests set availability_check_started_at=${q(start)} where id=${q(target.requestId)};delete from fmat.model_work_attempts where name=${q('ranking:'+target.checkId)};delete from fmat.model_budgets where name in (${names.map(q).join(',')});insert into fmat.model_budgets select * from jsonb_populate_recordset(null::fmat.model_budgets,${q(saved)}::jsonb);`);
  }finally{cleanup.close();locker.close();waiter.close();}
 }
}
