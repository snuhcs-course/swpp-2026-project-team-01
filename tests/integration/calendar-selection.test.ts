import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {CalendarSelection} from '../../lib/server/calendar/selection.ts';
import {CalendarConsent} from '../../lib/server/calendar/consent.ts';
import {calendarScopes} from '../../lib/server/calendar/google.ts';
import {TokenCipher} from '../../lib/server/calendar/encryption.ts';
import {Database} from '../../lib/server/database/client.ts';
import {verifyHostToken,guestCredential} from '../../lib/server/identity/credentials.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {LocalSql} from './local-sql.ts';
const code=(value:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===value;
test('Calendar choices use fresh permissions and recheck current Auth/grant after refresh and provider reads',async()=>{
  const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
  const env={...process.env,APP_ORIGIN:'http://localhost:3000',SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
  const headers={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'};
  const sql=new LocalSql(),email=randomUUID()+'@example.test',password=randomUUID()+randomUUID(),invitation=randomUUID();let host='';
  const database=new Database(env),cipher=new TokenCipher(env);
  let role:'owner'|'reader'='owner',refreshes=0,listCalls=0,gate:()=>Promise<void>=async()=>{};
  const service=new CalendarSelection(database,env,{async refresh(bundle){refreshes++;await gate();return {...bundle,accessToken:'refreshed-access',expiresAt:Date.now()+3600000};},async list(){listCalls++;await gate();return [{id:'read',name:'Calendar',accessRole:'reader',primary:true,timeZone:null,color:null},{id:'write',name:'Calendar',accessRole:role,primary:false,timeZone:null,color:null}];}});
  try{
    const create=await fetch(local.API_URL+'/auth/v1/admin/users',{method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(create.status,200);host=(await create.json()).id;
    const signIn=await fetch(local.API_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:local.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(signIn.status,200);const token=(await signIn.json()).access_token,credential=await verifyHostToken(token,{env});
    await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','${email}','${createHash('sha256').update(invitation).digest('hex')}',now()+interval '1 day','selection-test');insert into fmat.hosts(id,email,invitation_id) values('${host}','${email}','${invitation}');`);
    const bundle={accessToken:'private-access',refreshToken:'private-refresh',subject:'fixture',scopes:[...calendarScopes.host],expiresAt:1};
    const encrypted=cipher.seal(bundle,'google:host:'+host);
    await sql.query(`insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential) values('host','${host}','fixture',array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],'${encrypted}');`);
    let catalog=await service.list(credential);assert.equal(refreshes,1);assert.equal(catalog.bookingCalendarId,null);assert.deepEqual(catalog.conflictCalendarIds,[]);assert.ok(!JSON.stringify(catalog).includes('private-'));assert.ok(!('encryptedCredential' in catalog));
    const stored=await sql.query(`select encrypted_credential from fmat.calendar_connections where principal_id='${host}';`);assert.equal((cipher.open(stored,'google:host:'+host) as {accessToken:string}).accessToken,'refreshed-access');assert.notEqual(stored,encrypted);
    let selection={generation:catalog.generation,rulesVersion:catalog.rulesVersion,conflictCalendarIds:['read'],bookingCalendarId:'write'};
    await assert.rejects(service.select(credential,{...selection,bookingCalendarId:'read'}),code('CALENDAR_ACCESS_INVALID'));
    role='reader';await assert.rejects(service.select(credential,selection),code('CALENDAR_ACCESS_INVALID'));role='owner';
    const saved=await service.select(credential,selection);assert.equal(saved.saved,true);assert.equal(saved.rulesVersion,catalog.rulesVersion+1);
    assert.deepEqual(JSON.parse(await sql.query(`select json_build_object('conflictCalendarIds',conflict_calendar_ids,'bookingCalendarId',booking_calendar_id) from fmat.hosts where id='${host}';`)),{conflictCalendarIds:['read'],bookingCalendarId:'write'},'Duplicate display names cannot replace the exact selected calendar IDs');
    await assert.rejects(service.select(credential,selection),code('STALE_REVISION'));
    const beforeForgedCatalog=listCalls;
    await assert.rejects(service.select(credential,{...selection,rulesVersion:saved.rulesVersion,verifiedCalendars:[{id:'read',accessRole:'owner'}]}));
    assert.equal(listCalls,beforeForgedCatalog,'Caller-supplied Calendar permissions are rejected before provider I/O');
    assert.equal(await sql.query(`select rules_version from fmat.hosts where id='${host}';`),String(saved.rulesVersion),'Forged permissions cannot change saved policy');
    const before=listCalls;await assert.rejects(service.list(guestCredential(randomUUID(),randomBytes(32).toString('base64url'))),code('FORBIDDEN'));assert.equal(listCalls,before);
    catalog=await service.list(credential);selection={...selection,generation:catalog.generation,rulesVersion:catalog.rulesVersion};
    async function paused<T>(action:()=>Promise<T>,mutate:()=>Promise<unknown>,expected:string){
      let release!:()=>void,entered!:()=>void;const arrived=new Promise<void>(r=>entered=r),waiting=new Promise<void>(r=>release=r);gate=async()=>{entered();await waiting;};
      const pending=action();const rejected=assert.rejects(pending,code(expected));await arrived;await mutate();release();await rejected;gate=async()=>{};
    }
    await paused(()=>service.select(credential,selection),()=>sql.query(`update fmat.calendar_connections set generation=gen_random_uuid() where principal_id='${host}';`),'STALE_REVISION');
    assert.equal(await sql.query(`select rules_version from fmat.hosts where id='${host}';`),String(saved.rulesVersion));
    await paused(()=>service.list(credential),()=>new CalendarConsent(database,env).disconnect(credential),'RECONNECT_REQUIRED');
    assert.equal(await sql.query(`select encrypted_credential is null from fmat.calendar_connections where principal_id='${host}';`),'t');
    await sql.query(`update fmat.calendar_connections set revoked_at=null,encrypted_credential='${encrypted}',generation=gen_random_uuid() where principal_id='${host}';`);
    const concurrent=cipher.seal({...bundle,accessToken:'concurrent-access',expiresAt:Date.now()+3600000},'google:host:'+host),beforeRefreshList=listCalls;
    await paused(()=>service.list(credential),()=>sql.query(`update fmat.calendar_connections set encrypted_credential='${concurrent}' where principal_id='${host}';`),'STALE_REVISION');
    assert.equal(listCalls,beforeRefreshList,'A lost refresh comparison cannot read calendars with stale credentials');
    assert.equal(await sql.query(`select encrypted_credential from fmat.calendar_connections where principal_id='${host}';`),concurrent,'Refresh cannot overwrite a newer credential in the same generation');
    await sql.query(`update fmat.calendar_connections set encrypted_credential='${encrypted}' where principal_id='${host}';`);
    await paused(()=>service.list(credential),async()=>{const logout=await fetch(local.API_URL+'/auth/v1/logout?scope=global',{method:'POST',headers:{apikey:local.ANON_KEY,authorization:'Bearer '+token}});assert.equal(logout.status,204);},'UNAUTHORIZED');
    assert.equal(await sql.query(`select encrypted_credential from fmat.calendar_connections where principal_id='${host}';`),encrypted,'logout during refresh prevents writing new credentials');
  }finally{
    if(host){await sql.query(`delete from fmat.audit_events where subject_id='${host}';delete from fmat.calendar_connections where principal_id='${host}';delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invitation}';`);const removed=await fetch(local.API_URL+'/auth/v1/admin/users/'+host,{method:'DELETE',headers});assert.equal(removed.status,200);}
    await sql.close();
  }
});
