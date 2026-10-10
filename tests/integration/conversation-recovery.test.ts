import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalSql} from './local-sql.ts';

const q=(s:string)=>`'${s.replaceAll("'","''")}'`;
async function blocked(sql:LocalSql,name:string){
 for(let n=0;n<100;n++){
  if(await sql.query(`select exists(select 1 from pg_stat_activity where application_name=${q(name)} and wait_event_type='Lock');`)==='t')return;
  await delay(20);
 }
 assert.fail('Recovery did not enter the intended database lock wait');
}
test('recovery migration and transitions retain identity under races, lost responses and expiring authority',{timeout:60000},async()=>{
 const admin=new LocalSql(),locker=new LocalSql(),waiter=new LocalSql(),peers=Array.from({length:8},()=>new LocalSql());
 const host=randomUUID(),session=randomUUID(),invitation=randomUUID(),email=host+'@recovery.test';
 const rows=Array.from({length:4},()=>({scope:randomUUID(),request:randomUUID(),grant:randomUUID(),message:randomUUID(),client:randomUUID(),retry:randomUUID()}));
 const credential={kind:'host',subject:host,sessionId:session,expiresAt:new Date(Date.now()+3600000).toISOString()};
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
 const input=(n:number,retry:string=rows[n].retry)=>({expectedGeneration:0,idempotencyKey:retry,evidence:{sessionId:'runtime-'+rows[n].scope,generation:0,tailIndex:17,eventId:'event-'+rows[n].scope,usage:{inputTokens:40,outputTokens:2,cacheReadTokens:10,cacheWriteTokens:0}}});
 const recover=(n:number,retry?:string)=>`fmat.conversation_recovery_begin(${q(rows[n].grant)},${q(rows[n].scope)},${q(JSON.stringify(input(n,retry)))}::jsonb)`;
 const attempt=(n:number,retry?:string)=>`do $$begin perform set_config('test.recovery',${recover(n,retry)}::text,false);exception when raise_exception then perform set_config('test.recovery',sqlerrm,false);end$$;select current_setting('test.recovery');`;
 const name='recovery-wait-'+randomUUID();
 try{
  await admin.query(`insert into auth.users(id,email,email_confirmed_at) values(${q(host)},${q(email)},now());insert into auth.sessions(id,user_id) values(${q(session)},${q(host)});insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values(${q(invitation)},${q(email)},${q(hash(invitation))},now()+interval '1 day','recovery-fixture');insert into fmat.hosts(id,email,invitation_id) values(${q(host)},${q(email)},${q(invitation)});`);
  for(const row of rows)await admin.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values(${q(row.request)},${q(host)},'{}',${q(hash(row.request))},now()+interval '1 day');insert into fmat.conversation_scopes(id,host_id,request_id,audience,runtime_session_id) values(${q(row.scope)},${q(host)},${q(row.request)},'host_private',${q('runtime-'+row.scope)});insert into fmat.conversation_grants(id,conversation_id,actor_kind,authority_key,credential,expires_at) values(${q(row.grant)},${q(row.scope)},'host',${q(session)},${q(JSON.stringify(credential))}::jsonb,now()+interval '1 hour');insert into fmat.runtime_messages(id,conversation_id,grant_id,client_id,text,input_fingerprint,dispatch_attempts) values(${q(row.message)},${q(row.scope)},${q(row.grant)},${q(row.client)},'Pending recovery input',${q(hash(row.message))},2);insert into fmat.model_work_attempts values(${q('conversation:'+row.message)},3);`);
  await admin.query(`update fmat.conversation_scopes set runtime_session_id=null where id=${q(rows[3].scope)};`);
  const snapshot=()=>admin.query(`select jsonb_build_object('messages',(select jsonb_agg(to_jsonb(m) order by m.id) from fmat.runtime_messages m where conversation_id in(select id from fmat.conversation_scopes where host_id=${q(host)})),'grants',(select jsonb_agg(to_jsonb(g) order by g.id) from fmat.conversation_grants g where conversation_id in(select id from fmat.conversation_scopes where host_id=${q(host)})),'attempts',(select jsonb_agg(to_jsonb(a) order by name) from fmat.model_work_attempts a where name in(${rows.map(r=>q('conversation:'+r.message)).join(',')})));`);
  const before=await snapshot();
  // Execute the actual migration against populated fixtures, then roll it back
  // so the lazy enrollment path is independently exercised by recovery below.
  const backfill=readFileSync('supabase/migrations/20261009230830_backfill_conversation_generation_zero.sql','utf8');
  await admin.query('begin;'+backfill+backfill);
  assert.equal(await admin.query(`select count(*) from fmat.conversation_generations g join fmat.conversation_scopes s on s.id=g.conversation_id where s.host_id=${q(host)} and g.generation=0 and g.runtime_session_id is not distinct from s.runtime_session_id and g.created_at=s.created_at and g.retired_at is null and g.input_tokens is null;`),'4','backfill preserves exact existing IDs/timestamps and does not invent usage');
  assert.equal(await snapshot(),before);await admin.query('rollback;');
  const identical=await Promise.all(peers.map(sql=>sql.query(`select ${recover(0)};`)));
  assert.equal(new Set(identical).size,1,'eight simultaneous exact retries return one transition');
  assert.equal(await admin.query(`select ${recover(0)};`),identical[0],'lost response replay returns committed identity');
  const distinct=await Promise.all(peers.map(sql=>sql.query(attempt(1,randomUUID()))));
  assert.equal(distinct.filter(x=>x.startsWith('{')).length,1,'one distinct request wins');
  assert.equal(distinct.filter(x=>x==='STALE_REVISION').length,7,'other observed-generation requests cannot replace it');
  assert.equal(await admin.query(`select count(*) from fmat.conversation_recoveries where conversation_id in(${q(rows[0].scope)},${q(rows[1].scope)});`),'2');
  assert.equal(await snapshot(),before,'concurrency does not rotate grants, replay inputs, reset dispatch or refund attempts');
  await waiter.query(`set application_name=${q(name)};`);
  // Force real row-lock waits, not a sleep before the operation starts.
  for(const phase of ['grant','session','request','scope'] as const){
   await admin.query(`update fmat.conversation_grants set expires_at=clock_timestamp()+interval '1 hour' where id=${q(rows[2].grant)};update auth.sessions set not_after=null where id=${q(session)};update fmat.requests set expires_at=clock_timestamp()+interval '1 day' where id=${q(rows[2].request)};`);
   if(phase==='session')await admin.query(`update auth.sessions set not_after=clock_timestamp()+interval '0.5 seconds' where id=${q(session)};`);
   else if(phase==='request')await admin.query(`update fmat.requests set expires_at=clock_timestamp()+interval '0.5 seconds' where id=${q(rows[2].request)};`);
   else await admin.query(`update fmat.conversation_grants set expires_at=clock_timestamp()+interval '0.5 seconds' where id=${q(rows[2].grant)};`);
   await locker.query(phase==='scope'?`begin;select 1 from fmat.conversation_scopes where id=${q(rows[2].scope)} for share;`:`begin;select 1 from fmat.requests where id=${q(rows[2].request)} for update;`);
   const pending=waiter.query(attempt(2));await blocked(admin,name);await locker.query('select pg_sleep(0.7);commit;');
   assert.equal(await pending,phase==='request'?'REQUEST_CLOSED':'UNAUTHORIZED',phase+' expiry during a verified lock wait');
   assert.equal(await admin.query(`select runtime_generation||':'||runtime_session_id from fmat.conversation_scopes where id=${q(rows[2].scope)};`),'0:runtime-'+rows[2].scope);
   assert.equal(await admin.query(`select count(*) from fmat.conversation_recoveries where conversation_id=${q(rows[2].scope)};`),'0');
  }
  await admin.query(`update fmat.conversation_grants set expires_at=clock_timestamp()+interval '1 hour' where id=${q(rows[2].grant)};`);
  await locker.query(`begin;select 1 from fmat.requests where id=${q(rows[2].request)} for update;`);
  const revoked=waiter.query(attempt(2));await blocked(admin,name);
  await locker.query(`update fmat.conversation_grants set revoked_at=clock_timestamp() where id=${q(rows[2].grant)};commit;`);
  assert.equal(await revoked,'UNAUTHORIZED','revocation wins before authority locks are acquired');
  assert.equal(await admin.query(`select count(*) from fmat.conversation_generations where conversation_id=${q(rows[2].scope)};`),'0','denials never leave partial ledger rows');
  // The live-usage floor introduces a later row lock. Expiry must be checked
  // again after this wait for both recovery and a new model reservation.
  const usageRow=rows[3];
  await admin.query(`update fmat.conversation_scopes set runtime_session_id=${q('runtime-'+usageRow.scope)} where id=${q(usageRow.scope)};insert into fmat.conversation_generations(conversation_id,generation,runtime_session_id) values(${q(usageRow.scope)},0,${q('runtime-'+usageRow.scope)});insert into fmat.conversation_model_usage values(${q(usageRow.scope)},0,0,0,0,0);`);
  for(const operation of ['recovery','reservation']){
   await admin.query(`update fmat.conversation_grants set expires_at=clock_timestamp()+interval '0.5 seconds' where id=${q(usageRow.grant)};`);
   await locker.query(`begin;select 1 from fmat.conversation_model_usage where conversation_id=${q(usageRow.scope)} for update;`);
   const reserve=`do $$begin perform public.fmat_conversation_model_reserve(${q(usageRow.grant)},${q(usageRow.scope)},${q(usageRow.message)},${q('runtime-'+usageRow.scope)},'{"inputTokens":1,"outputTokens":1,"cacheReadTokens":0,"cacheWriteTokens":0}');perform set_config('test.recovery','reserved',false);exception when raise_exception then perform set_config('test.recovery',sqlerrm,false);end$$;select current_setting('test.recovery');`;
   const pending=waiter.query(operation==='recovery'?attempt(3):reserve);await blocked(admin,name);await locker.query('select pg_sleep(0.7);commit;');
   assert.equal(await pending,'UNAUTHORIZED',operation+' rechecks expiry after the observed live-usage lock');
   assert.equal(await admin.query(`select count(*) from fmat.conversation_recoveries where conversation_id=${q(usageRow.scope)};`),'0');
   assert.equal(await admin.query(`select input_tokens from fmat.conversation_model_usage where conversation_id=${q(usageRow.scope)};`),'0','denial rolls back the observed usage floor');
   assert.equal(await admin.query(`select attempts from fmat.model_work_attempts where name=${q('conversation:'+usageRow.message)};`),'3','denial preserves charged attempts');
  }
 }finally{
  await locker.query('rollback;').catch(()=>{});await admin.query('rollback;').catch(()=>{});
  const cleanup=new LocalSql();
  try{await cleanup.query(`delete from fmat.conversation_recoveries where conversation_id in(select id from fmat.conversation_scopes where host_id=${q(host)});delete from fmat.conversation_generations where conversation_id in(select id from fmat.conversation_scopes where host_id=${q(host)});delete from fmat.model_work_attempts where name in(${rows.map(r=>q('conversation:'+r.message)).join(',')});delete from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where host_id=${q(host)});delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where host_id=${q(host)});delete from fmat.audit_events where subject_id in(${rows.map(r=>q(r.scope)).join(',')});delete from fmat.conversation_scopes where host_id=${q(host)};delete from fmat.requests where host_id=${q(host)};delete from fmat.hosts where id=${q(host)};delete from fmat.invitations where id=${q(invitation)};delete from auth.sessions where user_id=${q(host)};delete from auth.users where id=${q(host)};`);}
  finally{for(const sql of [admin,locker,waiter,cleanup,...peers])sql.close();}
 }
});
