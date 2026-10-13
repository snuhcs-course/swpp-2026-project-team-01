import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {InvitationCodes} from '../../lib/server/identity/invitations.ts';
import {InvitationDelivery} from '../../lib/server/email/invitation-delivery.ts';
import {invitationEmail} from '../../lib/server/email/invitation-content.ts';
import {CloudflareEmail} from '../../lib/server/email/cloudflare.ts';
import {Database} from '../../lib/server/database/client.ts';
import {LocalSql} from './local-sql.ts';

test('invitation delivery persists dispatch before HTTP and never resends after uncertain or terminal outcomes',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const project='abcdefghijklmnopqrst',operator='delivery-'+randomUUID();
 // Remote derivation context is synthetic; the database and transport are explicitly local/fake.
 const env={SUPABASE_URL:`https://${project}.supabase.co`,INVITATION_CODE_KEY:Buffer.alloc(32,21).toString('base64'),CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_EMAIL_FROM:'no-reply@findmeatime.com',CLOUDFLARE_EMAIL_API_TOKEN:'synthetic'};
 const dbEnv={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY},db=new Database(dbEnv),sql=new LocalSql();
 let posts=0,activeJob='',mode='success',duringSend:(()=>Promise<void>)|undefined;
 const provider=new CloudflareEmail(env,async(_url,init)=>{
  posts++;const message=JSON.parse(String(init?.body));
  assert.equal(await sql.query(`select d.phase from fmat.invitation_deliveries d join fmat.jobs j on j.payload->>'invitationId'=d.invitation_id::text where j.id='${activeJob}';`),'dispatched');
  assert.equal(message.from,env.CLOUDFLARE_EMAIL_FROM);assert.match(message.text,/Sign in with Google/);
  assert.equal((message.text.match(/https:\/\/\S+/gu)??[]).join(''),'https://fixture.example/app');
  if(duringSend)await duringSend();
  if(mode==='expired')await sql.query(`update fmat.jobs set lease_until=clock_timestamp()-interval '1 second' where id='${activeJob}';`);
  if(mode==='lost')throw new Error('synthetic lost response');
  if(mode==='reject')return Response.json({success:false,errors:[{code:10102}]},{status:403});
  return Response.json({success:true,errors:[],result:{message_id:'fixture-'+posts,delivered:[],queued:mode==='unknown'?[]:[message.to],permanent_bounces:mode==='bounce'?[message.to]:[],suppressed_recipients:mode==='suppress'?[message.to]:[]}});
 });
 const worker=(database=db,configuration=env)=>new InvitationDelivery(database,configuration,provider);
 const call=(operation:string,lease:unknown,input:unknown={})=>db.rpc('fmat_invitation_delivery',{p_operation:operation,p_lease:lease,p_input:input});
 const status=(id:string)=>sql.query(`select phase from fmat.invitation_deliveries where invitation_id='${id}';`);
 async function fixture(){
  const command={project,operator,email:randomUUID()+'@example.test',idempotencyKey:randomUUID(),delivery:'cloudflare'},material=new InvitationCodes(env).material(command);
  const issued=await db.rpc('fmat_invitation_operator',{p_operation:'issue',p_operator:operator,p_input:{project,email:command.email,idempotencyKey:command.idempotencyKey,delivery:'cloudflare',tokenHash:material.tokenHash,origin:'https://fixture.example',accountId:env.CLOUDFLARE_ACCOUNT_ID}}) as {invitationId:string};
  const id=issued.invitationId,job=await sql.query(`select id from fmat.jobs where kind='invitation_delivery' and payload->>'invitationId'='${id}';`);return {id,job,material};
 }
 async function own(jobId:string){activeJob=jobId;const lease={workerId:'invitation-'+randomUUID(),jobId,leaseToken:randomUUID()};await sql.query(`update fmat.jobs set status='running',worker_id='${lease.workerId}',lease_token='${lease.leaseToken}',lease_until=clock_timestamp()+interval '60 seconds' where id='${jobId}';`);return lease;}
 async function prepare(lease:unknown){const state=await call('load',lease),content=invitationEmail(state,env);return call('prepare',lease,{basis:(state as {basis:string}).basis,tokenHash:content.tokenHash,fingerprint:content.fingerprint});}
 try{
  const first=await fixture();const claims=await Promise.all(Array.from({length:8},()=>call('claim',{workerId:randomUUID()}))) as {job:unknown|null}[];assert.equal(claims.filter(value=>value.job!==null).length,1);const lease=claims.find(value=>value.job!==null)!.job;activeJob=first.job;const duplicate=await sql.query(`select fmat.enqueue_job('invitation_delivery','duplicate-${randomUUID()}',payload) from fmat.jobs where id='${first.job}';`);
  duringSend=async()=>{const other=await own(duplicate);await assert.rejects(call('record',other,{outcome:'uncertain',reason:'prior_dispatch_uncertain'}));assert.equal(await worker().process(other),'retry');assert.equal(await status(first.id),'dispatched');activeJob=first.job;};
  assert.equal(await worker().process(lease),'sent');duringSend=undefined;assert.equal(posts,1);
  assert.equal(await worker().process(await own(duplicate)),'sent');assert.equal(posts,1);
  const persisted=await sql.query(`select row_to_json(d)::text from fmat.invitation_deliveries d where invitation_id='${first.id}';`);assert.equal(persisted.includes(first.material.code),false);assert.equal(persisted.includes(first.material.groupedCode),false);
  for(const [behavior,outcome] of [['lost','uncertain'],['reject','failed'],['bounce','failed'],['suppress','suppressed'],['unknown','uncertain']]){
   const f=await fixture();mode=behavior;assert.equal(await worker().process(await own(f.job)),outcome);const count:number=posts;mode='success';assert.equal(await worker().process(await own(f.job)),outcome);assert.equal(posts,count);
  }
  for(const operation of ['prepare','dispatch','record']){
   const f=await fixture();let dropped=false;const lose=new Database(dbEnv,async(url,init)=>{const response=await fetch(url,init);if(!dropped&&response.ok&&JSON.parse(String(init?.body)).p_operation===operation){dropped=true;throw new Error('lost committed response');}return response;});
   const count:number=posts;await worker(lose).process(await own(f.job));assert.equal(dropped,true);
   if(operation==='prepare'){assert.equal(await status(f.id),'prepared');assert.equal(posts,count);assert.equal(await worker().process(await own(f.job)),'sent');assert.equal(posts,count+1);}
   else {const expected=operation==='dispatch'?'uncertain':'sent';assert.equal(await status(f.id),expected);assert.equal(await worker().process(await own(f.job)),expected);assert.equal(posts,count+(operation==='record'?1:0));}
  }
  const crashed=await fixture(),crashedLease=await own(crashed.job);await prepare(crashedLease);await call('dispatch',crashedLease);let count:number=posts;
  assert.equal(await worker().process(await own(crashed.job)),'uncertain');assert.equal(posts,count);
  const expired=await fixture();mode='expired';assert.equal(await worker().process(await own(expired.job)),'lease_lost');mode='success';count=posts;assert.equal(await worker().process(await own(expired.job)),'uncertain');assert.equal(posts,count);
  for(const change of ['revoke','expiry','redeem','email','hash']){
   const f=await fixture();let changed=false;const mutate=new Database(dbEnv,async(url,init)=>{const response=await fetch(url,init);if(!changed&&response.ok&&JSON.parse(String(init?.body)).p_operation==='prepare'){
    changed=true;
    if(change==='revoke')await db.rpc('fmat_invitation_operator',{p_operation:'revoke',p_operator:operator,p_input:{project,invitationId:f.id,idempotencyKey:randomUUID()}});
    else {const mutation={expiry:"expires_at=clock_timestamp()-interval '1 second'",redeem:'redeemed_at=clock_timestamp(),redeemed_by=gen_random_uuid()',email:"email='different@example.test'",hash:"token_hash=repeat('c',64)"}[change];await sql.query(`update fmat.invitations set ${mutation} where id='${f.id}';`);}
   }return response;});
   count=posts;assert.equal(await worker(mutate).process(await own(f.job)),'suppressed',change);assert.equal(changed,true);assert.equal(posts,count);
  }
  const after=await fixture();duringSend=async()=>{await db.rpc('fmat_invitation_operator',{p_operation:'revoke',p_operator:operator,p_input:{project,invitationId:after.id,idempotencyKey:randomUUID()}});};assert.equal(await worker().process(await own(after.job)),'sent');duringSend=undefined;assert.equal(await status(after.id),'sent');
  for(const prepared of [false,true]){
   const f=await fixture(),owned=await own(f.job);if(prepared)await prepare(owned);count=posts;
   assert.equal(await worker(db,{...env,INVITATION_CODE_KEY:Buffer.alloc(32,22).toString('base64')}).process(owned),'retry');assert.equal(posts,count);
   assert.equal(await worker().process(await own(f.job)),'sent');assert.equal(posts,count+1);
  }
  const wrongAccount=await fixture();count=posts;const otherProvider=new CloudflareEmail({...env,CLOUDFLARE_ACCOUNT_ID:'b'.repeat(32)},async()=>{throw new Error('must not send');});assert.equal(await new InvitationDelivery(db,env,otherProvider).process(await own(wrongAccount.job)),'retry');assert.equal(posts,count);
  const exhausted=await fixture(),exhaustedLease=await own(exhausted.job);await sql.query(`update fmat.jobs set attempts=max_attempts where id='${exhausted.job}';`);count=posts;await worker(db,{...env,INVITATION_CODE_KEY:''}).process(exhaustedLease);assert.equal(await status(exhausted.id),'failed');assert.equal(posts,count);
  const dead=await fixture();await own(dead.job);await sql.query(`update fmat.jobs set attempts=max_attempts,lease_until=clock_timestamp()-interval '1 second',available_at='1900-01-01' where id='${dead.job}';`);assert.deepEqual(await worker().run(),{claimed:1,outcome:'failed'});
  const waited=await fixture(),waitLease=await own(waited.job),lock=new LocalSql();let pending:Promise<string>|undefined;
  try{
   await lock.query(`begin;update fmat.invitations set expires_at=clock_timestamp()+interval '1 second' where id='${waited.id}';`);const pid=await lock.query('select pg_backend_pid();');pending=worker().process(waitLease);let observed=false;
   for(let n=0;n<100;n++){if(await sql.query(`select exists(select 1 from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid)) and wait_event_type='Lock');`)==='t'){observed=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
   assert.equal(observed,true);await new Promise(resolve=>setTimeout(resolve,1100));await lock.query('commit;');count=posts;assert.equal(await pending,'suppressed');assert.equal(posts,count);
  }finally{await lock.query('rollback;').catch(()=>{});await pending?.catch(()=>{});lock.close();}
  const stale=await fixture(),staleLease=await own(stale.job),leaseLock=new LocalSql();let stalePending:Promise<string>|undefined;
  try{
   await leaseLock.query(`begin;select id from fmat.invitations where id='${stale.id}' for update;`);
   await sql.query(`update fmat.jobs set lease_until=clock_timestamp()+interval '1 second' where id='${stale.job}';`);
   const pid=await leaseLock.query('select pg_backend_pid();');stalePending=worker().process(staleLease);let observed=false;
   for(let n=0;n<100;n++){if(await sql.query(`select exists(select 1 from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid)) and wait_event_type='Lock');`)==='t'){observed=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
   assert.equal(observed,true);await new Promise(resolve=>setTimeout(resolve,1100));await leaseLock.query('commit;');count=posts;assert.equal(await stalePending,'lease_lost');assert.equal(posts,count);assert.equal(await status(stale.id),'pending');
  }finally{await leaseLock.query('rollback;').catch(()=>{});await stalePending?.catch(()=>{});leaseLock.close();}
  const invalid=await fixture(),invalidLease=await own(invalid.job);await assert.rejects(call('dispatch',invalidLease));await assert.rejects(call('prepare',invalidLease,{basis:'b'.repeat(64),fingerprint:'f'.repeat(64),tokenHash:invalid.material.tokenHash}));
  await prepare(invalidLease);const invalidState=await call('load',invalidLease) as {basis:string};await assert.rejects(call('prepare',invalidLease,{basis:invalidState.basis,tokenHash:invalid.material.tokenHash,fingerprint:'f'.repeat(64)}));
  assert.equal(await sql.query(`select has_function_privilege('anon','public.fmat_invitation_delivery(text,jsonb,jsonb)','execute')||','||has_function_privilege('authenticated','public.fmat_invitation_delivery(text,jsonb,jsonb)','execute')||','||has_function_privilege('service_role','public.fmat_invitation_delivery(text,jsonb,jsonb)','execute')||','||has_table_privilege('service_role','fmat.invitation_deliveries','select');`),'false,false,true,false');
  await sql.query(`update fmat.jobs set kind='delivery' where id='${invalid.job}';`);await assert.rejects(call('load',invalidLease));
 }finally{
  sql.close();const cleanup=new LocalSql();try{await cleanup.query(`set session_replication_role=replica;delete from pgmq.q_fmat_jobs where message->>'jobId' in(select id::text from fmat.jobs where payload->>'invitationId' in(select id::text from fmat.invitations where issued_by='${operator}'));delete from fmat.queue_publications where job_id in(select id from fmat.jobs where payload->>'invitationId' in(select id::text from fmat.invitations where issued_by='${operator}'));delete from fmat.jobs where payload->>'invitationId' in(select id::text from fmat.invitations where issued_by='${operator}');delete from fmat.audit_events where subject_id in(select id::text from fmat.invitations where issued_by='${operator}');delete from fmat.invitation_deliveries where operator_id='${operator}';delete from fmat.invitations where issued_by='${operator}';delete from fmat.idempotency where actor_scope='invitation_operator:${project}:${operator}';set session_replication_role=origin;`);}finally{cleanup.close();}
 }
});
