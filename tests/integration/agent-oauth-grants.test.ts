import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
import {LocalSql} from './local-sql.ts';
const q=(v:string)=>`'${v.replaceAll("'","''")}'`;
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const parse=(v:string)=>JSON.parse(v) as Record<string,string>;
const resource='https://release.findmeatime.com/mcp',redirect='https://client.example/cb',verifier='A'.repeat(43),browser='a'.repeat(64);
async function blocked(db:LocalSql,name:string){for(let n=0;n<60;n++){if(await db.query(`select exists(select 1 from pg_stat_activity where application_name=${q(name)} and wait_event_type='Lock');`)==='t')return;await setTimeout(50);}throw Error('No observed lock wait');}

test('OAuth consent, code consumption, rotation, replay and current authority serialize',async()=>{
 const db=new LocalSql(),lock=new LocalSql(),wait=new LocalSql(),peers=Array.from({length:8},()=>new LocalSql());
 const host=randomUUID(),session=randomUUID(),invitation=randomUUID(),client=randomUUID(),waitName=`oauth-grant-${randomUUID()}`;
 type Fixture={request:string|null;authorization:string;credential:string;code:string;refresh:string;grant:string};
 const consent=(f:Fixture)=>`select public.fmat_oauth_consent(${q(f.authorization)},${q(browser)},${q(f.credential)}::jsonb,'grant',${q(f.code)});`;
 const exchange=(f:Fixture,token=f.refresh)=>`select public.fmat_oauth_code_exchange(${q(client)},${q(resource)},${q(f.code)},${q(redirect)},${q(verifier)},${q(token)});`;
 const refresh=(f:Fixture,next=hash(randomUUID()))=>`select public.fmat_oauth_refresh(${q(client)},${q(resource)},${q(f.refresh)},${q(next)},null);`;
 async function fixture(kind:'host'|'guest'='guest',issue=true):Promise<Fixture>{
  const authorization=randomUUID(),request=kind==='guest'?randomUUID():null;
  const secret=hash(randomUUID());
  if(request)await db.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values(${q(request)},${q(host)},'{}',${q(secret)},clock_timestamp()+interval '1 day');`);
  const credential=JSON.stringify(request?{kind,requestId:request,tokenHash:secret}:{kind,subject:host,sessionId:session,expiresAt:new Date(Date.now()+3600000).toISOString()});
  // This suite isolates lifecycle concurrency from the registry suite's global
  // budget tests. Seed only the already-tested pending authorization boundary.
  await db.query(`insert into fmat.oauth_authorizations(id,client_id,resource,redirect_uri,scope,code_challenge,state,browser_hash,created_at,expires_at) values(${q(authorization)},${q(client)},${q(resource)},${q(redirect)},${q(kind==='host'?'host:read':'request:read request:write')},${q(createHash('sha256').update(verifier).digest('base64url'))},'state',${q(browser)},statement_timestamp(),statement_timestamp()+interval '10 minutes');`);
  const f={request,authorization,credential,code:hash(randomUUID()),refresh:hash(randomUUID()),grant:''};
  if(issue){assert.equal(parse(await db.query(consent(f))).decision,'grant');f.grant=await db.query(`select id from fmat.oauth_grants where authorization_id=${q(authorization)};`);}
  return f;
 }
 try{
  await db.query(`insert into auth.users(id,email,email_confirmed_at) values(${q(host)},'oauth-concurrent@example.test',now());insert into auth.sessions(id,user_id) values(${q(session)},${q(host)});insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values(${q(invitation)},'oauth-concurrent@example.test',${q(hash(invitation))},now()+interval '1 day','oauth-concurrency');insert into fmat.hosts(id,email,invitation_id) values(${q(host)},'oauth-concurrent@example.test',${q(invitation)});insert into fmat.oauth_clients(id,name,redirect_uris,resource) values(${q(client)},'OAuth grant fixture',array[${q(redirect)}],${q(resource)});`);
  await wait.query(`set application_name=${q(waitName)};`);
  const first=await fixture('guest',false);
  const decisions=await Promise.all(peers.map(p=>p.query(consent(first)).then(parse)));
  assert.ok(decisions.every(r=>r.decision==='grant'));
  first.grant=await db.query(`select id from fmat.oauth_grants where authorization_id=${q(first.authorization)};`);
  assert.equal(await db.query(`select count(*) from fmat.oauth_codes where grant_id=${q(first.grant)};`),'1');
  const exchanges=await Promise.all(peers.map((p,i)=>p.query(exchange(first,hash(first.refresh+i))).then(parse)));
  assert.equal(exchanges.filter(r=>r.grantId).length,1);assert.equal(exchanges.filter(r=>r.error==='invalid_grant').length,7);
  first.refresh=await db.query(`select token_hash from fmat.oauth_refresh_tokens where grant_id=${q(first.grant)};`);
  const rotations=await Promise.all(peers.map(p=>p.query(refresh(first)).then(parse)));
  assert.equal(rotations.filter(r=>r.grantId).length,1);assert.equal(rotations.filter(r=>r.error==='invalid_grant').length,7);
  assert.equal(await db.query(`select revoked_at is not null from fmat.oauth_grants where id=${q(first.grant)};`),'t');
  assert.equal(await db.query(`select count(*) from fmat.oauth_refresh_tokens where grant_id=${q(first.grant)};`),'2');
  const current=await db.query(`select token_hash from fmat.oauth_refresh_tokens where grant_id=${q(first.grant)} and consumed_at is null;`);
  assert.equal(parse(await db.query(refresh({...first,refresh:current}))).error,'invalid_grant','replay fences winning descendant');

  const expiredCode=await fixture();
  await db.query(`update fmat.oauth_codes set created_at=statement_timestamp()-interval '30 seconds',expires_at=statement_timestamp()+interval '2 seconds' where grant_id=${q(expiredCode.grant)};`);
  await lock.query(`begin;select 1 from fmat.oauth_grants where id=${q(expiredCode.grant)} for update;`);
  let pending=wait.query(exchange(expiredCode));await blocked(db,waitName);await lock.query('select pg_sleep(2.1);commit;');
  assert.equal(parse(await pending).error,'invalid_grant','code expires while waiting for grant lock');

  const expiredGrant=await fixture();assert.ok(parse(await db.query(exchange(expiredGrant))).grantId);
  await db.query(`update fmat.oauth_grants set created_at=statement_timestamp()-interval '1 day',expires_at=statement_timestamp()+interval '2 seconds' where id=${q(expiredGrant.grant)};`);
  await lock.query(`begin;select 1 from fmat.oauth_refresh_tokens where token_hash=${q(expiredGrant.refresh)} for update;`);
  pending=wait.query(refresh(expiredGrant));await blocked(db,waitName);await lock.query('select pg_sleep(2.1);commit;');
  assert.equal(parse(await pending).error,'invalid_grant','grant expires after authority check while token lock waits');
  assert.equal(await db.query(`select consumed_at is null from fmat.oauth_refresh_tokens where token_hash=${q(expiredGrant.refresh)};`),'t');

  const hostCode=await fixture('host');
  await db.query(`update auth.sessions set not_after=clock_timestamp()+interval '2 seconds' where id=${q(session)};`);
  await lock.query(`begin;select 1 from fmat.oauth_codes where token_hash=${q(hostCode.code)} for update;`);
  pending=wait.query(exchange(hostCode));await blocked(db,waitName);await lock.query('select pg_sleep(2.1);commit;');
  assert.equal(parse(await pending).error,'invalid_grant','host session expires during final code lock wait');
  await db.query(`update auth.sessions set not_after=null where id=${q(session)};`);

  const hostConsent=await fixture('host',false);
  hostConsent.credential=JSON.stringify({kind:'host',subject:host,sessionId:session,expiresAt:new Date(Date.now()+2000).toISOString()});
  await lock.query(`begin;select 1 from fmat.oauth_authorizations where id=${q(hostConsent.authorization)} for update;`);
  pending=wait.query(consent(hostConsent));await blocked(db,waitName);await lock.query('select pg_sleep(2.1);commit;');
  assert.equal(parse(await pending).error,'invalid_grant','expired browser JWT cannot create delegated grant after lock');
  assert.equal(await db.query(`select count(*) from fmat.oauth_grants where authorization_id=${q(hostConsent.authorization)};`),'0');

  const hostRevoke=await fixture('host');
  const expiringCredential=JSON.stringify({kind:'host',subject:host,sessionId:session,expiresAt:new Date(Date.now()+2000).toISOString()});
  await lock.query(`begin;select 1 from fmat.oauth_grants where id=${q(hostRevoke.grant)} for update;`);
  pending=wait.query(`select public.fmat_oauth_grant_revoke(${q(hostRevoke.grant)},${q(expiringCredential)}::jsonb);`);
  await blocked(db,waitName);await lock.query('select pg_sleep(2.1);commit;');
  assert.equal(parse(await pending).error,'invalid_grant','browser revocation rechecks credential expiry after lock');
  assert.equal(await db.query(`select revoked_at is null from fmat.oauth_grants where id=${q(hostRevoke.grant)};`),'t');

  const rotated=await fixture();assert.ok(parse(await db.query(exchange(rotated))).grantId);
  await lock.query(`begin;update fmat.requests set token_hash=${q(hash(randomUUID()))} where id=${q(rotated.request!)};`);
  pending=wait.query(refresh(rotated));await blocked(db,waitName);await lock.query('commit;');
  assert.equal(parse(await pending).error,'invalid_grant','request rotation wins blocked refresh');

  const revoked=await fixture();assert.ok(parse(await db.query(exchange(revoked))).grantId);
  await lock.query(`begin;select public.fmat_oauth_token_revoke(${q(client)},${q(resource)},${q(revoked.refresh)});`);
  pending=wait.query(refresh(revoked));await blocked(db,waitName);await lock.query('commit;');
  assert.equal(parse(await pending).error,'invalid_grant','committed revocation wins blocked refresh');
 }finally{
  await lock.query('rollback;').catch(()=>{});
  await db.query(`delete from fmat.oauth_refresh_tokens where grant_id in(select id from fmat.oauth_grants where client_id=${q(client)});delete from fmat.oauth_codes where grant_id in(select id from fmat.oauth_grants where client_id=${q(client)});delete from fmat.oauth_grants where client_id=${q(client)};delete from fmat.oauth_authorizations where client_id=${q(client)};delete from fmat.oauth_clients where id=${q(client)};delete from fmat.requests where host_id=${q(host)};delete from fmat.hosts where id=${q(host)};delete from fmat.invitations where id=${q(invitation)};delete from auth.users where id=${q(host)};`);
  for(const connection of [db,lock,wait,...peers])connection.close();
 }
});
