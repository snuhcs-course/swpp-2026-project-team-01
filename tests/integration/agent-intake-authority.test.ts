import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
import {LocalSql} from './local-sql.ts';
const q=(value:string)=>`'${value.replaceAll("'","''")}'`;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const parse=(value:string)=>JSON.parse(value) as Record<string,string>;
const resource='https://release.findmeatime.com/mcp',redirect='https://client.example/cb',browser='a'.repeat(64);
type Fixture={authorization:string;intake:string;grant:string;request:string;code:string};

test('intake consent, binding, deadlines, readiness and revocation serialize through current authority',async()=>{
 const db=new LocalSql(),lock=new LocalSql(),wait=new LocalSql(),peers=Array.from({length:8},()=>new LocalSql());
 const host=randomUUID(),invitation=randomUUID(),client=randomUUID(),handle=`intake-${host.slice(0,8)}`,waitName=`intake-authority-${randomUUID()}`;
 let savedRegistry:string|undefined,savedIntake:string|undefined;
 const start=()=>`select public.fmat_oauth_authorization_start(${q(JSON.stringify({clientId:client,resource,redirectUri:redirect,scope:'request:intake request:read request:write',handle,codeChallenge:createHash('sha256').update('A'.repeat(43)).digest('base64url'),codeChallengeMethod:'S256',state:'opaque',browserHash:browser}))}::jsonb);`;
 const consent=(f:Fixture)=>`select public.fmat_oauth_intake_consent(${q(f.authorization)},${q(browser)},'grant',${q(f.code)});`;
 const check=(f:Fixture)=>`select public.fmat_oauth_grant_check(${q(f.grant)},${q(client)},${q(resource)},'intake',${q(f.intake)},'request:intake request:read request:write');`;
 async function fixture(issue=true):Promise<Fixture>{
  const authorization=parse(await db.query(start())).authorizationId;assert.ok(authorization);
  const state=parse(await db.query(`select jsonb_build_object('intake',id,'request',reserved_request_id) from fmat.oauth_intakes where authorization_id=${q(authorization)};`));
  const f={authorization,intake:state.intake,request:state.request,grant:'',code:hash(randomUUID())};
  if(issue){assert.equal(parse(await db.query(consent(f))).decision,'grant');f.grant=await db.query(`select grant_id from fmat.oauth_intakes where id=${q(f.intake)};`);}
  return f;
 }
 async function blocked(pending:Promise<string>){
  let settled=false;void pending.finally(()=>{settled=true;}).catch(()=>{});
  for(let n=0;n<60;n++){
   if(settled){await pending;throw Error('Expected intake authority to wait on a database lock');}
   if(await db.query(`select exists(select 1 from pg_stat_activity where application_name=${q(waitName)} and wait_event_type='Lock');`)==='t')return;
   await setTimeout(50);
  }
  throw Error('No intake authority lock wait observed');
 }
 async function race(lockedSql:string,waitingSql:string,releaseSql='commit;'){
  await lock.query('begin;'+lockedSql);
  const pending=wait.query(waitingSql);void pending.catch(()=>{});
  try{await blocked(pending);await lock.query(releaseSql);return parse(await pending);}
  finally{await lock.query('rollback;').catch(()=>{});await pending.catch(()=>{});}
 }
 try{
  savedRegistry=await db.query("select coalesce(jsonb_agg(to_jsonb(b)),'[]') from fmat.oauth_budgets b;");
  savedIntake=await db.query("select coalesce(jsonb_agg(to_jsonb(b)),'[]') from fmat.oauth_intake_budgets b;");
  await db.query('delete from fmat.oauth_budgets;delete from fmat.oauth_intake_budgets;');
  await db.query(`insert into auth.users(id,email,email_confirmed_at) values(${q(host)},'intake-authority@example.test',now());insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values(${q(invitation)},'intake-authority@example.test',${q(hash(invitation))},now()+interval '1 day','intake-authority');insert into fmat.hosts(id,email,invitation_id,handle,display_name,rules,conflict_calendar_ids,booking_calendar_id) values(${q(host)},'intake-authority@example.test',${q(invitation)},${q(handle)},'Public host','{"timezone":"Asia/Seoul","durationMinutes":30}',array['calendar'],'calendar');insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential) values('host',${q(host)},'synthetic-subject',array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],'encrypted-synthetic-fixture');insert into fmat.oauth_clients(id,name,redirect_uris,resource) values(${q(client)},'Intake authority fixture',array[${q(redirect)}],${q(resource)});`);
  await wait.query(`set application_name=${q(waitName)};`);
  const first=await fixture(false);
  const decisions=await Promise.all(peers.map(p=>p.query(consent(first)).then(parse)));
  assert.ok(decisions.every(value=>value.decision==='grant'));
  first.grant=await db.query(`select grant_id from fmat.oauth_intakes where id=${q(first.intake)};`);
  assert.equal(await db.query(`select count(*) from fmat.oauth_grants where authorization_id=${q(first.authorization)};`),'1');
  assert.equal(await db.query(`select count(*) from fmat.oauth_codes where grant_id=${q(first.grant)};`),'1');
  assert.equal(await db.query("select used from fmat.oauth_intake_budgets where bucket='service';"),'1','consent retries do not consume another intake admission');
  assert.equal(await db.query(`select count(*) from fmat.requests where host_id=${q(host)};`),'0');
  assert.equal((await race(`select public.fmat_oauth_intake_revoke(${q(first.authorization)},${q(browser)});`,check(first))).error,'invalid_grant','committed revocation wins a waiting grant check');

  const readiness=await fixture(false);
  assert.equal((await race(`update fmat.calendar_connections set revoked_at=clock_timestamp(),encrypted_credential=null where principal_kind='host' and principal_id=${q(host)};`,consent(readiness))).error,'invalid_grant','readiness loss wins a waiting consent');
  assert.equal(await db.query(`select count(*) from fmat.oauth_grants where authorization_id=${q(readiness.authorization)};`),'0');
  await db.query(`update fmat.calendar_connections set revoked_at=null,encrypted_credential='encrypted-synthetic-fixture' where principal_kind='host' and principal_id=${q(host)};`);

  const expiredConsent=await fixture(false);
  await db.query(`update fmat.oauth_authorizations set created_at=statement_timestamp()-interval '9 minutes',expires_at=statement_timestamp()+interval '1 second' where id=${q(expiredConsent.authorization)};`);
  assert.equal((await race(`select 1 from fmat.oauth_clients where id=${q(client)} for update;`,consent(expiredConsent),'select pg_sleep(1.2);commit;')).error,'invalid_request','consent expiry is checked after a client-lock wait');
  assert.equal(await db.query(`select count(*) from fmat.oauth_grants where authorization_id=${q(expiredConsent.authorization)};`),'0');

  const bound=await fixture();
  const binding=`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values(${q(bound.request)},${q(host)},'{}',${q(hash(bound.request))},clock_timestamp()+interval '1 day');update fmat.oauth_intakes set request_id=${q(bound.request)},token_hash=${q(hash(bound.request))},bound_at=clock_timestamp() where id=${q(bound.intake)};`;
  assert.equal((await race(binding,check(bound))).actorKind,'intake','grant check observes committed request binding under intake lock');
  assert.equal((await race(`update fmat.requests set token_hash=${q(hash('rotated'))} where id=${q(bound.request)};`,check(bound))).error,'invalid_grant','request rotation wins after a request-lock wait');
  await db.query(`update fmat.requests set token_hash=${q(hash(bound.request))} where id=${q(bound.request)};`);
  assert.equal(parse(await db.query(check(bound))).error,'invalid_grant','restoring old proof does not revive observed lost authority');

  // Seed only timestamps for the fixed 15-minute boundary. No trigger is
  // disabled and no immutable field is rewritten. This isolates the authority
  // deadline test from waiting fifteen real minutes after browser consent.
  const expiry:Fixture={authorization:randomUUID(),intake:randomUUID(),grant:randomUUID(),request:randomUUID(),code:hash(randomUUID())};
  await db.query(`insert into fmat.oauth_authorizations(id,client_id,resource,redirect_uri,scope,code_challenge,state,browser_hash,created_at,expires_at,decision,decided_at) values(${q(expiry.authorization)},${q(client)},${q(resource)},${q(redirect)},'request:intake request:read request:write',repeat('A',43),'s',${q(browser)},statement_timestamp(),statement_timestamp()+interval '10 minutes','grant',statement_timestamp());insert into fmat.oauth_grants(id,authorization_id,client_id,resource,scope,actor_kind,actor_id,host_id,created_at,expires_at) values(${q(expiry.grant)},${q(expiry.authorization)},${q(client)},${q(resource)},'request:intake request:read request:write','intake',${q(expiry.intake)},${q(host)},statement_timestamp()-interval '14 minutes 59 seconds',statement_timestamp()+interval '1 day');insert into fmat.oauth_intakes(id,authorization_id,host_id,reserved_request_id,browser_hash,created_at,grant_id,granted_at,create_expires_at) values(${q(expiry.intake)},${q(expiry.authorization)},${q(host)},${q(expiry.request)},${q(browser)},statement_timestamp()-interval '15 minutes',${q(expiry.grant)},statement_timestamp()-interval '14 minutes 59 seconds',statement_timestamp()+interval '1 second');`);
  assert.equal((await race(`select 1 from fmat.oauth_intakes where id=${q(expiry.intake)} for update;`,check(expiry),'select pg_sleep(1.2);commit;')).error,'invalid_grant','creation deadline is checked after lock waits');
  assert.equal(await db.query(`select revoked_at is not null from fmat.oauth_grants where id=${q(expiry.grant)};`),'t');
  assert.equal(parse(await db.query(`select public.fmat_oauth_intake_revoke(${q(expiry.authorization)},${q(browser)});`)).revoked,true);

  const clientWait=await fixture();
  assert.equal((await race(`update fmat.oauth_clients set disabled_at=clock_timestamp() where id=${q(client)};`,check(clientWait))).error,'invalid_grant','client disablement wins waiting verification');
  await db.query(`update fmat.oauth_clients set disabled_at=null where id=${q(client)};`);

  await db.query(`update fmat.oauth_intake_budgets set used=28 where bucket=${q('host:'+host)};update fmat.oauth_clients set authorization_window_at=clock_timestamp()-interval '2 minutes' where id=${q(client)};`);
  const admissions=await Promise.all(peers.map(p=>p.query(start()).then(parse)));
  assert.equal(admissions.filter(value=>value.authorizationId).length,2);
  assert.equal(admissions.filter(value=>value.error==='rate_limited').length,6);
  assert.equal(await db.query(`select used from fmat.oauth_intake_budgets where bucket=${q('host:'+host)};`),'30');
 }finally{
  try{
   await lock.query('rollback;').catch(()=>{});await wait.query('rollback;').catch(()=>{});
   await db.query(`delete from fmat.oauth_codes where grant_id in(select id from fmat.oauth_grants where client_id=${q(client)});delete from fmat.oauth_refresh_tokens where grant_id in(select id from fmat.oauth_grants where client_id=${q(client)});delete from fmat.oauth_intakes where host_id=${q(host)};delete from fmat.oauth_grants where client_id=${q(client)};delete from fmat.oauth_authorizations where client_id=${q(client)};delete from fmat.oauth_clients where id=${q(client)};delete from fmat.requests where host_id=${q(host)};delete from fmat.calendar_connections where principal_kind='host' and principal_id=${q(host)};delete from fmat.hosts where id=${q(host)};delete from fmat.invitations where id=${q(invitation)};delete from auth.users where id=${q(host)};`);
   if(savedRegistry!==undefined)await db.query(`delete from fmat.oauth_budgets;insert into fmat.oauth_budgets select * from jsonb_populate_recordset(null::fmat.oauth_budgets,${q(savedRegistry)}::jsonb);`);
   if(savedIntake!==undefined)await db.query(`delete from fmat.oauth_intake_budgets;insert into fmat.oauth_intake_budgets select * from jsonb_populate_recordset(null::fmat.oauth_intake_budgets,${q(savedIntake)}::jsonb);`);
  }finally{for(const sql of [db,lock,wait,...peers])sql.close();}
 }
});
