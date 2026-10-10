import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {formatPrivateSetupReview} from '../../lib/server/photon/setup-review.ts';
import {LocalSql,cleanupFixtureJobsSql} from './local-sql.ts';
const q=(s:string)=>"'"+s.replaceAll("'","''")+"'";

test('Private setup review retries converge and authority is rechecked after actual host-lock waits',async()=>{
 const sql=new LocalSql(),locker=new LocalSql();
 const prefixes=['a8500000','a8510000','a8520000'].map(old=>[old,randomUUID().slice(0,8)] as const);
 const issuer='private-setup-'+randomUUID();
 let seed=readFileSync('supabase/tests/photon_setup_reviews.test.sql','utf8');
 const boundary=seed.indexOf('-- Concurrency fixture boundary.');assert.ok(boundary>0);seed=seed.slice(0,boundary);
 for(const [old,value] of prefixes)seed=seed.replaceAll(old,value);
 seed=seed.replaceAll('setup-review-fixture',issuer).replaceAll("'setup-review-'||n","'setup-review-"+prefixes[0][1]+"-'||n");
 const hosts=[1,2].map(n=>prefixes[0][1]+'-0000-4000-8000-'+String(n).padStart(12,'0'));
 const project=prefixes[1][1]+'-0000-4000-8000-000000000001';
 let seeded=false;
 try{
  // Same fixture state as rollback-only SQL coverage, committed here solely
  // so separate local PostgreSQL connections can contend on real row locks.
  await sql.query(seed+'\ncommit;');seeded=true;
  const source=await sql.query('select pg_temp.source();'),reviewId=await sql.query('select pg_temp.review();'),decision=await sql.query('select pg_temp.decision();');
  const before=await sql.query(`select jsonb_agg(jsonb_build_object('id',id,'rules',rules,'version',rules_version) order by id) from fmat.hosts where id in(${hosts.map(q).join(',')});`);
  async function race(statement:string){
   const peers=Array.from({length:8},()=>new LocalSql());
   try{return await Promise.all(peers.map(peer=>peer.query(statement)));}finally{peers.forEach(peer=>peer.close());}
  }
  const starts=await race(`select fmat.photon_setup_review_start(${q(source)});`);
  assert.ok(starts.every(value=>value===starts[0]),'All contenders retain one reference and deadline');
  const {reviewId:id,expiresAt,settings}=JSON.parse(starts[0]);assert.equal(id,reviewId);
  const formatted=formatPrivateSetupReview({reviewId:id,expiresAt,settings});assert.equal(formatted.kind,'review');
  const publications=await race(`select fmat.photon_setup_review_publish(${q(source)},${q(id)},${q(formatted.text)});`);
  assert.ok(publications.every(value=>value===formatted.text));
  assert.equal(await sql.query(`select count(*) from fmat.photon_replies where inbox_id=${q(source)};`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.photon_setup_review_publications where review_id=${q(id)};`),'1');
  await sql.query(`update fmat.photon_replies set status='accepted',provider_reference='synthetic-reviewed-reference' where inbox_id=${q(source)};`);
  const check=`select fmat.photon_setup_review_check(${q(decision)},${q(id)});`;
  assert.equal(JSON.parse(await sql.query(check)).reviewId,id);
  async function blockedCheck(mutation:string,error:RegExp){
   const waiter=new LocalSql(),label='private-setup-lock-'+randomUUID();let pending:Promise<unknown>|undefined;
   try{
    await locker.query(`begin;select id from fmat.hosts where id=${q(hosts[0])} for update;`);
    await waiter.query(`set application_name=${q(label)};`);
    pending=assert.rejects(waiter.query(check),error);
    let waiting=false;
    for(let n=0;n<100;n++){
     if(await sql.query(`select exists(select 1 from pg_stat_activity where application_name=${q(label)} and wait_event_type='Lock');`)==='t'){waiting=true;break;}
     await delay(10);
    }
    assert.equal(waiting,true,'Confirmation actually waits for the host lock');
    await locker.query(mutation+'commit;');await pending;
   }finally{await locker.query('rollback;').catch(()=>{});await pending?.catch(()=>{});waiter.close();}
  }
  await blockedCheck(`update fmat.hosts set rules_version=rules_version+1 where id=${q(hosts[0])};`,/REVISION_CONFLICT/u);
  await sql.query(`update fmat.hosts set rules_version=rules_version-1 where id=${q(hosts[0])};`);
  assert.equal(JSON.parse(await sql.query(check)).reviewId,id);
  await blockedCheck(`update fmat.photon_links set revoked_at=clock_timestamp() where host_id=${q(hosts[0])};`,/UNAUTHORIZED/u);
  assert.equal(await sql.query(`select jsonb_agg(jsonb_build_object('id',id,'rules',rules,'version',rules_version) order by id) from fmat.hosts where id in(${hosts.map(q).join(',')});`),before,'Review checks do not save settings');
 }finally{
  await locker.query('rollback;').catch(()=>{});locker.close();
  if(seeded){
   const ids=hosts.map(q).join(','),inboxes=`select id from fmat.photon_inbox where project_id=${q(project)}`;
   await sql.query(`delete from fmat.photon_setup_review_publications where review_id in(select id from fmat.photon_setup_reviews where host_id in(${ids}));delete from fmat.photon_setup_reviews where host_id in(${ids});delete from fmat.photon_replies where inbox_id in(${inboxes});${cleanupFixtureJobsSql(`kind='photon_ingress' and payload->>'inboxId' in(select id::text from fmat.photon_inbox where project_id=${q(project)})`)}delete from fmat.photon_inbox where project_id=${q(project)};delete from fmat.photon_links where project_id=${q(project)};delete from fmat.photon_link_challenges where project_id=${q(project)};delete from fmat.photon_receivers where project_id=${q(project)};delete from fmat.calendar_connections where principal_id in(${ids});delete from fmat.idempotency where actor_scope in(${hosts.map(id=>q('host:'+id)).join(',')});delete from fmat.audit_events where actor->>'id' in(${ids});delete from fmat.hosts where id in(${ids});delete from auth.users where id in(${ids});delete from fmat.invitations where issued_by=${q(issuer)};`);
   assert.equal(await sql.query(`select (select count(*) from fmat.photon_setup_reviews where host_id in(${ids}))+(select count(*) from fmat.photon_inbox where project_id=${q(project)})+(select count(*) from fmat.hosts where id in(${ids}));`),'0');
  }
  sql.close();
 }
});
