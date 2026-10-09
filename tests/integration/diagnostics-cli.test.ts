import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {LocalSql} from './local-sql.ts';
import {operationalSnapshot} from '../../lib/contracts/operational-diagnostics.ts';
import {rejectionSnapshot} from '../../lib/contracts/rejection-observations.ts';
import {Database} from '../../lib/server/database/client.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
const exec=promisify(execFile);
test('actual diagnostic CLI is target-bound, read-only and redacts stored and upstream private content',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const sql=new LocalSql(),id=randomUUID(),secret='private-diagnostic-fixture-'+randomUUID();
 const env={...process.env,SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY};
 async function run(args:string[],patch:NodeJS.ProcessEnv={}){
  let result:{stdout:string;stderr:string;code:number};
  try{const r=await exec(process.execPath,['--import','tsx','scripts/diagnostics.ts',...args],{env:{...env,...patch},timeout:15000,maxBuffer:65536});result={...r,code:0};}
  catch(error){const e=error as {stdout:string;stderr:string;code:number};result={stdout:e.stdout,stderr:e.stderr,code:e.code};}
  assert.ok([0,1].includes(result.code));for(const value of [local.SERVICE_ROLE_KEY,secret])assert.ok(!(result.stdout+result.stderr).includes(value));
  return {...result,value:JSON.parse(result.code?result.stderr:result.stdout)};
 }
 let remoteCalls=0;
 const proxy=createServer((_req,res)=>{remoteCalls++;res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({message:secret}));});
 proxy.listen(0,'127.0.0.1');await once(proxy,'listening');const address=proxy.address();assert.ok(address&&typeof address==='object');
 try{
  await sql.query(`insert into fmat.outbox(id,dedupe_key,audience,recipient,payload,status,provider_reference) values('${id}','${id}','operator','{"email":"${secret}"}','{"private":"${secret}"}','uncertain','${secret}');`);
  const before=await sql.query(`select to_jsonb(o) from fmat.outbox o where id='${id}';`);
  const full=await run(['--project','local','--samples','20']);assert.equal(full.code,0);const {project,...snapshot}=full.value;assert.equal(project,'local');operationalSnapshot.parse(snapshot);
  assert.ok(snapshot.signals.find((s:{category:string})=>s.category==='uncertain_delivery').samples.some((s:{id:string})=>s.id===id));
  const counts=await run(['--project','local','--samples','0']);assert.equal(counts.code,0);assert.ok(counts.value.signals.every((s:{samples:unknown[]})=>s.samples.length===0));
  assert.equal((await run(['--project','abcdefghijklmnopqrst'])).value.error,'CONFIGURATION_UNAVAILABLE');
  assert.equal((await run(['--project','local'],{SUPABASE_SECRET_KEY:local.ANON_KEY})).value.error,'CONFIGURATION_UNAVAILABLE');
  const denied=await fetch(local.API_URL+'/rest/v1/rpc/fmat_operational_snapshot',{method:'POST',headers:{apikey:local.ANON_KEY,authorization:'Bearer '+local.ANON_KEY,'content-type':'application/json'},body:'{"p_sample_limit":1}'});assert.equal(denied.ok,false);
  assert.equal((await run(['--project','local','--samples','21'])).value.error,'INVALID_INPUT');
  assert.equal((await run(['--project','local'],{SUPABASE_URL:`http://127.0.0.1:${address.port}`})).value.error,'PROVIDER_UNAVAILABLE');assert.equal(remoteCalls,1,'no retry or recovery request');
  assert.equal(await sql.query(`select to_jsonb(o) from fmat.outbox o where id='${id}';`),before,'CLI does not repair uncertainty or mutate delivery');
 }finally{
  proxy.closeAllConnections();await new Promise<void>((resolve,reject)=>proxy.close(error=>error?reject(error):resolve()));
  await sql.query(`delete from fmat.outbox where id='${id}';`);sql.close();
 }
});

test('actual rejection collector and CLI preserve rejected outcomes and disclose database-only coverage',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const env={...process.env,SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,OPERATIONAL_REJECTIONS_ENABLED:'true'};
 const sql=new LocalSql(),db=new Database(env),privateValue='private-collector-'+randomUUID();
 const prior=await sql.query("select coalesce(jsonb_agg(to_jsonb(c)),'[]') from fmat.rejection_counters c;");
 const domainQuery="select jsonb_build_object('jobs',(select count(*) from fmat.jobs),'requests',(select count(*) from fmat.requests),'reservations',(select count(*) from fmat.host_reservations),'audit',(select count(*) from fmat.audit_events));";
 const before=await sql.query(domainQuery);
 try{
  await sql.query('truncate fmat.rejection_counters;');
  await assert.rejects(db.rpc('fmat_conversation_check',{p_grant_id:randomUUID(),p_conversation_id:randomUUID()}),error=>error instanceof ApplicationError&&error.code==='UNAUTHORIZED');
  const denied=await db.rpc('fmat_oauth_grant_check',{p_id:randomUUID(),p_client_id:randomUUID(),p_resource:'https://resource.example.test/'+privateValue,p_actor_kind:'guest',p_actor_id:randomUUID(),p_scope:'request:read'});
  assert.deepEqual(denied,{error:'invalid_grant'});
  const saved=await sql.query('select jsonb_agg(to_jsonb(c) order by category,bucket_start) from fmat.rejection_counters c;');
  assert.ok(!saved.includes(privateValue));
  const result=await exec(process.execPath,['--import','tsx','scripts/diagnostics.ts','--project','local','--rejections'],{env,timeout:15000,maxBuffer:65536});
  for(const secret of [privateValue,local.SERVICE_ROLE_KEY])assert.ok(!(result.stdout+result.stderr).includes(secret));
  const {project,...snapshot}=JSON.parse(result.stdout);assert.equal(project,'local');rejectionSnapshot.parse(snapshot);
  assert.equal(snapshot.signals[0].count,2);assert.equal(snapshot.signals[1].count,0);
  assert.equal(snapshot.coverage.preDatabaseDenials,'not_recorded');
  assert.equal(await sql.query('select jsonb_agg(to_jsonb(c) order by category,bucket_start) from fmat.rejection_counters c;'),saved,'inspection produces no new observation');
  await assert.rejects(exec(process.execPath,['--import','tsx','scripts/diagnostics.ts','--project','local','--rejections','--samples','0'],{env}),error=>{assert.equal(JSON.parse((error as {stderr:string}).stderr).error,'INVALID_INPUT');return true;});
  const anonymous=await fetch(local.API_URL+'/rest/v1/rpc/fmat_rejection_snapshot',{method:'POST',headers:{apikey:local.ANON_KEY,authorization:'Bearer '+local.ANON_KEY,'content-type':'application/json'},body:'{}'});assert.equal(anonymous.ok,false);
  assert.equal(await sql.query(domainQuery),before,'collection does not mutate domain state');
 }finally{
  await sql.query(`truncate fmat.rejection_counters; insert into fmat.rejection_counters select * from jsonb_populate_recordset(null::fmat.rejection_counters,'${prior.replaceAll("'","''")}'::jsonb);`);sql.close();
 }
});
