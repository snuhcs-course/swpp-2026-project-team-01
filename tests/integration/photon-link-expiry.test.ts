import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalSql} from './local-sql.ts';

// Three independent local Docker connections prove the operation is blocked
// before its deadline passes. No provider, remote database or real message.
for(const scenario of [
 {operation:'verify',lock:'phone',expires:'code',expected:'CHALLENGE_INVALID'},
 {operation:'start',lock:'phone',expires:'session',expected:'UNAUTHORIZED'},
 {operation:'verify',lock:'receiver',expires:'session',expected:'UNAUTHORIZED'},
 {operation:'verify',lock:'phone',expires:'credential',expected:'UNAUTHORIZED'},
 {operation:'authorize',lock:'challenge',expires:'session',expected:'UNAUTHORIZED'},
] as const)test(`Photon ${scenario.operation} rejects ${scenario.expires} expiry during ${scenario.lock} wait`,{timeout:15_000},async()=>{
 const sql=new LocalSql(),holder=new LocalSql(),worker=new LocalSql();
 const host=randomUUID(),session=randomUUID(),invitation=randomUUID(),project=randomUUID(),challenge=randomUUID(),lease=randomUUID();
 const phone='+15550123456',email=host+'@example.test';
 const credential={kind:'host',subject:host,sessionId:session,expiresAt:new Date(Date.now()+3600_000).toISOString()};
 const input={phone,spaceId:'any;-;'+phone,line:'shared',browserHash:'b'.repeat(64),codeHash:'c'.repeat(64),encryptedCode:'e'.repeat(40),challengeId:challenge,idempotencyKey:randomUUID(),leaseToken:lease};
 const json=(value:unknown)=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
 let pending:Promise<string>|undefined;
 try{
  await sql.query(`insert into auth.users(id,email,email_confirmed_at) values('${host}','${email}',now());
   insert into auth.sessions(id,user_id) values('${session}','${host}');
   insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','${email}',repeat('a',64),now()+interval '1 day','expiry-test');
   insert into fmat.hosts(id,email,invitation_id) values('${host}','${email}','${invitation}');
   insert into fmat.photon_receivers(project_id,receiver_id,enabled) values('${project}','${randomUUID()}',true);`);
  if(scenario.operation!=='start')await sql.query(`select public.fmat_photon_link('start',${json(credential)},'${project}',${json(input)});
   update fmat.photon_link_challenges set delivery_status='accepted',lease_token='${lease}',lease_until=now()+interval '2 minutes' where id='${challenge}';`);
  await worker.query(`create temporary table deadline(value timestamptz);create function pg_temp.attempt() returns text language plpgsql as $$begin
   perform ${scenario.operation==='authorize'?`public.fmat_photon_link_delivery('authorize','${project}',${json(input)})`:
    `public.fmat_photon_link('${scenario.operation}',${scenario.expires==='credential'?`jsonb_set(${json(credential)},'{expiresAt}',to_jsonb((select value from deadline)))` :json(credential)},'${project}',${json(input)})`};
   return 'unexpected success';exception when raise_exception then return sqlerrm;end;$$;`);
  const pid=Number(await holder.query('begin;select pg_backend_pid();'));
  await holder.query(scenario.lock==='phone'?`select pg_advisory_xact_lock(hashtextextended('photon-link:${project}:${phone}',0));`:
   scenario.lock==='receiver'?`select project_id from fmat.photon_receivers where project_id='${project}' for update;`:
   `select id from fmat.photon_link_challenges where id='${challenge}' for update;`);
  // Store the deadline before the operation acquires its Auth row locks.
  const deadline=await sql.query(`select (clock_timestamp()+interval '2 seconds')::text;`);
  if(scenario.expires==='code')await sql.query(`update fmat.photon_link_challenges set created_at='${deadline}'::timestamptz-interval '10 minutes',expires_at='${deadline}' where id='${challenge}';`);
  else if(scenario.expires==='credential')await worker.query(`insert into deadline values('${deadline}');`);
  else await sql.query(`update auth.sessions set not_after='${deadline}' where id='${session}';`);
  pending=worker.query('select pg_temp.attempt();');
  let blocked=false;
  for(let n=0;n<100;n++){
   blocked=await sql.query(`select exists(select 1 from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid)));`)==='t';
   if(blocked)break;await delay(10);
  }
  assert.equal(blocked,true,'must observe a real database lock wait');
  assert.equal(await sql.query(`select clock_timestamp()<'${deadline}'::timestamptz;`),'t','operation blocked before expiry');
  while(await sql.query(`select clock_timestamp()<'${deadline}'::timestamptz;`)==='t')await delay(25);
  await holder.query('commit;');
  assert.equal(await pending,scenario.expected);
  assert.equal(await sql.query(`select count(*) from fmat.photon_links where project_id='${project}';`),'0');
  assert.equal(await sql.query(`select count(*) from fmat.photon_link_attempts where challenge_id='${challenge}';`),'0');
  assert.equal(await sql.query(`select count(*) from fmat.photon_link_challenges where project_id='${project}' and consumed_at is not null;`),'0');
  if(scenario.operation==='start')assert.equal(await sql.query(`select count(*) from fmat.photon_link_challenges where project_id='${project}';`),'0');
 }finally{
  await holder.query('rollback;');await pending?.catch(()=>{});
  await sql.query(`delete from fmat.audit_events where actor->>'id'='${host}';delete from fmat.photon_links where project_id='${project}';
   delete from fmat.photon_link_challenges where project_id='${project}';delete from fmat.photon_receivers where project_id='${project}';
   delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invitation}';delete from auth.users where id='${host}';`);
  sql.close();holder.close();worker.close();
 }
});
