import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtemp,realpath,chmod,readFile,stat,symlink,mkdir,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LocalSql} from './local-sql.ts';
const exec=promisify(execFile);
test('operator invitation CLI issues once, recovers private files and rejects unsafe authority and expired invitations',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const root=await mkdtemp(join(await realpath(tmpdir()),'fmat-invitation-cli-'));await chmod(root,0o700);
 const operator='cli-'+randomUUID(),sql=new LocalSql(),env={...process.env,SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,APP_ORIGIN:'http://localhost:3000',INVITATION_CODE_KEY:Buffer.alloc(32,31).toString('base64'),CLOUDFLARE_EMAIL_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:'',CLOUDFLARE_EMAIL_FROM:''};
 const outputs:string[]=[],codes:string[]=[];
 async function run(action:string,flags:string[],patch:NodeJS.ProcessEnv={}){
  let result:{stdout:string;stderr:string;code?:number};
  try{const value=await exec(process.execPath,['--import','tsx','scripts/invitations.ts',action,'--project','local','--operator',operator,...flags],{env:{...env,...patch},timeout:15000,maxBuffer:65536});result={...value,code:0};}
  catch(error){const e=error as {stdout:string;stderr:string;code:number};result={stdout:e.stdout,stderr:e.stderr,code:e.code};}
  outputs.push(result.stdout,result.stderr);assert.ok(result.code===0||result.code===1,'CLI exits with sanitized result');
  assert.equal((result.stdout+result.stderr).includes(local.SERVICE_ROLE_KEY),false);assert.equal((result.stdout+result.stderr).includes(env.INVITATION_CODE_KEY),false);
  return {...result,value:JSON.parse((result.code===0?result.stdout:result.stderr).trim())};
 }
 const issue=(key:string,file:string,email='fixture@example.test')=>['--email',email,'--key',key,'--output',file];
 let proxyMode='pass',proxyFile='';let intercepted=0;
 const proxy=createServer(async(req,res)=>{
  try{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks),input=JSON.parse(body.toString());const headers={'content-type':'application/json',apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY};const response=await fetch(local.API_URL+req.url,{method:'POST',headers,body});const text=await response.text();
   if(response.ok&&input.p_operation==='issue'&&proxyMode!=='pass'){intercepted++;const mode=proxyMode;proxyMode='pass';if(mode==='drop'){res.destroy();return;}await chmod(proxyFile,0o644);}
   res.writeHead(response.status,{'content-type':'application/json'});res.end(text);
  }catch{res.writeHead(500);res.end('{}');}
 });
 await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));const address=proxy.address();assert.ok(address&&typeof address==='object');const proxyEnv={SUPABASE_URL:`http://127.0.0.1:${address.port}`};
 try{
  const key=randomUUID(),file=join(root,'first.json'),first=await run('issue',issue(key,file));assert.equal(first.code,0);assert.equal(first.value.delivery,'manual');assert.equal(first.value.deliveryStatus,'manual');assert.equal(first.value.idempotencyKey,key);assert.equal('email'in first.value,false);
  const content=JSON.parse(await readFile(file,'utf8'));codes.push(content.code);assert.equal(content.invitationId,first.value.invitationId);assert.equal(content.setupUrl,'http://localhost:3000/app');assert.match(content.code,/^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/u);assert.equal((await stat(file)).mode&0o777,0o600);
  const duplicate=await run('issue',issue(key,file));assert.equal(duplicate.value.error,'PRIVATE_OUTPUT_UNAVAILABLE');assert.equal(JSON.parse(await readFile(file,'utf8')).code,content.code);
  const retry=await run('issue',issue(key,join(root,'retry.json')));assert.equal(retry.value.invitationId,first.value.invitationId);assert.equal(retry.value.expiresAt,first.value.expiresAt);assert.equal(JSON.parse(await readFile(join(root,'retry.json'),'utf8')).code,content.code);
  assert.equal((await run('issue',issue(key,join(root,'conflict.json'),'changed@example.test'))).value.error,'IDEMPOTENCY_CONFLICT');await assert.rejects(access(join(root,'conflict.json')));
  const recovered=await run('recover',['--invitation',first.value.invitationId,'--output',join(root,'recovered.json')]);assert.equal(recovered.code,0);assert.equal(JSON.parse(await readFile(join(root,'recovered.json'),'utf8')).code,content.code);
  const noSecrets={INVITATION_CODE_KEY:'',CLOUDFLARE_EMAIL_API_TOKEN:''};assert.equal((await run('status',['--invitation',first.value.invitationId],noSecrets)).value.status,'active');
  const revokeKey=randomUUID();for(let n=0;n<2;n++)assert.equal((await run('revoke',['--invitation',first.value.invitationId,'--key',revokeKey],noSecrets)).value.status,'revoked');
  assert.equal((await run('recover',['--invitation',first.value.invitationId,'--output',join(root,'revoked.json')])).value.error,'INVITATION_INVALID');await assert.rejects(access(join(root,'revoked.json')));
  const before=await sql.query(`select count(*) from fmat.invitations where issued_by='${operator}';`);
  for(const patch of [{SUPABASE_SECRET_KEY:local.ANON_KEY},{INVITATION_CODE_KEY:''},{SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co'},{APP_ORIGIN:'https://release.findmeatime.com'}])assert.equal((await run('issue',issue(randomUUID(),join(root,randomUUID()+'.json')),patch)).value.error,'CONFIGURATION_UNAVAILABLE');
  assert.equal((await run('issue',['--email','fixture@example.test','--key',randomUUID(),'--delivery','cloudflare'])).value.error,'INVALID_INPUT');
  await mkdir(join(root,'shared'),{mode:0o755});await symlink(root,join(root,'alias'));await symlink(file,join(root,'link.json'));
  for(const path of [join(root,'shared','unsafe.json'),join(root,'alias','unsafe.json'),join(root,'link.json'),'relative.json'])assert.equal((await run('issue',issue(randomUUID(),path))).value.error,'PRIVATE_OUTPUT_UNAVAILABLE');
  assert.equal(await sql.query(`select count(*) from fmat.invitations where issued_by='${operator}';`),before,'invalid inputs never issue');
  const lostKey=randomUUID(),lostFile=join(root,'lost.json');proxyMode='drop';const lost=await run('issue',issue(lostKey,lostFile),proxyEnv);assert.equal(lost.value.error,'PROVIDER_UNAVAILABLE');assert.equal(lost.value.idempotencyKey,lostKey);await assert.rejects(access(lostFile));
  const originalExpiry=await sql.query(`select i.expires_at::text from fmat.invitations i join fmat.invitation_deliveries d on d.invitation_id=i.id where d.operator_id='${operator}' and d.issue_key='${lostKey}';`);
  const resumed=await run('issue',issue(lostKey,lostFile),proxyEnv);assert.equal(resumed.code,0);assert.equal(Date.parse(resumed.value.expiresAt),Date.parse(originalExpiry));codes.push(JSON.parse(await readFile(lostFile,'utf8')).code);
  const writeKey=randomUUID();proxyFile=join(root,'write-failure.json');proxyMode='permissions';const failed=await run('issue',issue(writeKey,proxyFile),proxyEnv);assert.equal(failed.value.error,'PRIVATE_OUTPUT_UNAVAILABLE');assert.equal(failed.value.idempotencyKey,writeKey);assert.ok(failed.value.invitationId);await assert.rejects(access(proxyFile));
  const restored=await run('recover',['--invitation',failed.value.invitationId,'--output',join(root,'write-recovered.json')]);assert.equal(restored.code,0);codes.push(JSON.parse(await readFile(join(root,'write-recovered.json'),'utf8')).code);assert.equal(intercepted,2);
  const sameKey=randomUUID(),races=await Promise.all(Array.from({length:4},(_,n)=>run('issue',issue(sameKey,join(root,`concurrent-${n}.json`)))));assert.ok(races.every(r=>r.code===0&&r.value.invitationId===races[0].value.invitationId));const firstRace=JSON.parse(await readFile(join(root,'concurrent-0.json'),'utf8'));for(let n=0;n<4;n++){const v=JSON.parse(await readFile(join(root,`concurrent-${n}.json`),'utf8'));codes.push(v.code);assert.equal(v.code,firstRace.code);}
  for(const condition of ['expiry','redeemed','recipient']){
   const issued=await run('issue',issue(randomUUID(),join(root,condition+'.json')));assert.equal(issued.code,0);
   const mutation={expiry:"expires_at=clock_timestamp()-interval '1 second'",redeemed:'redeemed_at=clock_timestamp(),redeemed_by=gen_random_uuid()',recipient:"email='changed@example.test'"}[condition];await sql.query(`update fmat.invitations set ${mutation} where id='${issued.value.invitationId}';`);
   const output=join(root,condition+'-denied.json');assert.equal((await run('recover',['--invitation',issued.value.invitationId,'--output',output])).value.error,'INVITATION_INVALID');await assert.rejects(access(output));
  }
  const wait=await run('issue',issue(randomUUID(),join(root,'wait.json'))),lock=new LocalSql();let pending:ReturnType<typeof run>|undefined;
  try{await lock.query(`begin;update fmat.invitations set expires_at=clock_timestamp()+interval '1 second' where id='${wait.value.invitationId}';`);const pid=await lock.query('select pg_backend_pid();');pending=run('recover',['--invitation',wait.value.invitationId,'--output',join(root,'wait-denied.json')]);let observed=false;
   for(let n=0;n<150;n++){if(await sql.query(`select exists(select 1 from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid)) and wait_event_type='Lock');`)==='t'){observed=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
   assert.equal(observed,true);await new Promise(resolve=>setTimeout(resolve,1100));await lock.query('commit;');assert.equal((await pending).value.error,'INVITATION_INVALID');await assert.rejects(access(join(root,'wait-denied.json')));
  }finally{await lock.query('rollback;').catch(()=>{});await pending?.catch(()=>{});lock.close();}
  assert.equal(await sql.query(`select count(*) from fmat.jobs where payload->>'invitationId' in(select id::text from fmat.invitations where issued_by='${operator}');`),'0','local commands never queue provider mail');
  for(const output of outputs)for(const code of codes){assert.equal(output.includes(code),false);assert.equal(output.includes(code.replaceAll('-','')),false);}
 }finally{
  proxy.closeAllConnections();await new Promise<void>(resolve=>proxy.close(()=>resolve()));
  await sql.query(`delete from fmat.audit_events where subject_id in(select id::text from fmat.invitations where issued_by='${operator}');delete from fmat.invitation_deliveries where operator_id='${operator}';delete from fmat.invitations where issued_by='${operator}';delete from fmat.idempotency where actor_scope='invitation_operator:local:${operator}';`);sql.close();await rm(root,{recursive:true,force:true});
 }
});
