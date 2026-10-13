import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {RequestLifecycle} from '../../lib/server/scheduling/lifecycle.ts';
import {Database} from '../../lib/server/database/client.ts';
import {verifyHostToken,guestCredential,type Credential} from '../../lib/server/identity/credentials.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {LocalSql} from './local-sql.ts';
const code=(value:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===value;
test('closure requires current explicit authority, replays minimally, and never closes a potentially booked request',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const env={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY};
 const headers={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'},sql=new LocalSql(),lock=new LocalSql();
 const db=new Database(env),service=new RequestLifecycle(db),hosts:{id:string;invitation:string;token:string;credential:Credential}[]=[];
 const makeInput=(requestId:string,revision=1)=>({requestId,revision,confirmed:true as const,idempotencyKey:randomUUID()});
 async function request(host:string){const id=randomUUID(),token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex');await sql.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at,private_notes) values('${id}','${host}','{"purpose":"PRIVATE PURPOSE","requesterEmail":"private@example.test"}','${hash}',now()+interval '1 day','PRIVATE NOTES');`);return {id,hash,guest:guestCredential(id,token)};}
 try{
  for(let n=0;n<2;n++){
   const email=randomUUID()+'@example.test',password=randomUUID()+randomUUID(),invitation=randomUUID();
   const create=await fetch(local.API_URL+'/auth/v1/admin/users',{method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(create.status,200);const id=(await create.json()).id;
   const login=await fetch(local.API_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:local.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);const token=(await login.json()).access_token,credential=await verifyHostToken(token,{env});hosts.push({id,invitation,token,credential});
   await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','${email}','${createHash('sha256').update(invitation).digest('hex')}',now()+interval '1 day','closure-test');insert into fmat.hosts(id,email,invitation_id) values('${id}','${email}','${invitation}');`);
  }
  const [a,b]=hosts,r=await request(a.id),input=makeInput(r.id);
  assert.deepEqual(await service.read(r.guest,{requestId:r.id}),{requestId:r.id,revision:1,status:'gathering',closed:false,canWithdraw:true,canDecline:false});
  assert.equal((await service.read(a.credential,{requestId:r.id})).canDecline,true,'No Calendar connection is required to close a request');
  await assert.rejects(service.read(b.credential,{requestId:r.id}),code('NOT_FOUND'));await assert.rejects(service.withdraw(a.credential,input),code('FORBIDDEN'));await assert.rejects(service.decline(r.guest,input),code('FORBIDDEN'));
  await assert.rejects(service.withdraw({...r.guest},input),code('UNAUTHORIZED'));await assert.rejects(service.withdraw(r.guest,{...input,confirmed:false}));await assert.rejects(service.withdraw(r.guest,{...input,actor:a.credential}));
  await assert.rejects(service.withdraw(r.guest,{...input,revision:2}),code('STALE_REVISION'));
  await sql.query(`insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential,guest_authority_key) values('guest','${r.id}','synthetic',array['https://www.googleapis.com/auth/calendar.events.freebusy'],'encrypted-fixture','${r.hash}');`);
  const results=await Promise.all(Array.from({length:8},()=>service.withdraw(r.guest,input)));for(const result of results)assert.deepEqual(result,{requestId:r.id,revision:2,status:'withdrawn',closed:true,canWithdraw:false,canDecline:false});
  assert.equal(await sql.query(`select count(*) from fmat.request_history where request_id='${r.id}' and operation='request_withdraw';`),'1');
  assert.equal(await sql.query(`select encrypted_credential is null and revoked_at is not null from fmat.calendar_connections where principal_id='${r.id}';`),'t');
  assert.equal((await service.read(r.guest,{requestId:r.id})).closed,true);await assert.rejects(service.withdraw(r.guest,{...input,revision:2}),code('IDEMPOTENCY_CONFLICT'));await assert.rejects(service.withdraw(r.guest,makeInput(r.id,2)),code('NOT_FOUND'));
  await assert.rejects(db.rpc('fmat_command',{p_operation:'requester_withdraw',p_actor:r.guest,p_input:input}),code('FORBIDDEN'));
  await assert.rejects(db.rpc('fmat_command',{p_operation:'mutation_replay',p_actor:r.guest,p_input:{operation:'requester_withdraw'}}),code('FORBIDDEN'));
  await sql.query(`update fmat.requests set token_hash=repeat('9',64) where id='${r.id}';`);await assert.rejects(service.withdraw(r.guest,input),code('NOT_FOUND'));
  const declined=await request(a.id),decline=makeInput(declined.id);assert.equal((await service.decline(a.credential,decline)).status,'declined');assert.equal((await service.decline(a.credential,decline)).revision,2);assert.equal((await service.read(declined.guest,{requestId:declined.id})).status,'declined');
  const race=await request(a.id);const racing=await Promise.allSettled([service.withdraw(race.guest,makeInput(race.id)),service.decline(a.credential,makeInput(race.id))]);assert.equal(racing.filter(x=>x.status==='fulfilled').length,1);assert.equal(await sql.query(`select count(*) from fmat.request_closures where request_id='${race.id}';`),'1');
  const booking=await request(a.id);await sql.query(`update fmat.requests set status='booking',expires_at=now()-interval '1 second' where id='${booking.id}';`);
  for(const operation of ['withdraw','decline'] as const)await assert.rejects(service[operation](operation==='withdraw'?booking.guest:a.credential,makeInput(booking.id)),code('RECONCILIATION_PENDING'));
  assert.deepEqual(await service.read(booking.guest,{requestId:booking.id}),{requestId:booking.id,revision:1,status:'booking',closed:false,canWithdraw:false,canDecline:false});
  // A saved provider attempt is authoritative even if an older request status
  // is inconsistent. Keep its event identity/reservation through every uncertain phase.
  const attempted=await request(a.id),connection=randomUUID(),approval=randomUUID(),attempt=randomUUID(),eventId=randomUUID().replaceAll('-','');
  await sql.query(`insert into fmat.calendar_connections(id,principal_kind,principal_id,provider_subject,scopes,encrypted_credential) values('${connection}','host','${a.id}','synthetic',array['https://www.googleapis.com/auth/calendar.events'],'encrypted-fixture');insert into fmat.proposals(request_id,version,details,rules_version) values('${attempted.id}',1,'{}',1);insert into fmat.host_approvals(id,request_id,proposal_version,host_id,source,approved_revision) values('${approval}','${attempted.id}',1,'${a.id}','authenticated_web',1);insert into fmat.booking_identities(request_id,event_id) values('${attempted.id}','${eventId}');insert into fmat.booking_attempts(id,request_id,host_id,proposal_version,approval_id,expected_revision,rules_version,connection_id,connection_provider_subject,calendar_id,event_id,payload,payload_fingerprint,starts_at,ends_at) values('${attempt}','${attempted.id}','${a.id}',1,'${approval}',1,1,'${connection}','synthetic','fixture','${eventId}','{}','fixture',now()+interval '1 day',now()+interval '1 day 30 minutes');insert into fmat.host_reservations(host_id,attempt_id) values('${a.id}','${attempt}');`);
  assert.equal((await service.read(attempted.guest,{requestId:attempted.id})).canWithdraw,true,'A saved undispatched attempt permits closure');
  for(const phase of ['dispatched','uncertain','conflict','confirmed']){await sql.query(`update fmat.booking_attempts set phase='${phase}' where id='${attempt}';`);assert.equal((await service.read(attempted.guest,{requestId:attempted.id})).status,'booking');await assert.rejects(service.withdraw(attempted.guest,makeInput(attempted.id)),code('RECONCILIATION_PENDING'));await assert.rejects(service.decline(a.credential,makeInput(attempted.id)),code('RECONCILIATION_PENDING'));}
  assert.equal(await sql.query(`select event_id from fmat.booking_attempts where id='${attempt}';`),eventId);assert.equal(await sql.query(`select count(*) from fmat.host_reservations where attempt_id='${attempt}';`),'1');
  const expired=await request(a.id);await sql.query(`update fmat.requests set expires_at=now()-interval '1 second' where id='${expired.id}';`);assert.equal((await service.read(expired.guest,{requestId:expired.id})).status,'expired');await assert.rejects(service.withdraw(expired.guest,makeInput(expired.id)),code('NOT_FOUND'));
  const locked=await request(a.id);await lock.query(`begin;update fmat.requests set status='booking' where id='${locked.id}';`);const waiting=assert.rejects(service.withdraw(locked.guest,makeInput(locked.id)),code('RECONCILIATION_PENDING'));await delay(100);await lock.query('commit;');await waiting;
  const expiresWaiting=await request(a.id);await sql.query(`update fmat.requests set token_expires_at=clock_timestamp()+interval '300 milliseconds' where id='${expiresWaiting.id}';`);await lock.query(`begin;select id from fmat.requests where id='${expiresWaiting.id}' for update;`);const expiry=assert.rejects(service.withdraw(expiresWaiting.guest,makeInput(expiresWaiting.id)),code('NOT_FOUND'));await delay(400);await lock.query('commit;');await expiry;
  const hostWaiting=await request(a.id);await sql.query(`update fmat.requests set token_expires_at=clock_timestamp()+interval '300 milliseconds' where id='${hostWaiting.id}';`);
  await lock.query(`begin;select id from fmat.hosts where id='${a.id}' for update;`);
  const hostExpiry=assert.rejects(service.withdraw(hostWaiting.guest,makeInput(hostWaiting.id)),code('NOT_FOUND'));await delay(400);await lock.query('commit;');await hostExpiry;
  assert.equal(await sql.query(`select status from fmat.requests where id='${hostWaiting.id}';`),'gathering');
  for(const token of [local.ANON_KEY,a.token]){const bypass=await fetch(local.API_URL+'/rest/v1/rpc/fmat_request_lifecycle',{method:'POST',headers:{apikey:local.ANON_KEY,authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({p_operation:'read',p_credential:a.credential,p_input:{requestId:declined.id}})});assert.ok([401,403].includes(bypass.status));}
  await sql.query(`update fmat.hosts set revoked_at=now() where id='${a.id}';`);await assert.rejects(service.decline(a.credential,decline),code('HOST_NOT_ADMITTED'));await sql.query(`update fmat.hosts set revoked_at=null where id='${a.id}';`);
  assert.equal((await fetch(local.API_URL+'/auth/v1/logout?scope=global',{method:'POST',headers:{apikey:local.ANON_KEY,authorization:'Bearer '+a.token}})).status,204);await assert.rejects(service.decline(a.credential,decline),code('UNAUTHORIZED'));
 }finally{
  await lock.query('rollback;').catch(()=>{});lock.close();
  for(const host of hosts){await sql.query(`set session_replication_role=replica;delete from fmat.request_closures where request_id in(select id from fmat.requests where host_id='${host.id}');delete from fmat.host_reservations where host_id='${host.id}';delete from fmat.booking_attempts where host_id='${host.id}';delete from fmat.host_approvals where host_id='${host.id}';delete from fmat.booking_identities where request_id in(select id from fmat.requests where host_id='${host.id}');delete from fmat.proposals where request_id in(select id from fmat.requests where host_id='${host.id}');delete from fmat.calendar_connections where principal_id='${host.id}';delete from fmat.calendar_connections where principal_id in(select id from fmat.requests where host_id='${host.id}');delete from fmat.request_history where request_id in(select id from fmat.requests where host_id='${host.id}');delete from fmat.audit_events where subject_id in(select id::text from fmat.requests where host_id='${host.id}');delete from fmat.requests where host_id='${host.id}';delete from fmat.hosts where id='${host.id}';delete from fmat.invitations where id='${host.invitation}';set session_replication_role=origin;`);assert.equal((await fetch(local.API_URL+'/auth/v1/admin/users/'+host.id,{method:'DELETE',headers})).status,200);}sql.close();
 }
});
