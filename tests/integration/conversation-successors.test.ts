import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalSql} from './local-sql.ts';
const q=(value:string)=>`'${value.replaceAll("'","''")}'`;
async function blocked(sql:LocalSql,name:string){
 for(let n=0;n<100;n++){
  if(await sql.query(`select exists(select 1 from pg_stat_activity where application_name=${q(name)} and wait_event_type='Lock');`)==='t')return;
  await delay(20);
 }
 assert.fail('Successor operation did not enter the intended lock wait');
}
test('successor permits bind once under concurrent creation, delayed delivery and expiring original authority',{timeout:60000},async()=>{
 const admin=new LocalSql(),locker=new LocalSql(),waiter=new LocalSql(),peers=Array.from({length:8},()=>new LocalSql());
 const host=randomUUID(),session=randomUUID(),invitation=randomUUID(),email=host+'@successor.test';
 const rows=Array.from({length:3},()=>({scope:randomUUID(),request:randomUUID(),grant:randomUUID(),message:randomUUID(),client:randomUUID()}));
 const credential={kind:'host',subject:host,sessionId:session,expiresAt:new Date(Date.now()+3600000).toISOString()};
 const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
 const call=(n:number,op:string,extra:Record<string,unknown>={})=>`fmat.conversation_successor(${q(op)},${q(rows[n].grant)},${q(rows[n].scope)},${q(JSON.stringify({generation:1,messageId:rows[n].message,...extra}))}::jsonb)`;
 const attempt=(sql:string)=>`do $$begin perform set_config('test.successor',${sql}::text,false);exception when raise_exception then perform set_config('test.successor',sqlerrm,false);end$$;select current_setting('test.successor');`;
 const name='successor-wait-'+randomUUID();
 try{
  await admin.query(`insert into auth.users(id,email,email_confirmed_at) values(${q(host)},${q(email)},now());insert into auth.sessions(id,user_id) values(${q(session)},${q(host)});insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values(${q(invitation)},${q(email)},${q(hash(invitation))},now()+interval '1 day','successor-fixture');insert into fmat.hosts(id,email,invitation_id) values(${q(host)},${q(email)},${q(invitation)});`);
  for(const row of rows){
   await admin.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values(${q(row.request)},${q(host)},'{}',${q(hash(row.request))},now()+interval '1 day');insert into fmat.conversation_scopes(id,host_id,request_id,audience,runtime_session_id) values(${q(row.scope)},${q(host)},${q(row.request)},'host_private',${q('old-'+row.scope)});insert into fmat.conversation_grants(id,conversation_id,actor_kind,authority_key,credential,expires_at) values(${q(row.grant)},${q(row.scope)},'host',${q(session)},${q(JSON.stringify(credential))}::jsonb,now()+interval '1 hour');insert into fmat.runtime_messages(id,conversation_id,grant_id,client_id,text,input_fingerprint) values(${q(row.message)},${q(row.scope)},${q(row.grant)},${q(row.client)},'Original pending input',${q(hash(row.message))});insert into fmat.model_work_attempts values(${q('conversation:'+row.message)},3);`);
   await admin.query(`select fmat.conversation_recovery_begin(${q(row.grant)},${q(row.scope)},${q(JSON.stringify({expectedGeneration:0,idempotencyKey:randomUUID(),evidence:{sessionId:'old-'+row.scope,generation:0,tailIndex:5,eventId:'terminal',usage:{inputTokens:100,outputTokens:10,cacheReadTokens:0,cacheWriteTokens:0}}}))}::jsonb);`);
  }
  const before=await admin.query(`select jsonb_agg(to_jsonb(m) order by m.id) from fmat.runtime_messages m where conversation_id in(select id from fmat.conversation_scopes where host_id=${q(host)});`);
  const claims=await Promise.all(peers.map(sql=>sql.query(`select ${call(0,'claim')};`)));
  assert.equal(new Set(claims).size,1,'eight claims share one durable creation identity');
  const claim=JSON.parse(claims[0]);
  const starts=(await Promise.all(peers.map(sql=>sql.query(`select ${call(0,'start',{leaseToken:claim.leaseToken})};`)))).map(value=>JSON.parse(value));
  assert.equal(starts.filter(value=>value.dispatch).length,1,'only one external creation send is permitted');
  await admin.query(`update fmat.conversation_successors set lease_until=clock_timestamp()-interval '1 minute' where conversation_id=${q(rows[0].scope)};`);
  const resumed=JSON.parse(await admin.query(`select ${call(0,'claim')};`));
  assert.equal(resumed.state,'creating');assert.equal(resumed.creationKey,claim.creationKey);assert.equal(resumed.leaseToken,claim.leaseToken);
  assert.equal(JSON.parse(await admin.query(`select ${call(0,'start',{leaseToken:claim.leaseToken})};`)).dispatch,false,'unknown send remains uncertain after expiry');
  const bindings=await Promise.all(peers.map((sql,i)=>sql.query(attempt(call(0,'bind',{creationKey:claim.creationKey,sessionId:'candidate-'+rows[0].scope+'-'+i})))));
  assert.equal(bindings.filter(value=>value.startsWith('{')).length,1);assert.equal(bindings.filter(value=>value==='FORBIDDEN').length,7);
  const winner=JSON.parse(bindings.find(value=>value.startsWith('{'))!);
  assert.equal(await admin.query(`select ${call(0,'bind',{creationKey:claim.creationKey,sessionId:winner.sessionId})};`),bindings.find(value=>value.startsWith('{'))!,'lost bind acknowledgement preserves the winner');
  assert.equal(await admin.query(`select count(*) from fmat.audit_events where operation='conversation_successor_bound' and subject_id=${q(rows[0].scope)};`),'1');
  const waiting=JSON.parse(await admin.query(`select ${call(1,'claim')};`));
  await admin.query(`select ${call(1,'start',{leaseToken:waiting.leaseToken})};`);
  await waiter.query(`set application_name=${q(name)};`);
  const binding=call(1,'bind',{creationKey:waiting.creationKey,sessionId:'new-'+rows[1].scope});
  for(const phase of ['grant','session','request','scope','message','successor'] as const){
   await admin.query(`update fmat.conversation_grants set expires_at=clock_timestamp()+interval '1 hour' where id=${q(rows[1].grant)};update auth.sessions set not_after=null where id=${q(session)};update fmat.requests set expires_at=clock_timestamp()+interval '1 day' where id=${q(rows[1].request)};`);
   if(phase==='session')await admin.query(`update auth.sessions set not_after=clock_timestamp()+interval '0.5 seconds' where id=${q(session)};`);
   else if(phase==='request')await admin.query(`update fmat.requests set expires_at=clock_timestamp()+interval '0.5 seconds' where id=${q(rows[1].request)};`);
   else await admin.query(`update fmat.conversation_grants set expires_at=clock_timestamp()+interval '0.5 seconds' where id=${q(rows[1].grant)};`);
   const lock=phase==='successor'?`select 1 from fmat.conversation_successors where conversation_id=${q(rows[1].scope)} for update;`:phase==='scope'?`select 1 from fmat.conversation_scopes where id=${q(rows[1].scope)} for share;`:phase==='message'?`select 1 from fmat.runtime_messages where id=${q(rows[1].message)} for update;`:`select 1 from fmat.requests where id=${q(rows[1].request)} for update;`;
   await locker.query('begin;'+lock);const result=waiter.query(attempt(binding));
   await blocked(admin,name);await locker.query('select pg_sleep(0.7);commit;');
   assert.equal(await result,phase==='request'?'REQUEST_CLOSED':'UNAUTHORIZED',phase+' expiry is rechecked after observed locks');
   assert.equal(await admin.query(`select runtime_session_id is null from fmat.conversation_scopes where id=${q(rows[1].scope)};`),'t');
   assert.equal(await admin.query(`select bound_at is null from fmat.conversation_successors where conversation_id=${q(rows[1].scope)};`),'t');
  }
  await admin.query(`update fmat.conversation_grants set expires_at=clock_timestamp()+interval '1 hour' where id=${q(rows[1].grant)};`);
  await locker.query(`begin;select 1 from fmat.requests where id=${q(rows[1].request)} for update;`);
  const revoked=waiter.query(attempt(binding));await blocked(admin,name);
  await locker.query(`update fmat.conversation_grants set revoked_at=clock_timestamp() where id=${q(rows[1].grant)};commit;`);
  assert.equal(await revoked,'UNAUTHORIZED','revocation denies late binding without minting new authority');
  const prepared=JSON.parse(await admin.query(`select ${call(2,'claim')};`));
  await admin.query(`update fmat.conversation_successors set lease_until=clock_timestamp()+interval '0.5 seconds' where conversation_id=${q(rows[2].scope)};`);
  await locker.query(`begin;select 1 from fmat.runtime_messages where id=${q(rows[2].message)} for update;`);
  const expired=waiter.query(attempt(call(2,'start',{leaseToken:prepared.leaseToken})));await blocked(admin,name);
  await locker.query('select pg_sleep(0.7);commit;');assert.equal(await expired,'LEASE_LOST','lease expiry after a message lock cannot authorize creation');
  assert.equal(await admin.query(`select creation_started_at is null from fmat.conversation_successors where conversation_id=${q(rows[2].scope)};`),'t');
  assert.equal(await admin.query(`select jsonb_agg(to_jsonb(m) order by m.id) from fmat.runtime_messages m where conversation_id in(select id from fmat.conversation_scopes where host_id=${q(host)});`),before,'no input identity, fingerprint, content or receipt is rewritten');
  assert.equal(await admin.query(`select sum(attempts) from fmat.model_work_attempts where name in(${rows.map(row=>q('conversation:'+row.message)).join(',')});`),'9','failed-attempt accounting is preserved');
 }finally{
  await locker.query('rollback;').catch(()=>{});
  const cleanup=new LocalSql();
  try{await cleanup.query(`delete from fmat.conversation_recoveries where conversation_id in(select id from fmat.conversation_scopes where host_id=${q(host)});delete from fmat.conversation_generations where conversation_id in(select id from fmat.conversation_scopes where host_id=${q(host)});delete from fmat.model_work_attempts where name in(${rows.map(row=>q('conversation:'+row.message)).join(',')});delete from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where host_id=${q(host)});delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where host_id=${q(host)});delete from fmat.audit_events where subject_id in(${rows.map(row=>q(row.scope)).join(',')});delete from fmat.conversation_scopes where host_id=${q(host)};delete from fmat.requests where host_id=${q(host)};delete from fmat.hosts where id=${q(host)};delete from fmat.invitations where id=${q(invitation)};delete from auth.sessions where user_id=${q(host)};delete from auth.users where id=${q(host)};`);}
  finally{for(const sql of [admin,locker,waiter,cleanup,...peers])sql.close();}
 }
});
