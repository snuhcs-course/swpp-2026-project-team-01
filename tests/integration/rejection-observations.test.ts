import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {LocalSql} from './local-sql.ts';
import {rejectionSnapshot} from '../../lib/contracts/rejection-observations.ts';

test('concurrent accepted rejection observations count once and lock timeout does not mutate domain state',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const headers={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'};
 const sql=new LocalSql(),locker=new LocalSql();
 const record=()=>fetch(local.API_URL+'/rest/v1/rpc/fmat_rejection_record',{method:'POST',headers,body:'{"p_category":"stale_action"}'});
 const inspect=async()=>{const r=await fetch(local.API_URL+'/rest/v1/rpc/fmat_rejection_snapshot',{method:'POST',headers,body:'{}'});assert.equal(r.status,200);return rejectionSnapshot.parse(await r.json());};
 // Save/restore only this test's two aggregate categories; the suite runs serially.
 const prior=await sql.query('select coalesce(jsonb_agg(to_jsonb(c)),\'[]\') from fmat.rejection_counters c;');
 const domain=await sql.query('select jsonb_build_object(\'jobs\',(select count(*) from fmat.jobs),\'reservations\',(select count(*) from fmat.host_reservations),\'audit\',(select count(*) from fmat.audit_events));');
 try{
  await sql.query('truncate fmat.rejection_counters;');
  const results=await Promise.all(Array.from({length:12},()=>record()));
  const accepted=results.filter(r=>r.ok).length;assert.ok(accepted>0);
  for(const r of results)if(!r.ok)assert.equal((await r.json()).code,'55P03','only deliberate lock timeout may drop an observation');
  assert.equal((await inspect()).signals[1].count,accepted,'no lost successful increments');
  await locker.query("begin; select pg_advisory_xact_lock(hashtextextended('fmat-rejection-counters',0));");
  const rejected=await record();assert.equal(rejected.ok,false);assert.equal((await rejected.json()).code,'55P03');
  await locker.query('rollback;');
  assert.equal((await inspect()).signals[1].count,accepted,'timed-out write leaves counter unchanged');
  assert.equal(await sql.query('select jsonb_build_object(\'jobs\',(select count(*) from fmat.jobs),\'reservations\',(select count(*) from fmat.host_reservations),\'audit\',(select count(*) from fmat.audit_events));'),domain);
 }finally{
  await locker.query('rollback;').catch(()=>{});locker.close();
  await sql.query(`truncate fmat.rejection_counters; insert into fmat.rejection_counters select * from jsonb_populate_recordset(null::fmat.rejection_counters,'${prior.replaceAll("'","''")}'::jsonb);`);sql.close();
 }
});
