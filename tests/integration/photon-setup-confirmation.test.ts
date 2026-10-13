import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {Database} from '../../lib/server/database/client.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {TokenCipher} from '../../lib/server/calendar/encryption.ts';
import {calendarScopes,type TokenBundle} from '../../lib/server/calendar/google.ts';
import type {CalendarProvider,CalendarEntry} from '../../lib/server/calendar/catalog.ts';
import {PrivateSetupConfirmation} from '../../lib/server/photon/setup-confirmation.ts';
import {LocalSql,cleanupFixtureJobsSql} from './local-sql.ts';
const q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
const errorCode=(code:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===code;

test('Private setup service validates current Google access, atomically saves, and recovers lost results without another provider read',{timeout:30_000},async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const env={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
 const sql=new LocalSql(),cipher=new TokenCipher(env),prefixes=['a8500000','a8510000','a8520000'].map(old=>[old,randomUUID().slice(0,8)] as const);
 const issuer='setup-confirm-'+randomUUID();
 let seed=readFileSync('supabase/tests/photon_setup_reviews.test.sql','utf8').split('-- Concurrency fixture boundary.')[0];
 for(const [old,value] of prefixes)seed=seed.replaceAll(old,value);
 seed=seed.replaceAll('setup-review-fixture',issuer).replaceAll("'setup-review-'||n","'setup-review-"+prefixes[0][1]+"-'||n");
 const hosts=[1,2].map(n=>prefixes[0][1]+'-0000-4000-8000-'+String(n).padStart(12,'0'));
 const project=prefixes[1][1]+'-0000-4000-8000-000000000001';
 const receiver=prefixes[2][1]+'-0000-4000-8000-000000000001';
 const calendars:CalendarEntry[]=[{id:'conflict',name:'Conflict',accessRole:'reader',primary:false,timeZone:'UTC',color:null},{id:'destination',name:'Destination',accessRole:'owner',primary:false,timeZone:'UTC',color:null}];
 let lists=0,refreshes=0,afterList:()=>Promise<void>=async()=>{},metadata=calendars;
 const provider:CalendarProvider={refresh:async bundle=>{refreshes++;return {...bundle,accessToken:'refreshed-test-token',expiresAt:Date.now()+3600000};},list:async()=>{lists++;await afterList();return metadata;}};
 const database=new Database(env),service=new PrivateSetupConfirmation(database,env,provider);
 const bundle=(n:number):TokenBundle=>({accessToken:'synthetic-token',refreshToken:'synthetic-refresh',subject:'google-setup-'+n,expiresAt:Date.now()+3600000,scopes:[...calendarScopes.host]});
 async function storeBundle(n:number,value:TokenBundle){
  const sealed=cipher.seal(value,'google:host:'+hosts[n-1]);
  await sql.query(`update fmat.calendar_connections set encrypted_credential=${q(sealed)} where principal_id=${q(hosts[n-1])};`);return sealed;
 }
 let seeded=false;
 try{
  await sql.query(seed+'\ncommit;');seeded=true;
  await storeBundle(1,bundle(1));await storeBundle(2,bundle(2));
  const source=await sql.query('select pg_temp.source();'),id=await sql.query('select pg_temp.review();'),decision=await sql.query('select pg_temp.decision();');
  const review=await service.review(source);assert.equal(review.kind,'review');assert.ok(review.text.includes('confirm setup '+id));
  assert.deepEqual(await service.review(source),review,'Publication retry preserves exact formatted text');
  await assert.rejects(service.confirm(decision,id),errorCode('RECONCILIATION_PENDING'));assert.equal(lists,0);
  await sql.query(`update fmat.photon_replies set status='accepted',provider_reference='synthetic-exact-summary' where inbox_id=${q(source)};`);
  await storeBundle(1,{...bundle(1),subject:'another-provider-subject'});
  await assert.rejects(service.confirm(decision,id),errorCode('RECONNECT_REQUIRED'));assert.equal(lists,0);
  await storeBundle(1,{...bundle(1),scopes:['openid']});
  await assert.rejects(service.confirm(decision,id),errorCode('RECONNECT_REQUIRED'));assert.equal(lists,0);
  await storeBundle(1,bundle(1));
  metadata=calendars.map(c=>({...c,accessRole:'reader'}));await assert.rejects(service.confirm(decision,id),errorCode('CALENDAR_ACCESS_INVALID'));
  metadata=calendars.filter(c=>c.id!=='conflict');await assert.rejects(service.confirm(decision,id),errorCode('CALENDAR_ACCESS_INVALID'));metadata=calendars;
  // Mutation during the external metadata read is visible to the committing
  // SQL transaction, even when the returned provider list looks valid.
  afterList=async()=>{await sql.query(`update fmat.hosts set rules_version=rules_version+1 where id=${q(hosts[0])};`);};
  await assert.rejects(service.confirm(decision,id),errorCode('STALE_REVISION'));
  await sql.query(`update fmat.hosts set rules_version=rules_version-1 where id=${q(hosts[0])};`);
  const generation=await sql.query(`select generation from fmat.calendar_connections where principal_id=${q(hosts[0])};`);
  afterList=async()=>{await sql.query(`update fmat.calendar_connections set generation=gen_random_uuid() where principal_id=${q(hosts[0])};`);};
  await assert.rejects(service.confirm(decision,id),errorCode('STALE_REVISION'));
  await sql.query(`update fmat.calendar_connections set generation=${q(generation)} where principal_id=${q(hosts[0])};`);
  afterList=async()=>{await sql.query(`update fmat.photon_links set revoked_at=clock_timestamp() where host_id=${q(hosts[0])};`);};
  await assert.rejects(service.confirm(decision,id),errorCode('UNAUTHORIZED'));
  await sql.query(`update fmat.photon_links set revoked_at=null where host_id=${q(hosts[0])};`);
  afterList=async()=>{await sql.query(`update fmat.photon_receivers set receiver_id=gen_random_uuid() where project_id=${q(project)};`);};
  await assert.rejects(service.confirm(decision,id),errorCode('UNAUTHORIZED'));
  await sql.query(`update fmat.photon_receivers set receiver_id=${q(receiver)} where project_id=${q(project)};`);afterList=async()=>{};
  assert.equal(await sql.query(`select rules_version from fmat.hosts where id=${q(hosts[0])};`),'0');
  assert.equal(await sql.query(`select count(*) from fmat.photon_setup_confirmations where review_id=${q(id)};`),'0');
  const expired={...bundle(1),expiresAt:Date.now()-1000};await storeBundle(1,expired);
  const wrongRefresh:CalendarProvider={...provider,refresh:async value=>({...value,subject:'swapped',expiresAt:Date.now()+3600000})};
  await assert.rejects(new PrivateSetupConfirmation(database,env,wrongRefresh).confirm(decision,id),errorCode('RECONNECT_REQUIRED'));
  const racingRefresh:CalendarProvider={...provider,refresh:async value=>{await storeBundle(1,bundle(1));return {...value,expiresAt:Date.now()+3600000};}};
  await assert.rejects(new PrivateSetupConfirmation(database,env,racingRefresh).confirm(decision,id),errorCode('STALE_REVISION'));
  await storeBundle(1,expired);
  let dropped=false;
  const lost=new Database(env,async(url,options)=>{
   const response=await fetch(url,options);
   if(!dropped&&String(url).endsWith('/fmat_photon_setup')&&JSON.parse(String(options?.body)).p_operation==='finish_confirmation'&&response.ok){dropped=true;await response.arrayBuffer();throw new Error('Synthetic lost committed response');}
   return response;
  });
  await assert.rejects(new PrivateSetupConfirmation(lost,env,provider).confirm(decision,id),errorCode('PROVIDER_UNAVAILABLE'));assert.equal(dropped,true);assert.equal(refreshes,1);
  const count=lists;
  // A new browser draft and unusable ciphertext must not force another
  // permission read or overwrite the original saved policy during replay.
  await sql.query(`select pg_temp.draft(1,'{"rules":{"bufferMinutes":35}}');update fmat.calendar_connections set encrypted_credential='removed-after-save' where principal_id=${q(hosts[0])};`);
  const saved=await service.confirm(decision,id),replays=await Promise.all(Array.from({length:8},()=>service.confirm(decision,id)));
  assert.ok(replays.every(value=>JSON.stringify(value)===JSON.stringify(saved)));assert.equal(lists,count);
  assert.equal(saved.confirmed,true);assert.equal(saved.rulesVersion,1);
  assert.equal(await sql.query(`select rules->>'bufferMinutes' from fmat.hosts where id=${q(hosts[0])};`),'10');
  assert.equal(await sql.query(`select fmat.host_setup_view(${q(hosts[0])})->'draft'->'settings'->'rules'->>'bufferMinutes';`),'35');
  const staleSource=await sql.query("select pg_temp.receive(2,'review setup');");
  assert.equal((await service.review(staleSource)).kind,'review');
  const staleId=await sql.query(`select id from fmat.photon_setup_reviews where inbox_id=${q(staleSource)};`);
  const staleDecision=await sql.query(`select pg_temp.receive(2,${q('confirm setup '+staleId)});`);
  await sql.query(`update fmat.photon_replies set status='accepted',provider_reference='synthetic-stale-summary' where inbox_id=${q(staleSource)};`);
  afterList=async()=>{await sql.query(`select pg_temp.draft(2,'{"rules":{"bufferMinutes":25}}');`);};
  await assert.rejects(service.confirm(staleDecision,staleId),errorCode('STALE_REVISION'));
  assert.equal(await sql.query(`select rules_version from fmat.hosts where id=${q(hosts[1])};`),'0');
  const source2=await sql.query("select pg_temp.receive(2,'review setup');");
  assert.equal((await service.review(source2)).kind,'review');
  const id2=await sql.query(`select id from fmat.photon_setup_reviews where inbox_id=${q(source2)};`);
  const decision2=await sql.query(`select pg_temp.receive(2,${q('confirm setup '+id2)});`);
  await sql.query(`update fmat.photon_replies set status='accepted',provider_reference='synthetic-second-summary' where inbox_id=${q(source2)};`);
  // Hold every external read until all eight attempts have begun, so this
  // proves contending commits rather than scheduler-dependent cached replay.
  let release!:()=>void,arrived=0;const barrier=new Promise<void>(resolve=>{release=resolve;});
  afterList=async()=>{if(++arrived===8)release();await barrier;};
  const concurrent=await Promise.all(Array.from({length:8},()=>service.confirm(decision2,id2)));
  assert.ok(concurrent.every(value=>JSON.stringify(value)===JSON.stringify(concurrent[0])),'Concurrent commits converge on one original receipt');
  assert.equal(await sql.query(`select rules_version from fmat.hosts where id=${q(hosts[1])};`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.photon_setup_confirmations where review_id in(${q(id)},${q(id2)});`),'2');
  assert.equal(await sql.query(`select count(*) from fmat.host_approvals where host_id in(${hosts.map(q).join(',')});`),'0');
  assert.equal(await sql.query(`select count(*) from fmat.booking_attempts where request_id in(select id from fmat.requests where host_id in(${hosts.map(q).join(',')}));`),'0');
  await sql.query(`update fmat.photon_links set revoked_at=clock_timestamp() where host_id=${q(hosts[0])};`);
  await assert.rejects(service.confirm(decision,id),errorCode('UNAUTHORIZED'));assert.equal(lists,count+9);
 }finally{
  if(seeded){
   const ids=hosts.map(q).join(','),reviews=`select id from fmat.photon_setup_reviews where host_id in(${ids})`,inboxes=`select id from fmat.photon_inbox where project_id=${q(project)}`;
   await sql.query(`delete from fmat.photon_setup_confirmations where review_id in(${reviews});delete from fmat.photon_setup_permission_checks where review_id in(${reviews});delete from fmat.photon_setup_review_publications where review_id in(${reviews});delete from fmat.photon_setup_reviews where host_id in(${ids});delete from fmat.photon_replies where inbox_id in(${inboxes});${cleanupFixtureJobsSql(`kind='photon_ingress' and payload->>'inboxId' in(select id::text from fmat.photon_inbox where project_id=${q(project)})`)}delete from fmat.photon_inbox where project_id=${q(project)};delete from fmat.photon_links where project_id=${q(project)};delete from fmat.photon_link_challenges where project_id=${q(project)};delete from fmat.photon_receivers where project_id=${q(project)};delete from fmat.calendar_connections where principal_id in(${ids});delete from fmat.idempotency where actor_scope in(${hosts.map(id=>q('host:'+id)).join(',')});delete from fmat.audit_events where actor->>'id' in(${ids});delete from fmat.hosts where id in(${ids});delete from auth.users where id in(${ids});delete from fmat.invitations where issued_by=${q(issuer)};`);
   assert.equal(await sql.query(`select count(*) from fmat.hosts where id in(${ids});`),'0');
  }
  sql.close();
 }
});
