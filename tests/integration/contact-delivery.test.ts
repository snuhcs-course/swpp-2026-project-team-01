import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {ContactVerification} from '../../lib/server/contact/verification.ts';
import {ContactVerificationDelivery} from '../../lib/server/email/contact-delivery.ts';
import {CloudflareEmail} from '../../lib/server/email/cloudflare.ts';
import {Database} from '../../lib/server/database/client.ts';
import {guestCredential} from '../../lib/server/identity/credentials.ts';
import {TokenCipher} from '../../lib/server/calendar/encryption.ts';
import {LocalSql,cleanupFixtureJobsSql} from './local-sql.ts';
test('Contact email freezes code and recipient, fences dispatch and never retries uncertain sends',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const env={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,19).toString('base64'),CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_EMAIL_FROM:'no-reply@findmeatime.com',CLOUDFLARE_EMAIL_API_TOKEN:'synthetic'},db=new Database(env),service=new ContactVerification(db,env),cipher=new TokenCipher(env),sql=new LocalSql();
 const host=randomUUID(),invite=randomUUID(),requests:string[]=[];let posts=0,mode='success',activeJob='',duringSend:(()=>Promise<void>)|undefined;
 const messages:{to:string;text:string;html:string}[]=[];
 const provider=new CloudflareEmail(env,async(_url,init)=>{
  posts++;const message=JSON.parse(String(init?.body));messages.push(message);
  assert.equal(await sql.query(`select status from fmat.outbox where id=(select (payload->>'outboxId')::uuid from fmat.jobs where id='${activeJob}');`),'sending');
  assert.equal(message.from,'no-reply@findmeatime.com');assert.equal(message.to,'guest@example.test');
  assert.equal(message.text.includes('PRIVATE PURPOSE'),false);assert.equal(message.text.includes('http'),false);assert.equal(message.html.includes('href='),false);
  if(duringSend)await duringSend();
  if(mode==='expired')await sql.query(`update fmat.jobs set lease_until=clock_timestamp()-interval '1 second' where id='${activeJob}';`);
  if(mode==='lost')throw new Error('lost provider response');
  if(mode==='reject')return Response.json({success:false,errors:[{code:10102,message:'synthetic'}]},{status:403});
  return Response.json({success:true,errors:[],result:{message_id:'synthetic-'+posts,delivered:[],queued:mode==='unknown'?[]:[message.to],permanent_bounces:mode==='bounce'?[message.to]:[],suppressed_recipients:mode==='suppress'?[message.to]:[]}});
 });
 const worker=(database=db)=>new ContactVerificationDelivery(database,env,provider);
 const call=(op:string,lease:unknown,input:unknown={})=>db.rpc('fmat_contact_verification_delivery',{p_operation:op,p_lease:lease,p_input:input});
 async function own(jobId:string){activeJob=jobId;const lease={workerId:'contact-delivery-'+randomUUID(),jobId,leaseToken:randomUUID()};await sql.query(`update fmat.jobs set status='running',worker_id='${lease.workerId}',lease_token='${lease.leaseToken}',lease_until=clock_timestamp()+interval '60 seconds' where id='${jobId}';`);return lease;}
 async function fixture(){
  const id=randomUUID(),token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex'),guest=guestCredential(id,token);requests.push(id);
  await sql.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values('${id}','${host}','{"requesterEmail":"guest@example.test","purpose":"PRIVATE PURPOSE"}','${hash}',clock_timestamp()+interval '1 day');`);
  const state=(await service.start(guest,{requestId:id,revision:1,email:'guest@example.test',idempotencyKey:randomUUID()})).state,challengeId=state.challengeId!;
  const outbox=await sql.query(`select outbox_id from fmat.contact_verifications where id='${challengeId}';`);
  const job=await sql.query(`select id from fmat.jobs where kind='contact_verification_delivery' and payload->>'outboxId'='${outbox}';`);
  const code=(cipher.open(await sql.query(`select encrypted_code from fmat.contact_verifications where id='${challengeId}';`),'contact-verification:'+id+':'+challengeId) as {code:string}).code;
  return {id,guest,challengeId,outbox,job,code};
 }
 const status=(id:string)=>sql.query(`select status from fmat.outbox where id='${id}';`);
 try{
  await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invite}','contact-delivery-${host}@example.test','${createHash('sha256').update(invite).digest('hex')}',now()+interval '1 day','contact-delivery-fixture');insert into fmat.hosts(id,email,invitation_id) values('${host}','contact-delivery-${host}@example.test','${invite}');`);
  const first=await fixture(),lease=await own(first.job),duplicate=await sql.query(`select fmat.enqueue_job('contact_verification_delivery','duplicate-${randomUUID()}',payload) from fmat.jobs where id='${first.job}';`);
  duringSend=async()=>{const other=await own(duplicate);await assert.rejects(call('record',other,{outcome:'uncertain',reason:'prior_dispatch_uncertain'}));assert.equal(await worker().process(other),'retry');assert.equal(await status(first.outbox),'sending');activeJob=first.job;};
  assert.equal(await worker().process(lease),'sent');duringSend=undefined;assert.equal(posts,1);
  assert.equal(await worker().process(await own(duplicate)),'sent');assert.equal(posts,1);assert.ok(messages[0].text.includes(first.code));
  assert.equal((await service.read(first.guest,{requestId:first.id})).status,'pending');
  assert.equal((await service.confirm(first.guest,{requestId:first.id,challengeId:first.challengeId,code:first.code,idempotencyKey:randomUUID()})).outcome,'verified');
  // Once dispatch was granted, later challenge consumption does not erase actual send evidence.
  const consumed=await fixture();duringSend=async()=>{await service.confirm(consumed.guest,{requestId:consumed.id,challengeId:consumed.challengeId,code:consumed.code,idempotencyKey:randomUUID()});};
  assert.equal(await worker().process(await own(consumed.job)),'sent');duringSend=undefined;
  for(const [behavior,outcome] of [['lost','uncertain'],['reject','failed'],['bounce','failed'],['suppress','suppressed'],['unknown','uncertain']]){
   const f=await fixture();mode=behavior;assert.equal(await worker().process(await own(f.job)),outcome);const count:number=posts;mode='success';assert.equal(await worker().process(await own(f.job)),outcome);assert.equal(posts,count);assert.equal((await service.read(f.guest,{requestId:f.id})).status,'pending');
  }
  const inactive=await fixture();mode='lost';assert.equal(await worker().process(await own(inactive.job)),'uncertain');mode='success';
  await sql.query(`update fmat.contact_verifications set expires_at=clock_timestamp()-interval '1 second' where id='${inactive.challengeId}';`);
  const inactivePosts=posts;
  assert.equal(await worker().process(await own(inactive.job)),'uncertain','Challenge expiry cannot relabel a possibly sent message as suppressed');
  assert.equal(posts,inactivePosts);assert.equal(await status(inactive.outbox),'uncertain');
  const lostPrepare=await fixture();let dropped=false;
  const lose=(operation:string)=>new Database(env,async(url,init)=>{const response=await fetch(url,init);if(!dropped&&response.ok&&JSON.parse(String(init?.body)).p_operation===operation){dropped=true;throw new Error('lost committed response');}return response;});
  let count:number=posts;assert.equal(await worker(lose('prepare')).process(await own(lostPrepare.job)),'retry');assert.equal(dropped,true);assert.equal(posts,count);
  const frozen=await sql.query(`select encrypted_prepared from fmat.contact_verification_deliveries where outbox_id='${lostPrepare.outbox}';`);
  assert.equal(frozen.includes(lostPrepare.code),false);
  // A configuration change after durable preparation cannot reroute the frozen
  // verification email. Restoring the original account permits its first send.
  const changedAccount={...env,CLOUDFLARE_ACCOUNT_ID:'b'.repeat(32)};
  let unexpectedPosts=0;
  const unexpected=async()=>{unexpectedPosts++;throw new Error('Configuration denial reached provider');};
  const rerouted=new ContactVerificationDelivery(db,changedAccount,new CloudflareEmail(changedAccount,unexpected));
  assert.equal(await rerouted.process(await own(lostPrepare.job)),'retry');assert.equal(unexpectedPosts,0);
  assert.equal(await sql.query(`select encrypted_prepared from fmat.contact_verification_deliveries where outbox_id='${lostPrepare.outbox}';`),frozen);
  assert.equal(await sql.query(`select dispatched_at is null from fmat.contact_verification_deliveries where outbox_id='${lostPrepare.outbox}';`),'t');
  await sql.query(`do $$begin update fmat.contact_verification_deliveries set encrypted_prepared='changed' where outbox_id='${lostPrepare.outbox}';raise exception 'mutable fixture';exception when raise_exception then if sqlerrm<>'IMMUTABLE_DELIVERY' then raise;end if;end$$;`);
  assert.equal(await worker().process(await own(lostPrepare.job)),'sent');assert.equal(posts,count+1);assert.equal(await sql.query(`select encrypted_prepared from fmat.contact_verification_deliveries where outbox_id='${lostPrepare.outbox}';`),frozen);
  for(const patch of [{CLOUDFLARE_EMAIL_API_TOKEN:''},{CLOUDFLARE_ACCOUNT_ID:'invalid'},{CLOUDFLARE_EMAIL_FROM:'other@example.test'}]){
   const f=await fixture(),invalidEnv={...env,...patch},owned=await own(f.job);
   const invalidWorker=new ContactVerificationDelivery(db,invalidEnv,new CloudflareEmail(invalidEnv,unexpected));
   assert.equal(await invalidWorker.process(owned),'retry');assert.equal(unexpectedPosts,0);
   assert.equal(await sql.query(`select not exists(select 1 from fmat.contact_verification_deliveries where outbox_id='${f.outbox}');`),'t');
   assert.equal((await service.read(f.guest,{requestId:f.id})).status,'pending');
   count=posts;assert.equal(await worker().process(await own(f.job)),'sent');assert.equal(posts,count+1);
  }
  // Managed preview restrictions deny both fresh and potentially dispatched
  // work before touching the durable state; they never relabel uncertainty.
  const previewEnv={...env,VERCEL_ENV:'preview'},previewWorker=new ContactVerificationDelivery(db,previewEnv,new CloudflareEmail(previewEnv,unexpected));
  for(const dispatched of [false,true]){
   const f=await fixture(),owned=await own(f.job);
   if(dispatched){mode='lost';assert.equal(await worker().process(owned),'uncertain');mode='success';}
   const durable=()=>sql.query(`select jsonb_build_array(o.status,d.encrypted_prepared,d.dispatched_at,j.status,j.lease_token) from fmat.outbox o left join fmat.contact_verification_deliveries d on d.outbox_id=o.id join fmat.jobs j on j.id='${f.job}' where o.id='${f.outbox}';`);
   const beforeState=await durable();count=posts;
   await assert.rejects(previewWorker.process(owned),{code:'CONFIGURATION_UNAVAILABLE'});
   assert.equal(await durable(),beforeState);assert.equal(posts,count);assert.equal(unexpectedPosts,0);
   assert.equal((await service.read(f.guest,{requestId:f.id})).status,'pending');
  }
  const lostDispatch=await fixture();dropped=false;count=posts;assert.equal(await worker(lose('dispatch')).process(await own(lostDispatch.job)),'uncertain');assert.equal(dropped,true);assert.equal(posts,count);
  const lostRecord=await fixture();dropped=false;await worker(lose('record')).process(await own(lostRecord.job));assert.equal(dropped,true);assert.equal(await status(lostRecord.outbox),'sent');assert.equal(posts,count+1);
  const expired=await fixture();mode='expired';assert.equal(await worker().process(await own(expired.job)),'lease_lost');mode='success';count=posts;assert.equal(await worker().process(await own(expired.job)),'uncertain');assert.equal(posts,count);
  // Every authority/content recheck happens again after preparation and before HTTP.
  for(const change of ['email','recipient','rotation','revocation','token_expiry','request_expiry','closed','booking','challenge_expiry','consumed','locked','superseded']){
   const f=await fixture();let changed=false;const stale=new Database(env,async(url,init)=>{const response=await fetch(url,init);if(!changed&&response.ok&&JSON.parse(String(init?.body)).p_operation==='prepare'){
    changed=true;
    const mutations:Record<string,string>={email:`details=details||'{"requesterEmail":"other@example.test"}'`,rotation:`token_hash='${createHash('sha256').update(f.id).digest('hex')}'`,revocation:'token_revoked_at=clock_timestamp()',token_expiry:"token_expires_at=clock_timestamp()-interval '1 second'",request_expiry:"created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second'",closed:"status='withdrawn'",booking:"status='booking'"};
    if(mutations[change])await sql.query(`update fmat.requests set ${mutations[change]} where id='${f.id}';`);
    else if(change==='recipient')await sql.query(`update fmat.outbox set recipient='{"email":"other@example.test"}' where id='${f.outbox}';`);
    else if(change==='superseded'){await sql.query(`update fmat.contact_verifications set created_at=created_at-interval '61 seconds' where id='${f.challengeId}';`);await service.start(f.guest,{requestId:f.id,revision:1,email:'guest@example.test',idempotencyKey:randomUUID()});}
    else await sql.query(`update fmat.contact_verifications set ${change==='locked'?'failed_attempts=5':change==='consumed'?'consumed_at=clock_timestamp()':"expires_at=clock_timestamp()-interval '1 second'"} where id='${f.challengeId}';`);
   }return response;});
   count=posts;assert.equal(await worker(stale).process(await own(f.job)),'suppressed',change);assert.equal(changed,true);assert.equal(posts,count);
  }
  // Expiry during a row-lock wait must use wall-clock time after acquiring the lock.
  const waited=await fixture(),waitLease=await own(waited.job),lock=new LocalSql();
  try{await lock.query(`begin;update fmat.requests set token_expires_at=clock_timestamp()+interval '200 milliseconds' where id='${waited.id}';`);const pending=worker().process(waitLease);await new Promise(resolve=>setTimeout(resolve,350));await lock.query('commit;');count=posts;assert.equal(await pending,'suppressed');assert.equal(posts,count);}finally{lock.close();}
  for(const crashed of [false,true]){
   const f=await fixture(),owned=await own(f.job);await sql.query(`update fmat.jobs set attempts=max_attempts,available_at='1900-01-01'${crashed?",lease_until=clock_timestamp()-interval '1 second'":''} where id='${f.job}';`);count=posts;
   if(crashed)assert.deepEqual(await worker().run(),{claimed:1,outcome:'failed'});else await new ContactVerificationDelivery(db,{...env,TOKEN_ENCRYPTION_KEY:'invalid'},provider).process(owned);
   assert.equal(await status(f.outbox),'failed');assert.equal(posts,count);
  }
  const wrong=await fixture(),wrongLease=await own(wrong.job);await sql.query(`update fmat.jobs set kind='delivery' where id='${wrong.job}';`);await assert.rejects(call('load',wrongLease));
  assert.equal(await sql.query(`select count(*) from fmat.requests where host_id='${host}' and (requester_agreed_version is not null or host_approved_version is not null or event is not null);`),'0');
  assert.equal(await sql.query(`select has_function_privilege('anon','public.fmat_contact_verification_delivery(text,jsonb,jsonb)','execute')||','||has_function_privilege('authenticated','public.fmat_contact_verification_delivery(text,jsonb,jsonb)','execute')||','||has_function_privilege('service_role','public.fmat_contact_verification_delivery(text,jsonb,jsonb)','execute')||','||has_table_privilege('service_role','fmat.contact_verification_deliveries','select');`),'false,false,true,false');
 }finally{
  sql.close();const cleanup=new LocalSql();
  for(const id of requests)await cleanup.query(`set session_replication_role=replica;delete from fmat.contact_verification_deliveries where request_id='${id}';${cleanupFixtureJobsSql(`payload->>'outboxId' in(select id::text from fmat.outbox where payload->>'requestId'='${id}')`)}delete from fmat.audit_events where subject_id in(select id::text from fmat.outbox where payload->>'requestId'='${id}');delete from fmat.contact_confirmations where request_id='${id}';delete from fmat.contact_verifications where request_id='${id}';delete from fmat.outbox where payload->>'requestId'='${id}';delete from fmat.audit_events where subject_id='${id}';delete from fmat.request_history where request_id='${id}';delete from fmat.requests where id='${id}';set session_replication_role=origin;`);
  await cleanup.query(`delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invite}';`);cleanup.close();
 }
});
