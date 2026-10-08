import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {ContactVerification} from '../../lib/server/contact/verification.ts';
import {Database} from '../../lib/server/database/client.ts';
import {guestCredential} from '../../lib/server/identity/credentials.ts';
import {TokenCipher} from '../../lib/server/calendar/encryption.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {LocalSql} from './local-sql.ts';
const errorCode=(code:string)=>(e:unknown)=>e instanceof ApplicationError&&e.code===code;
test('Contact proof is request-bound, attempt-limited and replayable without account or booking authority',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const env={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,19).toString('base64')},db=new Database(env),service=new ContactVerification(db,env),cipher=new TokenCipher(env),sql=new LocalSql();
 const host=randomUUID(),invite=randomUUID(),requests:string[]=[];
 async function fixture(){const id=randomUUID(),token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex');requests.push(id);await sql.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values('${id}','${host}','{"requesterEmail":"guest@example.test","purpose":"PRIVATE PURPOSE"}','${hash}',clock_timestamp()+interval '1 day');`);return {id,hash,guest:guestCredential(id,token)};}
 const input=(id:string)=>({requestId:id,revision:1,email:'guest@example.test',idempotencyKey:randomUUID()});
 async function secret(id:string,challengeId:string){const value=await sql.query(`select encrypted_code from fmat.contact_verifications where id='${challengeId}';`);return (cipher.open(value,'contact-verification:'+id+':'+challengeId) as {code:string}).code;}
 async function cool(id:string){await sql.query(`update fmat.contact_verifications set created_at=created_at-interval '61 seconds' where request_id='${id}';`);}
 try{
  await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invite}','host@example.test','${createHash('sha256').update(invite).digest('hex')}',now()+interval '1 day','contact-fixture');insert into fmat.hosts(id,email,invitation_id) values('${host}','host@example.test','${invite}');`);
  const r=await fixture(),start=input(r.id);assert.equal((await service.read(r.guest,{requestId:r.id})).status,'unverified');
  await assert.rejects(service.start({...r.guest},start),errorCode('UNAUTHORIZED'));
  await assert.rejects(service.start(r.guest,{...start,email:'other@example.test'}),errorCode('STALE_REVISION'));
  const results=await Promise.all(Array.from({length:8},()=>service.start(r.guest,start))),challengeId=results[0].state.challengeId!;
  assert.ok(results.every(x=>x.state.challengeId===challengeId));
  for(const table of ['contact_verifications','outbox'])assert.equal(await sql.query(table==='outbox'?`select count(*) from fmat.outbox where payload->>'requestId'='${r.id}';`:`select count(*) from fmat.${table} where request_id='${r.id}';`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.jobs where kind='contact_verification_delivery' and payload->>'outboxId'=(select outbox_id::text from fmat.contact_verifications where id='${challengeId}');`),'1');
  assert.equal(JSON.stringify(results).includes('PRIVATE PURPOSE'),false);assert.equal(JSON.stringify(results).includes('codeHash'),false);
  await assert.rejects(service.start(r.guest,input(r.id)),errorCode('CONTACT_LIMIT'));
  const actual=await secret(r.id,challengeId),wrong=actual==='000000'?'000001':'000000';
  const confirmation={requestId:r.id,challengeId,code:wrong,idempotencyKey:randomUUID()};
  const failures=await Promise.all(Array.from({length:8},()=>service.confirm(r.guest,confirmation)));assert.ok(failures.every(x=>x.outcome==='invalid_code'&&x.state.attemptsRemaining===4));
  await assert.rejects(service.confirm(r.guest,{...confirmation,code:actual}),errorCode('IDEMPOTENCY_CONFLICT'));
  for(let i=0;i<4;i++)await service.confirm(r.guest,{...confirmation,idempotencyKey:randomUUID()});
  assert.equal((await service.confirm(r.guest,{...confirmation,code:actual,idempotencyKey:randomUUID()})).outcome,'locked');assert.equal((await service.read(r.guest,{requestId:r.id})).status,'locked');
  await cool(r.id);const next=await service.start(r.guest,input(r.id));assert.notEqual(next.state.challengeId,challengeId);
  assert.equal((await service.confirm(r.guest,{...confirmation,code:actual,idempotencyKey:randomUUID()})).outcome,'superseded');
  const verify={requestId:r.id,challengeId:next.state.challengeId!,code:await secret(r.id,next.state.challengeId!),idempotencyKey:randomUUID()};let dropped=false;
  const lost=new ContactVerification(new Database(env,async(url,init)=>{const response=await fetch(url,init);if(response.ok&&!dropped){dropped=true;throw new Error('lost committed verification response');}return response;}),env);
  await assert.rejects(lost.confirm(r.guest,verify));assert.equal(dropped,true);
  const verified=await service.confirm(r.guest,verify);assert.equal(verified.outcome,'verified');assert.equal(verified.state.revision,2);assert.equal((await service.confirm(r.guest,verify)).state.revision,2);
  assert.equal(await sql.query(`select count(*) from fmat.audit_events where subject_id='${r.id}' and operation='contact_verified';`),'1');
  assert.equal(await sql.query(`select requester_agreed_version is null and host_approved_version is null and event is null and token_hash='${r.hash}' from fmat.requests where id='${r.id}';`),'t');
  assert.equal(await sql.query(`select count(*) from fmat.booking_attempts where request_id='${r.id}';`),'0');
  const cross=await fixture();await assert.rejects(service.read(cross.guest,{requestId:r.id}),errorCode('NOT_FOUND'));
  // Authority/contact changes invalidate even an otherwise correct code.
  for(const change of ['email','rotation','revocation','token_expiry','request_expiry','closed','booking','challenge_expiry']){
   const f=await fixture(),sent=await service.start(f.guest,input(f.id)),id=sent.state.challengeId!,code=await secret(f.id,id);
   const mutations:Record<string,string>={email:`details=details||'{"requesterEmail":"other@example.test"}'`,rotation:`token_hash=repeat('e',64)`,revocation:'token_revoked_at=clock_timestamp()',token_expiry:"token_expires_at=clock_timestamp()-interval '1 second'",request_expiry:"created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second'",closed:"status='withdrawn'",booking:"status='booking'"};
   if(change==='challenge_expiry'){await sql.query(`update fmat.contact_verifications set expires_at=clock_timestamp()-interval '1 second' where id='${id}';`);assert.equal((await service.confirm(f.guest,{requestId:f.id,challengeId:id,code,idempotencyKey:randomUUID()})).outcome,'expired');}
   else{await sql.query(`update fmat.requests set ${mutations[change]} where id='${f.id}';`);await assert.rejects(service.confirm(f.guest,{requestId:f.id,challengeId:id,code,idempotencyKey:randomUUID()}),errorCode(change==='email'?'CHALLENGE_INVALID':'NOT_FOUND'));}
   assert.equal(await sql.query(`select contact_verified_email is null from fmat.requests where id='${f.id}';`),'t');
  }
  const waited=await fixture(),lock=new LocalSql();
  try{
   await lock.query(`begin;update fmat.requests set token_expires_at=clock_timestamp()+interval '200 milliseconds' where id='${waited.id}';`);
   const rejected=assert.rejects(service.read(waited.guest,{requestId:waited.id}),errorCode('NOT_FOUND'));
   await new Promise(resolve=>setTimeout(resolve,350));await lock.query('commit;');await rejected;
  }finally{lock.close();}
  const hourly=await fixture();for(let i=0;i<5;i++){await service.start(hourly.guest,input(hourly.id));await cool(hourly.id);}await assert.rejects(service.start(hourly.guest,input(hourly.id)),errorCode('CONTACT_LIMIT'));
  for(const op of ['contact_start','contact_confirm'])await assert.rejects(db.rpc('fmat_command',{p_operation:op,p_actor:{kind:'guest',requestId:hourly.id,tokenHash:hourly.hash},p_input:{requestId:hourly.id,idempotencyKey:randomUUID()}}),errorCode('FORBIDDEN'));
  assert.equal(await sql.query(`select has_function_privilege('anon','public.fmat_contact_verification(text,jsonb,jsonb)','execute')||','||has_function_privilege('authenticated','public.fmat_contact_verification(text,jsonb,jsonb)','execute')||','||has_function_privilege('service_role','public.fmat_contact_verification(text,jsonb,jsonb)','execute');`),'false,false,true');
  assert.equal(await sql.query(`select has_table_privilege('service_role','fmat.contact_verifications','select');`),'f');
 }finally{
  for(const id of requests)await sql.query(`set session_replication_role=replica;delete from fmat.jobs where payload->>'outboxId' in(select id::text from fmat.outbox where payload->>'requestId'='${id}');delete from fmat.contact_confirmations where request_id='${id}';delete from fmat.contact_verifications where request_id='${id}';delete from fmat.outbox where payload->>'requestId'='${id}';delete from fmat.audit_events where subject_id='${id}';delete from fmat.request_history where request_id='${id}';delete from fmat.requests where id='${id}';set session_replication_role=origin;`);
  await sql.query(`delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invite}';`);sql.close();
 }
});
