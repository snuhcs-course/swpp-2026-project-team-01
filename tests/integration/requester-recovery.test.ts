import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {RequesterRecovery} from '../../lib/server/contact/recovery.ts';
import {Database} from '../../lib/server/database/client.ts';
import {TokenCipher} from '../../lib/server/calendar/encryption.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {LocalSql,cleanupFixtureJobsSql} from './local-sql.ts';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const invalid=(e:unknown)=>e instanceof ApplicationError&&e.code==='CHALLENGE_INVALID';
test('Recovery proves original verified contact, rotates one credential, and preserves bounded retries without login or decisions',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const env={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,23).toString('base64')};
 const db=new Database(env),service=new RequesterRecovery(db,env),cipher=new TokenCipher(env),sql=new LocalSql(),host=randomUUID(),invite=randomUUID(),ids:string[]=[],emails=new Map<string,string>();
 async function fixture(verified=true){const id=randomUUID(),token=randomBytes(32).toString('base64url');ids.push(id);emails.set(id,id+'@example.test');await sql.query(`insert into fmat.requests(id,host_id,details,token_hash,contact_verified_email,expires_at) values('${id}','${host}','{"requesterEmail":"${id}@example.test","purpose":"PRIVATE PURPOSE"}','${hash(token)}',${verified?`'${id}@example.test'`:'null'},clock_timestamp()+interval '1 day');`);return {id,token};}
 const start=(requestId:string)=>({requestId,email:emails.get(requestId)??'unknown@example.test',idempotencyKey:randomUUID()});
 async function proof(requestId:string){const row=JSON.parse(await sql.query(`select json_build_object('id',id,'encrypted',encrypted_proof) from fmat.requester_recoveries where request_id='${requestId}' order by created_at desc limit 1;`));return {requestId,challengeId:row.id,proof:(cipher.open(row.encrypted,'requester-recovery:'+requestId+':'+row.id) as {proof:string}).proof};}
 async function cool(id:string){await sql.query(`update fmat.requester_recoveries set created_at=created_at-interval '61 seconds' where request_id='${id}';`);}
 try{
  await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invite}','host@example.test','${hash(invite)}',now()+interval '1 day','recovery-fixture');insert into fmat.hosts(id,email,invitation_id) values('${host}','host@example.test','${invite}');`);
  const r=await fixture(),unverified=await fixture(false),input=start(r.id),accepted={status:'accepted'};
  for(const value of [start(randomUUID()),start(unverified.id),{...input,email:'wrong@example.test'}])assert.deepEqual(await service.start(value),accepted);
  assert.equal(await sql.query(`select count(*) from fmat.requester_recoveries where request_id in('${r.id}','${unverified.id}');`),'0');
  assert.ok((await Promise.all(Array.from({length:8},()=>service.start(input)))).every(v=>JSON.stringify(v)===JSON.stringify(accepted)));
  assert.equal(await sql.query(`select count(*) from fmat.requester_recoveries where request_id='${r.id}';`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.outbox where payload->>'requestId'='${r.id}';`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.jobs where kind='requester_recovery_delivery' and payload->>'outboxId' in(select outbox_id::text from fmat.requester_recoveries where request_id='${r.id}');`),'1');
  assert.deepEqual(await service.start(start(r.id)),accepted);assert.equal(await sql.query(`select count(*) from fmat.requester_recoveries where request_id='${r.id}';`),'1');
  const p=await proof(r.id);await assert.rejects(service.redeem({...p,proof:randomBytes(32).toString('base64url')}),invalid);await assert.rejects(service.redeem({...p,requestId:unverified.id}),invalid);
  let dropped=false;const lost=new RequesterRecovery(new Database(env,async(url,init)=>{const response=await fetch(url,init);if(response.ok&&!dropped){dropped=true;throw new Error('lost committed response');}return response;}),env);
  await assert.rejects(lost.redeem(p));assert.equal(dropped,true);
  const results=await Promise.all(Array.from({length:8},()=>service.redeem(p)));assert.ok(results.every(v=>v.token===results[0].token));assert.notEqual(results[0].token,r.token);
  assert.equal(await sql.query(`select token_hash='${hash(results[0].token)}' and revision=2 and requester_agreed_version is null and host_approved_version is null and event is null from fmat.requests where id='${r.id}';`),'t');
  assert.equal(await sql.query(`select count(*) from fmat.audit_events where subject_id='${r.id}' and operation='requester_recovered';`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.booking_attempts where request_id='${r.id}';`),'0');
  await assert.rejects(db.rpc('fmat_requester_recovery',{p_operation:'redeem',p_input:{requestId:r.id,challengeId:p.challengeId,proofHash:hash(p.proof),newTokenHash:hash('changed')}}),invalid);
  await sql.query(`update fmat.requests set token_hash='${hash('later')}' where id='${r.id}';`);await assert.rejects(service.redeem(p),invalid);
  // Permanent invalidation must survive a contact change and change back.
  for(const change of ['contact','rotation','revocation','closed','booking','request_expiry','proof_expiry']){
   const f=await fixture();await service.start(start(f.id));const candidate=await proof(f.id);
   const mutations:Record<string,string>={contact:`update fmat.requests set contact_verified_email=null where id='${f.id}';update fmat.requests set contact_verified_email='${f.id}@example.test' where id='${f.id}';`,rotation:`update fmat.requests set token_hash='${hash(randomUUID())}' where id='${f.id}';`,revocation:`update fmat.requests set token_revoked_at=clock_timestamp() where id='${f.id}';`,closed:`update fmat.requests set status='withdrawn' where id='${f.id}';`,booking:`update fmat.requests set status='booking' where id='${f.id}';`,request_expiry:`update fmat.requests set created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second' where id='${f.id}';`,proof_expiry:`update fmat.requester_recoveries set expires_at=clock_timestamp()-interval '1 second' where id='${candidate.challengeId}';`};
   await sql.query(mutations[change]);await assert.rejects(service.redeem(candidate),invalid);
  }
  const hourly=await fixture();await service.start(start(hourly.id));const first=await proof(hourly.id);
  for(let i=1;i<5;i++){await cool(hourly.id);await service.start(start(hourly.id));}
  await assert.rejects(service.redeem(first),invalid);await cool(hourly.id);assert.deepEqual(await service.start(start(hourly.id)),accepted);assert.equal(await sql.query(`select count(*) from fmat.requester_recoveries where request_id='${hourly.id}';`),'5');
  const waiting=await fixture();await service.start(start(waiting.id));const candidate=await proof(waiting.id),lock=new LocalSql();
  try{await lock.query(`begin;select id from fmat.requests where id='${waiting.id}' for update;update fmat.requester_recoveries set expires_at=clock_timestamp()+interval '150 milliseconds' where id='${candidate.challengeId}';`);const denied=assert.rejects(service.redeem(candidate),invalid);await new Promise(resolve=>setTimeout(resolve,300));await lock.query('commit;');await denied;}finally{lock.close();}
  const lostStart=await fixture();let droppedStart=false;const issuer=new RequesterRecovery(new Database(env,async(url,init)=>{const response=await fetch(url,init);if(response.ok&&!droppedStart){droppedStart=true;throw new Error('lost issuance');}return response;}),env),original=start(lostStart.id);await assert.rejects(issuer.start(original));await service.start(original);assert.equal(await sql.query(`select count(*) from fmat.requester_recoveries where request_id='${lostStart.id}';`),'1');
  assert.equal(await sql.query(`select has_function_privilege('anon','public.fmat_requester_recovery(text,jsonb)','execute')||','||has_function_privilege('authenticated','public.fmat_requester_recovery(text,jsonb)','execute')||','||has_function_privilege('service_role','public.fmat_requester_recovery(text,jsonb)','execute');`),'false,false,true');
  assert.equal(await sql.query(`select has_table_privilege('service_role','fmat.requester_recoveries','select');`),'f');
 }finally{
  for(const id of ids)await sql.query(`set session_replication_role=replica;${cleanupFixtureJobsSql(`payload->>'outboxId' in(select id::text from fmat.outbox where payload->>'requestId'='${id}')`)}delete from fmat.requester_recoveries where request_id='${id}';delete from fmat.outbox where payload->>'requestId'='${id}';delete from fmat.audit_events where subject_id='${id}';delete from fmat.request_history where request_id='${id}';delete from fmat.requests where id='${id}';set session_replication_role=origin;`);
  await sql.query(`delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invite}';`);sql.close();
 }
});
