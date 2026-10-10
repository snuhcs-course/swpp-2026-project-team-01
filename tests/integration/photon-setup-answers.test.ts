import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {PrivateSetupAnswers} from '../../lib/server/photon/setup-answers.ts';
import {Database} from '../../lib/server/database/client.ts';
import {execFileSync} from 'node:child_process';
import {setupState} from '../../lib/contracts/setup.ts';
import {draftAnswers} from '../../lib/contracts/setup-answers.ts';
import {LocalSql,cleanupFixtureJobsSql} from './local-sql.ts';
const q=(s:string)=>"'"+s.replaceAll("'","''")+"'";

test('Private answer acceptance preserves provenance, replays once and rechecks authority after real lock waits',async()=>{
 const sql=new LocalSql(),locker=new LocalSql();
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const env={...process.env,SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY};const service=new PrivateSetupAnswers(new Database(env));
 const prefixes=['a8500000','a8510000','a8520000'].map(old=>[old,randomUUID().slice(0,8)] as const);
 const issuer='private-setup-'+randomUUID();
 let seed=readFileSync('supabase/tests/photon_setup_answers.test.sql','utf8');
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
  const starts=await race(`select fmat.photon_setup_answer_review_start(${q(source)});`);
  assert.ok(starts.every(value=>value===starts[0]),'All contenders retain one reference and deadline');
  const {reviewId:id,state}=JSON.parse(starts[0]);assert.equal(id,reviewId);
  const eligible=JSON.parse(await sql.query(`select fmat.setup_answer_patches(${q(JSON.stringify(state))}::jsonb);`));
  assert.deepEqual(eligible,Object.fromEntries(draftAnswers(setupState.parse(state)).map(answer=>[answer.key,answer.patch.rules])),'SQL and browser derive the same exact eligible patches');
  const variants=[
   (value:ReturnType<typeof setupState.parse>)=>{value.draft!.settings.rules!.meetingMode='online';},
   (value:ReturnType<typeof setupState.parse>)=>{value.draft!.provenance['rules.meetingMode']='host';},
   (value:ReturnType<typeof setupState.parse>)=>{value.progress.dismissedSuggestions=['mode'];},
   (value:ReturnType<typeof setupState.parse>)=>{value.draft!.provenance['rules.travelMode']='host';},
   (value:ReturnType<typeof setupState.parse>)=>{value.draft!.settings.rules!.locationPolicy='per_meeting';value.draft!.settings.rules!.locations=[];},
   (value:ReturnType<typeof setupState.parse>)=>{delete value.draft!.settings.rules!.travelBufferMinutes;},
   (value:ReturnType<typeof setupState.parse>)=>{value.nextAction='refresh_draft';},
  ];
  for(const mutate of variants){const value=setupState.parse(structuredClone(state));mutate(value);assert.deepEqual(JSON.parse(await sql.query(`select fmat.setup_answer_patches(${q(JSON.stringify(value))}::jsonb);`)),Object.fromEntries(draftAnswers(value).map(answer=>[answer.key,answer.patch.rules])),'SQL/browser eligibility agrees across online, explicit, dismissed, missing and stale choices');}
  const publications=await Promise.all(Array.from({length:8},()=>service.review(source)));
  assert.ok(publications.every(value=>value.kind==='review'&&value.text===publications[0].text));
  assert.ok(publications[0].text.includes('mode: "Either online or in person"'));
  assert.equal(await sql.query(`select count(*) from fmat.photon_replies where inbox_id=${q(source)};`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.photon_setup_answer_review_publications where review_id=${q(id)};`),'1');
  await assert.rejects(service.accept(decision,id),{code:'RECONCILIATION_PENDING'});
  await sql.query(`update fmat.photon_replies set status='accepted',provider_reference='synthetic-reviewed-reference' where inbox_id=${q(source)};`);
  const check=`select public.fmat_photon_setup_answers('accept',${q(decision)},jsonb_build_object('reviewId',${q(id)}));`;
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
    assert.equal(waiting,true,'Acceptance actually waits for the host lock');
    await locker.query(mutation+'commit;');await pending;
   }finally{await locker.query('rollback;').catch(()=>{});await pending?.catch(()=>{});waiter.close();}
  }
  await blockedCheck(`update fmat.hosts set rules_version=rules_version+1 where id=${q(hosts[0])};`,/REVISION_CONFLICT/u);
  await sql.query(`update fmat.hosts set rules_version=rules_version-1 where id=${q(hosts[0])};`);
  const received=await sql.query(`select received_at from fmat.photon_inbox where id=${q(decision)};`);
  await blockedCheck(`update fmat.photon_inbox set received_at=clock_timestamp()-interval '61 minutes' where id=${q(decision)};`,/UNAUTHORIZED/u);
  await sql.query(`update fmat.photon_inbox set received_at=${q(received)} where id=${q(decision)};`);
  const beforeAcceptance=JSON.parse(await sql.query(`select fmat.host_setup_view(${q(hosts[0])});`));
  let lost=false;
  const lossy=new PrivateSetupAnswers(new Database(env,async(url,options)=>{const response=await fetch(url,options);const body=typeof options?.body==='string'?JSON.parse(options.body):{};if(!lost&&String(url).endsWith('/fmat_photon_setup_answers')&&body.p_operation==='accept'&&response.ok){lost=true;await response.arrayBuffer();throw new Error('Synthetic committed acceptance response loss');}return response;}));
  const competing=await Promise.allSettled([lossy.accept(decision,id),...Array.from({length:7},()=>service.accept(decision,id))]);
  assert.equal(lost,true);assert.equal(competing.filter(result=>result.status==='rejected').length,1);assert.equal(competing.filter(result=>result.status==='fulfilled').length,7);
  const afterAcceptance=JSON.parse(await sql.query(`select fmat.host_setup_view(${q(hosts[0])});`));
  assert.equal(afterAcceptance.revision,beforeAcceptance.revision+1);
  assert.deepEqual(afterAcceptance.confirmed,beforeAcceptance.confirmed);
  assert.deepEqual(afterAcceptance.draft.origins,beforeAcceptance.draft.origins);
  const receipts=await Promise.all(Array.from({length:8},()=>service.accept(decision,id)));
  assert.ok(receipts.every(result=>JSON.stringify(result)===JSON.stringify(receipts[0])));
  assert.equal(await sql.query(`select count(*) from fmat.photon_setup_answer_acceptances where review_id=${q(id)};`),'1');
  await sql.query(`select fmat.host_setup_operation('draft',pg_temp.actor(1),jsonb_build_object('expectedRevision',fmat.host_setup_view(${q(hosts[0])})->'revision','patch','{"rules":{"bufferMinutes":25}}'::jsonb,'unresolved','[]'::jsonb,'idempotencyKey',gen_random_uuid()),'host');`);
  const later=await sql.query(`select fmat.host_setup_view(${q(hosts[0])});`);
  assert.deepEqual(await service.accept(decision,id),receipts[0]);assert.equal(await sql.query(`select fmat.host_setup_view(${q(hosts[0])});`),later);

  await blockedCheck(`update fmat.photon_links set revoked_at=clock_timestamp() where host_id=${q(hosts[0])};`,/UNAUTHORIZED/u);
  assert.equal(await sql.query(`select jsonb_agg(jsonb_build_object('id',id,'rules',rules,'version',rules_version) order by id) from fmat.hosts where id in(${hosts.map(q).join(',')});`),before,'Review checks do not save settings');
 }finally{
  await locker.query('rollback;').catch(()=>{});locker.close();
  if(seeded){
   const ids=hosts.map(q).join(','),inboxes=`select id from fmat.photon_inbox where project_id=${q(project)}`;
   await sql.query(`delete from fmat.photon_setup_answer_acceptances where review_id in(select id from fmat.photon_setup_answer_reviews where host_id in(${ids}));delete from fmat.photon_setup_answer_review_publications where review_id in(select id from fmat.photon_setup_answer_reviews where host_id in(${ids}));delete from fmat.photon_setup_answer_reviews where host_id in(${ids});delete from fmat.photon_replies where inbox_id in(${inboxes});${cleanupFixtureJobsSql(`kind='photon_ingress' and payload->>'inboxId' in(select id::text from fmat.photon_inbox where project_id=${q(project)})`)}delete from fmat.photon_inbox where project_id=${q(project)};delete from fmat.photon_links where project_id=${q(project)};delete from fmat.photon_link_challenges where project_id=${q(project)};delete from fmat.photon_receivers where project_id=${q(project)};delete from fmat.calendar_connections where principal_id in(${ids});delete from fmat.idempotency where actor_scope in(${hosts.map(id=>q('host:'+id)).join(',')});delete from fmat.audit_events where actor->>'id' in(${ids});delete from fmat.hosts where id in(${ids});delete from auth.users where id in(${ids});delete from fmat.invitations where issued_by=${q(issuer)};`);
   assert.equal(await sql.query(`select (select count(*) from fmat.photon_setup_answer_reviews where host_id in(${ids}))+(select count(*) from fmat.photon_inbox where project_id=${q(project)})+(select count(*) from fmat.hosts where id in(${ids}));`),'0');
  }
  sql.close();
 }
});
