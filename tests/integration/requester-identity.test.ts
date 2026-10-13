import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {RequesterIdentity,type IdentityAuthority} from '../../lib/server/identity/requester-identity.ts';
import {PublicIntake} from '../../lib/server/identity/public-intake.ts';
import {guestCredential} from '../../lib/server/identity/credentials.ts';
import {Database} from '../../lib/server/database/client.ts';
import {TokenCipher} from '../../lib/server/calendar/encryption.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {LocalSql} from './local-sql.ts';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const error=(code:string)=>(e:unknown)=>e instanceof ApplicationError&&e.code===code;
test('requester identity binds drafts and proof to current browser authority without email takeover',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['127.0.0.1','localhost'].includes(new URL(local.API_URL).hostname));
 const env={...process.env,SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
 const sql=new LocalSql(),db=new Database(env),host=randomUUID(),invite=randomUUID(),handle='identity-'+host.slice(0,8),tokens:string[]=[],requests:string[]=[];
 let identity={subject:'google-subject',name:'Guest',email:'guest@gmail.com',contactVerified:true},exchanges=0,gate:()=>Promise<void>=async()=>{};
 const secrets=new Map<string,string>();
 const provider={authorization(state:string,verifier:string,nonce:string){secrets.set(verifier,nonce);return 'https://accounts.google.com/?state='+state;},async exchange(_code:string,verifier:string,nonce:string){assert.equal(secrets.get(verifier),nonce);exchanges++;await gate();return identity;}};
 const service=new RequesterIdentity(db,env,provider),draft={requesterName:'Draft guest',requesterEmail:'draft@example.test',purpose:'PRIVATE purpose',timezone:'America/New_York',durationMinutes:30};
 function intake():IdentityAuthority{const token=randomBytes(32).toString('base64url');tokens.push(hash(token));return {kind:'intake',handle,token};}
 async function request(){const token=randomBytes(32).toString('base64url'),id=randomUUID();tokens.push(hash(token));requests.push(id);await sql.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values('${id}','${host}','{"requesterEmail":"guest@gmail.com"}','${hash(token)}',clock_timestamp()+interval '1 day');`);return {id,token,authority:guestCredential(id,token)};}
 const finish=(a:IdentityAuthority,s:{state:string;binding:string},which=service)=>which.callback(a,{...s,code:'provider-code',denied:false});
 // Do not pass the authorization URL into strict callback contracts.
 const callback=(a:IdentityAuthority,s:{state:string;binding:string},which=service)=>finish(a,{state:s.state,binding:s.binding},which);
 try{
  const encrypted=new TokenCipher(env).seal({accessToken:'fixture',refreshToken:'fixture-refresh',expiresAt:Date.now()+3600000,subject:'host',scopes:['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events']},'google:host:'+host);
  await sql.query(`insert into auth.users(id,email,email_confirmed_at) values('${host}','host@example.test',now());insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invite}','host@example.test','${hash(invite)}',now()+interval '1 day','identity-test');insert into fmat.hosts(id,email,invitation_id,handle,display_name,rules,conflict_calendar_ids,booking_calendar_id) values('${host}','host@example.test','${invite}','${handle}','Host','{"timezone":"UTC","durationMinutes":30}',array['mine'],'mine');insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential) values('host','${host}','host',array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],'${encrypted}');`);
  const a=intake(),other=intake();assert.equal(await service.read(a),null);
  const started=await service.start(a,{draft});assert.deepEqual(await service.lookup(started.state,started.binding),{kind:'intake',target:handle});
  await assert.rejects(service.lookup(started.state,randomBytes(32).toString('base64url')),error('OAUTH_STATE_INVALID'));
  await assert.rejects(callback(other,started),error('OAUTH_STATE_INVALID'));assert.equal(exchanges,0);
  assert.equal((await callback(a,started)).result,'verified');assert.equal(exchanges,1);
  assert.deepEqual(await service.read(a),{draft,identity:{name:'Guest',email:'guest@gmail.com',contactVerified:true}});
  assert.equal(await service.read(other),null);await assert.rejects(callback(a,started),error('OAUTH_STATE_INVALID'));
  assert.equal(await sql.query(`select encrypted_verifier is null from fmat.requester_identity_flows where state_hash='${hash(started.state)}';`),'t');
  const calendars={async refresh(){throw new Error('unexpected refresh');},async list(){return [{id:'mine',name:'Calendar',accessRole:'owner' as const,primary:true,timeZone:'UTC',color:null}];}};
  const intakeService=new PublicIntake(db,env,calendars);assert.equal(a.kind,'intake');if(a.kind!=='intake')throw new Error();
  const saved=await intakeService.create(handle,a.token,{...draft,requesterEmail:'guest@gmail.com',windows:[]});requests.push(saved.requestId);
  assert.equal(await sql.query(`select contact_verified_email from fmat.requests where id='${saved.requestId}';`),'guest@gmail.com');
  await assert.rejects(service.read(a),error('NOT_FOUND'));
  assert.equal(await sql.query(`select requester_agreed_version is null and host_approved_version is null and event is null from fmat.requests where id='${saved.requestId}';`),'t');
  // Alternate recipient remains unverified despite a valid identity in the same intake.
  const alt=intake(),altStart=await service.start(alt,{draft});await callback(alt,altStart);if(alt.kind!=='intake')throw new Error();
  const altSaved=await intakeService.create(handle,alt.token,{...draft,windows:[]});requests.push(altSaved.requestId);
  assert.equal(await sql.query(`select contact_verified_email is null from fmat.requests where id='${altSaved.requestId}';`),'t');
  const switching=intake(),first=await service.start(switching,{draft}),second=await service.start(switching,{draft:{...draft,timezone:'Asia/Seoul'}});
  await assert.rejects(callback(switching,first),error('OAUTH_STATE_INVALID'));await service.skip(switching);await assert.rejects(callback(switching,second),error('OAUTH_STATE_INVALID'));
  assert.equal((await service.read(switching))?.draft.timezone,'Asia/Seoul');assert.equal((await service.read(switching))?.identity,null);
  const denied=intake(),deny=await service.start(denied,{draft});const before=exchanges;
  assert.equal((await service.callback(denied,{state:deny.state,binding:deny.binding,code:null,denied:true})).result,'denied');assert.equal(exchanges,before);assert.deepEqual((await service.read(denied))?.draft,draft);
  const g=await request(),gStart=await service.start(g.authority,{draft,revision:1});await assert.rejects(service.start({...g.authority},{draft,revision:1}),error('UNAUTHORIZED'));
  assert.equal((await callback(g.authority,gStart)).result,'verified');assert.equal(await sql.query(`select contact_verified_email is null from fmat.requests where id='${g.id}';`),'t');
  await assert.rejects(service.apply(g.authority,{revision:1,email:'other@gmail.com'}),error('STALE_REVISION'));
  const proofs=await Promise.all(Array.from({length:8},()=>service.apply(g.authority,{revision:1,email:'guest@gmail.com'})));assert.ok(proofs.every(p=>p.revision===2));
  assert.equal(await sql.query(`select count(*) from fmat.audit_events where subject_id='${g.id}' and operation='google_contact_verified';`),'1');
  assert.equal(await sql.query(`select requester_agreed_version is null and host_approved_version is null and event is null from fmat.requests where id='${g.id}';`),'t');
  // No account or Calendar grants created by an identity callback.
  assert.equal(await sql.query(`select count(*) from fmat.calendar_connections where principal_kind='guest' and principal_id in(select id from fmat.requests where host_id='${host}');`),'0');
  identity={...identity,email:'third@example.test',contactVerified:false};const third=await request(),thirdStart=await service.start(third.authority,{draft,revision:1});await callback(third.authority,thirdStart);await assert.rejects(service.apply(third.authority,{revision:1,email:'guest@gmail.com'}),error('CONTACT_NOT_VERIFIED'));identity={...identity,email:'guest@gmail.com',contactVerified:true};
  for(const mutation of ['revision','rotate','revoke','close','expire']){
   const f=await request(),s=await service.start(f.authority,{draft,revision:1});
   const changes={revision:'revision=revision+1',rotate:`token_hash='${hash(randomUUID())}'`,revoke:'token_revoked_at=clock_timestamp()',close:"status='withdrawn'",expire:"token_expires_at=clock_timestamp()-interval '1 second'"};
   await sql.query(`update fmat.requests set ${changes[mutation as keyof typeof changes]} where id='${f.id}';`);await assert.rejects(callback(f.authority,s),error(mutation==='revision'?'OAUTH_STATE_INVALID':'NOT_FOUND'));
  }
  // Authority is checked again after the provider has returned, not only at consume.
  const inFlight=await request(),s=await service.start(inFlight.authority,{draft,revision:1});let release!:()=>void,entered!:()=>void;const wait=new Promise<void>(r=>release=r),arrived=new Promise<void>(r=>entered=r);gate=async()=>{entered();await wait;};
  const pending=callback(inFlight.authority,s);await arrived;await sql.query(`update fmat.requests set token_revoked_at=clock_timestamp() where id='${inFlight.id}';`);release();assert.equal((await pending).result,'retry');gate=async()=>{};
  const superseded=intake(),oldStart=await service.start(superseded,{draft});let releaseSwitch!:()=>void,enteredSwitch!:()=>void;const switchWait=new Promise<void>(r=>releaseSwitch=r),switchArrived=new Promise<void>(r=>enteredSwitch=r);gate=async()=>{enteredSwitch();await switchWait;};
  const oldCallback=callback(superseded,oldStart);await switchArrived;await service.start(superseded,{draft});releaseSwitch();assert.equal((await oldCallback).result,'retry');assert.equal((await service.read(superseded))?.identity,null);gate=async()=>{};
  const waiting=await request(),lock=new LocalSql();try{
   await lock.query(`begin;update fmat.requests set token_expires_at=clock_timestamp()+interval '200 milliseconds' where id='${waiting.id}';`);
   const deniedAfterWait=assert.rejects(service.start(waiting.authority,{draft,revision:1}),error('NOT_FOUND'));
   await new Promise(resolve=>setTimeout(resolve,350));await lock.query('commit;');await deniedAfterWait;
  }finally{lock.close();}
  const used=await request(),usedStart=await service.start(used.authority,{draft,revision:1});await callback(used.authority,usedStart);await service.apply(used.authority,{revision:1,email:'guest@gmail.com'});
  await sql.query(`update fmat.requests set contact_verified_email=null,revision=revision+1 where id='${used.id}';`);await assert.rejects(service.apply(used.authority,{revision:3,email:'guest@gmail.com'}),error('OAUTH_STATE_INVALID'));
  const lost=intake(),ls=await service.start(lost,{draft});let dropped=false;const lossy=new RequesterIdentity({async rpc(name,args){const result=await db.rpc(name,args);if(args.p_operation==='save'&&!dropped){dropped=true;throw new ApplicationError('PROVIDER_UNAVAILABLE',503);}return result;}},env,provider);
  const previous=exchanges;assert.equal((await callback(lost,ls,lossy)).result,'verified');assert.equal(exchanges,previous+1);assert.equal(dropped,true);
  const expired=intake(),es=await service.start(expired,{draft});await sql.query(`update fmat.requester_identity_flows set expires_at=clock_timestamp()-interval '1 second' where state_hash='${hash(es.state)}';`);await assert.rejects(callback(expired,es),error('OAUTH_STATE_INVALID'));
  const limited=intake();for(let i=0;i<10;i++)await service.start(limited,{draft});await assert.rejects(service.start(limited,{draft}),error('CONSENT_LIMIT'));
  assert.equal(await sql.query(`select has_function_privilege('anon','public.fmat_requester_identity(text,jsonb,jsonb)','execute')||','||has_function_privilege('authenticated','public.fmat_requester_identity(text,jsonb,jsonb)','execute')||','||has_function_privilege('service_role','public.fmat_requester_identity(text,jsonb,jsonb)','execute');`),'false,false,true');
 }finally{
  await sql.query(`delete from fmat.requester_identity_flows where token_hash in(${tokens.map(t=>`'${t}'`).join(',')||"''"});delete from fmat.request_history where request_id in(select id from fmat.requests where host_id='${host}');delete from fmat.audit_events where subject_id in(select id::text from fmat.requests where host_id='${host}');delete from fmat.requests where host_id='${host}';delete from fmat.idempotency where actor_scope in(${tokens.map(t=>`'public:${t}'`).join(',')||"''"});delete from fmat.calendar_connections where principal_id='${host}';delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invite}';delete from auth.users where id='${host}';`);sql.close();
 }
});
