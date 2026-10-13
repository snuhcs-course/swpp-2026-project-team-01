import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {LocalSql} from './local-sql.ts';

test('Calendar retention skips locked evidence and concurrent batches delete each expired row once',async()=>{
 const sql=new LocalSql(),locker=new LocalSql(),other=new LocalSql();
 const host=randomUUID(),invitation=randomUUID(),locked=randomUUID();
 const active=await sql.query("select active from cron.job where jobname='fmat-calendar-scan-retention';");assert.ok(['t','f'].includes(active));
 try{
  // Prevent the local minute scheduler racing the deterministic fixture; restore its original state below.
  await sql.query("select cron.alter_job((select jobid from cron.job where jobname='fmat-calendar-scan-retention'),active:=false);");
  await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','${host}@example.test',encode(extensions.digest('${invitation}','sha256'),'hex'),now()+interval '1 day','fixture');
   insert into fmat.hosts(id,email,invitation_id) values('${host}','${host}@example.test','${invitation}');
   insert into fmat.calendar_scans(id,host_id,input,key,generation,rules_version,revision,status,created_at) values('${locked}','${host}','{}','locked',gen_random_uuid(),0,0,'ready',now()-interval '25 hours');
   insert into fmat.calendar_scans(host_id,input,key,generation,rules_version,revision,status,created_at) values('${host}','{}','unlocked',gen_random_uuid(),0,0,'applied',now()-interval '25 hours'),('${host}','{}','recent',gen_random_uuid(),0,0,'ready',now());`);
  const domain=await sql.query(`select jsonb_build_object('host',(select to_jsonb(h) from fmat.hosts h where id='${host}'),'jobs',(select count(*) from fmat.jobs),'bookings',(select count(*) from fmat.booking_attempts));`);
  await locker.query(`begin; select id from fmat.calendar_scans where id='${locked}' for update;`);
  assert.equal(await sql.query('select fmat.prune_calendar_scans();'),'1','locked expired evidence does not block unlocked cleanup');
  assert.equal(await sql.query(`select count(*) from fmat.calendar_scans where id='${locked}';`),'1');
  await locker.query('rollback;');assert.equal(await sql.query('select fmat.prune_calendar_scans();'),'1','deferred row is deleted after release');
  await sql.query(`insert into fmat.calendar_scans(host_id,input,key,generation,rules_version,revision,status,created_at) select '${host}','{}','batch-'||n,gen_random_uuid(),0,0,'failed',now()-interval '25 hours' from generate_series(1,1205)n;`);
  const counts=await Promise.all([sql.query('select fmat.prune_calendar_scans();'),other.query('select fmat.prune_calendar_scans();')]);
  assert.equal(counts.map(Number).reduce((a,b)=>a+b,0),1205);assert.ok(counts.every(n=>Number(n)<=1000));
  assert.equal(await sql.query(`select count(*) from fmat.calendar_scans where host_id='${host}' and key='recent';`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.calendar_scans where host_id='${host}';`),'1');
  assert.equal(await sql.query(`select jsonb_build_object('host',(select to_jsonb(h) from fmat.hosts h where id='${host}'),'jobs',(select count(*) from fmat.jobs),'bookings',(select count(*) from fmat.booking_attempts));`),domain);
 }finally{
  await locker.query('rollback;').catch(()=>{});locker.close();other.close();
  try{await sql.query(`delete from fmat.hosts where id='${host}'; delete from fmat.invitations where id='${invitation}';`);}
  finally{await sql.query(`select cron.alter_job((select jobid from cron.job where jobname='fmat-calendar-scan-retention'),active:=${active==='t'});`);sql.close();}
 }
});
