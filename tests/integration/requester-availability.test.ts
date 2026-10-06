import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {RequesterAvailability} from '../../lib/server/calendar/requester-availability.ts';
import {calendarScopes} from '../../lib/server/calendar/google.ts';
import {TokenCipher} from '../../lib/server/calendar/encryption.ts';
import {Database} from '../../lib/server/database/client.ts';
import {guestCredential} from '../../lib/server/identity/credentials.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {LocalSql} from './local-sql.ts';
const code=(value:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===value;
test('Requester availability stays request-bound, pauses failed reads and replaces Calendar only with explicit current manual windows',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const env={...process.env,APP_ORIGIN:'http://localhost:3000',SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
 const sql=new LocalSql(),host=randomUUID(),invitation=randomUUID(),requestId=randomUUID(),token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex'),credential=guestCredential(requestId,token),cipher=new TokenCipher(env);
 const windows=[{start:new Date(Date.now()+86400000).toISOString(),end:new Date(Date.now()+90000000).toISOString()}];
 const bundle={accessToken:'requester-private-access',refreshToken:'requester-private-refresh',subject:'fixture',expiresAt:1,scopes:[...calendarScopes.guest]},encrypted=cipher.seal(bundle,'google:guest:'+requestId);
 let refreshes=0,reads=0,fail=false,gate:()=>Promise<void>=async()=>{};
 const service=new RequesterAvailability(new Database(env),env,{async refresh(value,kind){assert.equal(kind,'guest');refreshes++;return {...value,expiresAt:Date.now()+3600000};},async list(){return [{id:'mine',name:'My calendar',accessRole:'reader',primary:true,timeZone:'Asia/Seoul',color:null}];}},{async read(_access,ids,ranges){reads++;assert.deepEqual(ids,['mine']);assert.deepEqual(ranges,windows);await gate();if(fail)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);return [{start:windows[0].start,end:windows[0].end}];}});
 try{
  await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','${host}@example.test','${createHash('sha256').update(invitation).digest('hex')}',now()+interval '1 day','availability-test');insert into fmat.hosts(id,email,invitation_id) values('${host}','${host}@example.test','${invitation}');insert into fmat.requests(id,host_id,details,token_hash,expires_at,availability_mode) values('${requestId}','${host}','${JSON.stringify({windows,timezone:'Asia/Seoul'})}','${hash}',now()+interval '2 days','calendar');insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential,guest_authority_key) values('guest','${requestId}','fixture',array['https://www.googleapis.com/auth/calendar.events.freebusy','https://www.googleapis.com/auth/calendar.calendarlist.readonly'],'${encrypted}','${hash}');`);
  const catalog=await service.list(credential);assert.equal(refreshes,1);assert.deepEqual(catalog.selectedCalendarIds,[]);assert.ok(!JSON.stringify(catalog).includes('requester-private'));
  await assert.rejects(service.list(guestCredential(randomUUID(),token)),code('NOT_FOUND'));
  await service.select(credential,{generation:catalog.generation,revision:catalog.revision,calendarIds:['mine']});
  const checked=await service.check(credential);assert.equal(checked.checked,true);assert.ok(!('busy' in checked));assert.equal(reads,1);
  fail=true;await assert.rejects(service.check(credential),code('PROVIDER_UNAVAILABLE'));let state=await service.status(credential);assert.equal(state.failed,true);assert.equal(state.mode,'calendar');assert.equal(state.revision,3);
  await assert.rejects(service.manual(credential,{revision:1,confirmed:true,timezone:'Asia/Seoul',windows}),code('STALE_REVISION'));
  fail=false;await service.check(credential);assert.equal((await service.status(credential)).failed,false);
  let release!:()=>void,entered!:()=>void;const arrived=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);gate=async()=>{entered();await wait;};
  const pending=service.check(credential),rejected=assert.rejects(pending,code('RECONNECT_REQUIRED'));await arrived;
  await service.manual(credential,{revision:state.revision,confirmed:true,timezone:'Asia/Seoul',windows});release();await rejected;gate=async()=>{};
  state=await service.status(credential);assert.equal(state.mode,'manual');assert.equal(state.connected,false);assert.equal(state.failed,false);assert.deepEqual(state.windows,windows);
  assert.equal(await sql.query(`select encrypted_credential is null from fmat.calendar_connections where principal_id='${requestId}';`),'t');
  assert.equal(await sql.query(`select requester_agreed_version is null and host_approved_version is null and current_proposal_version is null from fmat.requests where id='${requestId}';`),'t');
  await sql.query(`update fmat.requests set availability_mode='calendar' where id='${requestId}';update fmat.calendar_connections set revoked_at=null,encrypted_credential='${encrypted}',generation=gen_random_uuid(),selected_calendar_ids=array['mine'] where principal_id='${requestId}';`);
  const newCatalog=await service.list(credential);assert.notEqual(newCatalog.generation,catalog.generation);
  await assert.rejects(service.select(credential,{generation:catalog.generation,revision:state.revision,calendarIds:['mine']}),code('STALE_REVISION'));
  await sql.query(`update fmat.requests set status='withdrawn',token_revoked_at=now() where id='${requestId}';`);
  await assert.rejects(service.check(credential),code('NOT_FOUND'));assert.equal(await sql.query(`select encrypted_credential is null from fmat.calendar_connections where principal_id='${requestId}';`),'t');
 }finally{
  await sql.query(`delete from fmat.audit_events where subject_id='${requestId}';delete from fmat.calendar_connections where principal_id='${requestId}';delete from fmat.request_history where request_id='${requestId}';delete from fmat.requests where id='${requestId}';delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invitation}';`).finally(()=>sql.close());
 }
});
