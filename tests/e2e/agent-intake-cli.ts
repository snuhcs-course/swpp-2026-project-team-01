import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout} from 'node:timers/promises';
import {randomUUID,createHash} from 'node:crypto';
import type {Browser} from '@playwright/test';
import type {LocalSql} from '../integration/local-sql.ts';
const q=(v:string)=>`'${v.replaceAll("'","''")}'`;
export async function exerciseIntakeCli(origin:string,handle:string,sql:LocalSql,browser:Browser){
 const root=await mkdtemp(join(tmpdir(),'fmat-intake-cli-')),bin=join(root,'bin'),urlFile=join(root,'browser-url'),context=await browser.newContext();let clientId='',grantId='',requestId='';
 const children:ReturnType<typeof spawn>[]=[];let transcript='';
 try{
  await mkdir(bin,{mode:0o700});
  for(const name of ['open','xdg-open'])await writeFile(join(bin,name),'#!/bin/sh\nprintf \'%s\' "$1" > "$FMAT_CLI_BROWSER_URL_FILE"\n',{mode:0o700});
  function run(args:string[],input='',lost=false){
   const child=spawn(process.execPath,['--import','tsx','scripts/fmat.ts','--origin',origin,...args],{env:{...process.env,XDG_CONFIG_HOME:root,PATH:bin+':'+process.env.PATH,FMAT_CLI_BROWSER_URL_FILE:urlFile,NODE_OPTIONS:lost?'--import='+new URL('./cli-lost-response-fixture.mjs',import.meta.url).href:''},stdio:['pipe','pipe','pipe']});children.push(child);
   let out='',err='';child.stdout!.on('data',v=>out+=v);child.stderr!.on('data',v=>err+=v);child.stdin!.end(input);
   const result=new Promise<{code:number|null;out:string;err:string}>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>{transcript+=out+err;resolve({code,out,err});});});return {child,result};
  }
  const login=run(['login','intake','--handle',handle]);let authorize='';
  for(let n=0;n<150;n++){try{authorize=await readFile(urlFile,'utf8');if(authorize)break;}catch{}assert.equal(login.child.exitCode,null);await setTimeout(100);}
  assert.ok(authorize);const url=new URL(authorize);clientId=url.searchParams.get('client_id')!;assert.equal(url.searchParams.get('handle'),handle);assert.equal(url.searchParams.has('request_id'),false);
  const page=await context.newPage();await page.goto(authorize);await page.getByRole('button',{name:'Grant access',exact:true}).waitFor();
  const authorizationId=new URL(page.url()).searchParams.get('authorizationId')!;assert.equal(await page.locator('input,textarea,select').count(),0);
  await page.getByRole('button',{name:'Grant access',exact:true}).click();await page.waitForURL('http://127.0.0.1:*/callback/**');
  const logged=await login.result;assert.equal(logged.code,0,logged.err);const connection=JSON.parse(logged.out);grantId=connection.connection;assert.equal(connection.actor,'intake');
  const path=join(root,'findmeatime',createHash('sha256').update(origin).digest('hex'),grantId+'.json'),stored=JSON.parse(await readFile(path,'utf8'));assert.equal((await stat(path)).mode&0o777,0o600);assert.equal(stored.actorKind,'intake');
  const tools=await run(['tools',grantId]).result;assert.equal(tools.code,0,tools.err);assert.ok(JSON.parse(tools.out).tools.some((t:{name:string})=>t.name==='fmat_create_request'));
  const intent={idempotencyKey:randomUUID(),details:{requesterName:'CLI requester',requesterEmail:'cli-requester@example.test',purpose:'CLI initial request',timezone:'Asia/Seoul',durationMinutes:30}};
  const missing=await run(['call',grantId,'fmat_create_request'],JSON.stringify({...intent,details:{}})).result;assert.equal(missing.code,0,missing.err);assert.equal(JSON.parse(missing.out).result.status,'clarification');
  const lost=await run(['call',grantId,'fmat_create_request'],JSON.stringify(intent),true).result;assert.equal(lost.code,6,lost.err);assert.equal(lost.out,'');
  const created=await run(['call',grantId,'fmat_create_request'],JSON.stringify(intent)).result;assert.equal(created.code,0,created.err);requestId=JSON.parse(created.out).result.requestId;
  assert.equal(await sql.query(`select count(*) from fmat.requests where id=${q(requestId)};`),'1');
  const changed=await run(['call',grantId,'fmat_create_request'],JSON.stringify({...intent,details:{...intent.details,purpose:'Changed'}})).result;assert.equal(changed.code,5);
  const read=await run(['call',grantId,'fmat_get_request'],JSON.stringify({requestId,input:{}})).result;assert.equal(read.code,0,read.err);assert.ok(read.out.includes('CLI initial request'));
  assert.equal((await run(['call',grantId,'fmat_get_request'],JSON.stringify({requestId:randomUUID(),input:{}})).result).code,5);
  // Force the existing private-store refresh path without changing server time.
  await writeFile(path,JSON.stringify({...stored,accessExpiresAt:Date.now()+1000}),{mode:0o600});assert.equal((await run(['tools',grantId]).result).code,0);
  const refreshed=JSON.parse(await readFile(path,'utf8'));assert.equal(refreshed.actorId,stored.actorId);assert.notEqual(refreshed.refreshToken,stored.refreshToken);
  await page.goto(origin+'/connect/intake?authorizationId='+authorizationId);await page.getByRole('button',{name:'Open my request'}).click();await page.waitForURL(origin+'/booking/'+requestId);
  const proof=(await context.cookies()).find(c=>c.name==='fmat-request-'+requestId)!.value;
  const logout=await run(['logout',grantId]).result;assert.equal(logout.code,0,logout.err);assert.equal(await sql.query(`select revoked_at is not null from fmat.oauth_grants where id=${q(grantId)};`),'t');await assert.rejects(readFile(path));assert.equal((await run(['tools',grantId]).result).code,3);
  for(const secret of [stored.accessToken,stored.refreshToken,refreshed.accessToken,refreshed.refreshToken,proof]){assert.ok(!transcript.includes(secret));for(const child of children)assert.ok(!child.spawnargs.join(' ').includes(secret));}
 }finally{
  for(const child of children)if(child.exitCode===null)child.kill('SIGKILL');await context.close();await rm(root,{recursive:true,force:true});
  if(clientId)await sql.query(`delete from fmat.idempotency where actor_scope in(select 'intake:'||id from fmat.oauth_intakes where grant_id in(select id from fmat.oauth_grants where client_id=${q(clientId)}));delete from fmat.audit_events where subject_id in(select request_id::text from fmat.oauth_intakes where grant_id in(select id from fmat.oauth_grants where client_id=${q(clientId)}));delete from fmat.oauth_refresh_tokens where grant_id in(select id from fmat.oauth_grants where client_id=${q(clientId)});delete from fmat.oauth_codes where grant_id in(select id from fmat.oauth_grants where client_id=${q(clientId)});delete from fmat.oauth_intakes where grant_id in(select id from fmat.oauth_grants where client_id=${q(clientId)});delete from fmat.oauth_grants where client_id=${q(clientId)};delete from fmat.oauth_authorizations where client_id=${q(clientId)};delete from fmat.oauth_clients where id=${q(clientId)};`);
  if(requestId)await sql.query(`delete from fmat.requests where id=${q(requestId)};`);
 }
}
