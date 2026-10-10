import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {CalendarConsent} from '../../lib/server/calendar/consent.ts';
import {calendarScopes,type GoogleConsent} from '../../lib/server/calendar/google.ts';
import {TokenCipher} from '../../lib/server/calendar/encryption.ts';
import {Database} from '../../lib/server/database/client.ts';
import {guestCredential} from '../../lib/server/identity/credentials.ts';
import {LocalSql} from './local-sql.ts';

test('Calendar service stores only encrypted bound grants, consumes concurrent callbacks once, and rechecks authority after provider exchange',async()=>{
  const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
  const env={...process.env,APP_ORIGIN:'http://localhost:3000',SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
  const sql=new LocalSql(),host=randomUUID(),invitation=randomUUID(),request=randomUUID(),token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex');
  let verifier='',nonce='',calls=0,gate:Promise<void>=Promise.resolve(),entered=()=>{};
  const google:GoogleConsent={authorization(_kind,state,v,n){verifier=v;nonce=n;return 'https://accounts.google.com/o/oauth2/v2/auth?state='+state;},async exchange(_code,v,n,kind){calls++;assert.equal(v,verifier);assert.equal(n,nonce);entered();await gate;return {accessToken:'private-access',refreshToken:'private-refresh',expiresAt:Date.now()+3600000,subject:'google-synthetic',scopes:[...calendarScopes[kind]]};}};
  const service=new CalendarConsent(new Database(env),env,google),credential=guestCredential(request,token);
  try{
    await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','${host}@example.test','${createHash('sha256').update(invitation).digest('hex')}',now()+interval '1 day','calendar-test');insert into fmat.hosts(id,email,invitation_id) values('${host}','${host}@example.test','${invitation}');insert into fmat.requests(id,host_id,details,token_hash,expires_at) values('${request}','${host}','{}','${hash}',now()+interval '1 day');`);
    const start=await service.start(credential);
    const raw=await sql.query(`select encrypted_verifier from fmat.oauth_exchanges where state_hash='${createHash('sha256').update(start.state).digest('hex')}';`);
    assert.ok(!raw.includes(verifier));assert.ok(!raw.includes(nonce));
    await assert.rejects(service.callback(start.state,randomBytes(32).toString('base64url'),'code',false));assert.equal(calls,0);
    assert.equal(await sql.query(`select consumed_at is null from fmat.oauth_exchanges where state_hash='${createHash('sha256').update(start.state).digest('hex')}';`),'t','Wrong browser cannot consume otherwise valid state');
    const callbacks=await Promise.allSettled([service.callback(start.state,start.binding,'code',false),service.callback(start.state,start.binding,'code',false)]);
    assert.equal(callbacks.filter(x=>x.status==='fulfilled').length,1);assert.equal(calls,1);
    assert.deepEqual((callbacks.find(x=>x.status==='fulfilled') as PromiseFulfilledResult<unknown>).value,{returnPath:'/booking/'+request,result:'connected'});
    assert.deepEqual(await service.status(credential),{connected:true,kind:'guest',selected:false});
    const encrypted=await sql.query(`select encrypted_credential from fmat.calendar_connections where principal_kind='guest' and principal_id='${request}';`);
    assert.ok(!encrypted.includes('private-refresh'));assert.equal((new TokenCipher(env).open(encrypted,'google:guest:'+request) as {refreshToken:string}).refreshToken,'private-refresh');
    const denial=await service.start(credential);assert.deepEqual(await service.callback(denial.state,denial.binding,null,true),{returnPath:'/booking/'+request,result:'denied'});assert.equal(calls,1);
    await assert.rejects(service.callback(denial.state,denial.binding,'code',false));
    await service.disconnect(credential);assert.equal((await service.status(credential)).connected,false);
    assert.equal(await sql.query(`select encrypted_credential is null from fmat.calendar_connections where principal_id='${request}';`),'t');
    const abandoned=await service.start(credential),replacement=await service.start(credential);
    assert.notEqual(abandoned.state,replacement.state);assert.notEqual(abandoned.binding,replacement.binding);
    await assert.rejects(service.callback(abandoned.state,abandoned.binding,'old-code',false));assert.equal(calls,1);
    assert.equal(await sql.query(`select encrypted_verifier is null and expires_at<=clock_timestamp() from fmat.oauth_exchanges where state_hash='${createHash('sha256').update(abandoned.state).digest('hex')}';`),'t');
    assert.deepEqual(await service.callback(replacement.state,replacement.binding,null,true),{returnPath:'/booking/'+request,result:'denied'});
    // A restart during external exchange must also fence the older save.
    const superseded=await service.start(credential);let resume!:()=>void;gate=new Promise(resolve=>resume=resolve);const exchanging=new Promise<void>(resolve=>entered=resolve);
    const oldCallback=service.callback(superseded.state,superseded.binding,'old-code',false);await exchanging;
    const latest=await service.start(credential);resume();assert.equal((await oldCallback).result,'reconnect');
    assert.equal(await sql.query(`select encrypted_credential is null from fmat.calendar_connections where principal_id='${request}';`),'t','Superseded in-flight consent cannot install credentials');
    assert.equal((await service.callback(latest.state,latest.binding,null,true)).result,'denied');gate=Promise.resolve();entered=()=>{};
    const pending=await service.start(credential);let release!:()=>void;gate=new Promise(resolve=>release=resolve);const arrived=new Promise<void>(resolve=>entered=resolve);
    const callback=service.callback(pending.state,pending.binding,'code',false);await arrived;
    await sql.query(`update fmat.requests set token_revoked_at=now() where id='${request}';`);release();
    assert.equal((await callback).result,'reconnect');assert.equal(await sql.query(`select encrypted_credential is null from fmat.calendar_connections where principal_id='${request}';`),'t','Revocation during external exchange cannot reconnect');
  }finally{
    await sql.query(`delete from fmat.audit_events where subject_id='${request}' or subject_id in(select id::text from fmat.oauth_exchanges where actor->>'requestId'='${request}') or subject_id in(select id::text from fmat.calendar_connections where principal_id='${request}');delete from fmat.oauth_exchanges where actor->>'requestId'='${request}';delete from fmat.calendar_connections where principal_id='${request}';delete from fmat.request_history where request_id='${request}';delete from fmat.requests where id='${request}';delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invitation}';`).finally(()=>sql.close());
  }
});
