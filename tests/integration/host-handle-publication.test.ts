import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {Database} from '../../lib/server/database/client.ts';
import {HostSetup} from '../../lib/server/setup/commands.ts';
import {CalendarSelection} from '../../lib/server/calendar/selection.ts';
import type {CalendarProvider} from '../../lib/server/calendar/catalog.ts';
import {calendarScopes} from '../../lib/server/calendar/google.ts';
import {TokenCipher} from '../../lib/server/calendar/encryption.ts';
import {verifyHostToken,type Credential} from '../../lib/server/identity/credentials.ts';
import {PublicIntake} from '../../lib/server/identity/public-intake.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {LocalSql} from './local-sql.ts';
import {publicSkill} from '../../apps/web/lib/public-skill.ts';

const code=(expected:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===expected;
type State=Awaited<ReturnType<HostSetup['read']>>;
const confirmation=(state:State)=>({expectedRevision:state.revision,draftRevision:state.review!.draftRevision,
 reviewRevision:state.review!.revision,rulesVersion:state.rulesVersion,calendarGeneration:state.calendarGeneration!,
 confirmed:true,idempotencyKey:randomUUID()});

test('competing public handles publish once, preserve the losing review and recover with another handle',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const env={...process.env,SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,
  SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
 const headers={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'};
 const sql=new LocalSql(),database=new Database(env),cipher=new TokenCipher(env),handle='race-'+randomUUID().slice(0,8);
 const fixtures:{host:string;invitation:string;credential?:Credential;state?:State}[]=[];
 let gate:()=>Promise<void>=async()=>{},writable=true;
 const provider:CalendarProvider={async refresh(bundle){return bundle;},async list(){await gate();return [{id:'mine',name:'Calendar',
  accessRole:writable?'owner':'reader',primary:true,timeZone:'Asia/Seoul',color:null}];}};
 const setup=new HostSetup(database,new CalendarSelection(database,env,provider)),intake=new PublicIntake(database,env,provider);
 try{
  for(let index=0;index<2;index++){
   const email=randomUUID()+'@example.test',password=randomUUID()+randomUUID(),invitation=randomUUID();
   const created=await fetch(local.API_URL+'/auth/v1/admin/users',{method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true})});
   assert.equal(created.status,200);const host=(await created.json()).id;
   const fixture:{host:string;invitation:string;credential?:Credential;state?:State}={host,invitation};fixtures.push(fixture);
   const login=await fetch(local.API_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:local.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});
   assert.equal(login.status,200);fixture.credential=await verifyHostToken((await login.json()).access_token,{env});
   await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','${email}','${createHash('sha256').update(invitation).digest('hex')}',now()+interval '1 day','handle-test');
    insert into fmat.hosts(id,email,invitation_id,conflict_calendar_ids,booking_calendar_id) values('${host}','${email}','${invitation}',array['mine'],'mine');`);
   const encrypted=cipher.seal({accessToken:'handle-private',refreshToken:'handle-refresh',subject:'fixture',scopes:[...calendarScopes.host],expiresAt:Date.now()+3600000},'google:host:'+host);
   await sql.query(`insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential) values('host','${host}','fixture',array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],'${encrypted}');`);
   fixture.state=await setup.draft(fixture.credential,{expectedRevision:0,idempotencyKey:randomUUID(),patch:{displayName:'Host '+index,handle,
    rules:{timezone:'Asia/Seoul',durationMinutes:30,availability:[{days:[1],start:'09:00',end:'17:00'}],focusBlocks:[],bufferMinutes:10,preferences:'',meetingMode:'online'}},unresolved:[]});
   assert.ok(fixture.state.review);assert.equal(fixture.state.confirmed.handle,null);
   assert.deepEqual(await setup.readiness(fixture.credential),{ready:false,reason:'setup'});
  }
  await assert.rejects(intake.profile(handle),code('NOT_FOUND'));
  const skill=(value:string)=>publicSkill(value,name=>intake.profile(name),{...env,APP_ORIGIN:'https://release.findmeatime.com'});
  assert.equal((await skill(handle)).status,404);
  const choices=fixtures.map(f=>confirmation(f.state!));
  // Both confirmations reach provider I/O before either can commit. This tests
  // concurrent service requests, without claiming an observed database lock wait.
  let arrivals=0,release!:()=>void;const both=new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Both confirmations did not reach Calendar verification')),10_000);timer.unref();
   release=()=>{clearTimeout(timer);resolve();};
  });
  gate=async()=>{if(++arrivals===2)release();await both;};
  const outcomes=await Promise.allSettled(fixtures.map((f,index)=>setup.confirm(f.credential!,choices[index])));
  gate=async()=>{};
  assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(o=>o.status==='rejected').length,1);
  const winnerIndex=outcomes.findIndex(o=>o.status==='fulfilled'),loserIndex=1-winnerIndex;
  const winner=fixtures[winnerIndex],loser=fixtures[loserIndex],failure=outcomes[loserIndex];
  assert.ok(failure.status==='rejected'&&code('HANDLE_UNAVAILABLE')(failure.reason));
  const saved=await setup.read(winner.credential!);
  assert.equal(saved.confirmed.handle,handle);
  assert.deepEqual(await setup.read(loser.credential!),loser.state,'Failed confirmation must roll back draft, review, rules and revision together');
  assert.deepEqual(await setup.readiness(loser.credential!),{ready:false,reason:'setup'});
  assert.equal(await sql.query(`select count(*) from fmat.hosts where handle='${handle}';`),'1');
  assert.equal((await intake.profile(handle)).displayName,saved.confirmed.displayName);
  await assert.rejects(setup.confirm(loser.credential!,choices[loserIndex]),code('HANDLE_UNAVAILABLE'));
  assert.deepEqual(await setup.read(loser.credential!),loser.state);
  assert.deepEqual(await setup.confirm(winner.credential!,choices[winnerIndex]),saved,'Winner exact retry preserves its publication');

  const alternative=handle+'-other';
  const revised=await setup.draft(loser.credential!,{expectedRevision:loser.state!.revision,idempotencyKey:randomUUID(),patch:{handle:alternative},unresolved:[]});
  assert.ok(revised.review);await assert.rejects(intake.profile(alternative),code('NOT_FOUND'));
  await setup.confirm(loser.credential!,confirmation(revised));
  assert.deepEqual(await setup.readiness(loser.credential!),{ready:true,handle:alternative});
  assert.deepEqual(await setup.readiness(winner.credential!),{ready:true,handle});
  assert.equal((await intake.profile(alternative)).displayName,loser.state!.review!.settings.displayName);
  assert.deepEqual(await setup.read(winner.credential!),saved,'Loser recovery cannot change the published winner');
  for(const published of [handle,alternative]){
   const document=await skill(published);assert.equal(document.status,200);
   assert.ok((await document.text()).includes(`[Request a meeting with this host](https://release.findmeatime.com/${published})`));
  }
  writable=false;
  for(const f of fixtures)assert.deepEqual(await setup.readiness(f.credential!),{ready:false,reason:'calendar'});
  for(const published of [handle,alternative]){
   await assert.rejects(intake.profile(published),code('NOT_FOUND'));assert.equal((await skill(published)).status,404);
  }
  writable=true;assert.equal((await intake.profile(handle)).handle,handle);
 }finally{
  gate=async()=>{};
  for(const {host,invitation} of fixtures){
   await sql.query(`delete from fmat.idempotency where actor_scope='host:${host}';delete from fmat.audit_events where subject_id='${host}';delete from fmat.calendar_connections where principal_id='${host}';delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invitation}';`);
   assert.equal((await fetch(local.API_URL+'/auth/v1/admin/users/'+host,{method:'DELETE',headers})).status,200);
  }
  await sql.close();
 }
});
