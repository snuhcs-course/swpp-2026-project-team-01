import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {LocalSql} from './local-sql.ts';
import {operationalSnapshot} from '../../lib/contracts/operational-diagnostics.ts';
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
