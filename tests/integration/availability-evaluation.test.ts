import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {AvailabilityEvaluation} from '../../lib/server/scheduling/availability.ts';
import {RequesterAvailability} from '../../lib/server/calendar/requester-availability.ts';
import {calendarScopes} from '../../lib/server/calendar/google.ts';
import {TokenCipher} from '../../lib/server/calendar/encryption.ts';
import {Database} from '../../lib/server/database/client.ts';
import {guestCredential,verifyHostToken,type Credential} from '../../lib/server/identity/credentials.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {LocalSql} from './local-sql.ts';
const code=(value:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===value;

test('Authorized availability joins both calendars, pauses failures, and fences edits, revocation, competing reads and current accounts',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const env={...process.env,APP_ORIGIN:'http://localhost:3000',SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
 const headers={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'};
 const sql=new LocalSql(),email=randomUUID()+'@example.test',password=randomUUID()+randomUUID(),invite=randomUUID(),requestId=randomUUID(),otherRequest=randomUUID(),token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex');
 const credential=guestCredential(requestId,token),database=new Database(env),cipher=new TokenCipher(env);let host='',hostCredential:Credential,authToken='';
 const day=new Date(Date.now()+2*86400000).toISOString().slice(0,10),at=(time:string)=>day+'T'+time+':00.000Z';
 const windows=[{start:at('10:00'),end:at('12:00')}],details={requesterName:'Fixture',requesterEmail:'requester@example.test',purpose:'Fixture',durationMinutes:30,timezone:'UTC',windows,mode:'online',location:''};
 const rules={timezone:'UTC',availability:[{days:[0,1,2,3,4,5,6],start:'00:00',end:'23:59'}],focusBlocks:[],bufferMinutes:10,durationMinutes:30,preferences:'Private host preference',travelMode:'NONE',meetingMode:'online',locationPolicy:'per_meeting',locations:[],travelBufferMinutes:0};
 const calls:{party:string;ids:string[];windows:unknown}[]=[];let failure:'host'|'guest'|null=null,refreshes=0,gate:()=>Promise<void>=async()=>{},gatedParty:'host'|'guest'='host';
 const service=new AvailabilityEvaluation(database,env,{async refresh(bundle){refreshes++;return {...bundle,expiresAt:Date.now()+3600000};},async list(){return [];}},{async read(access,ids,ranges){
  const party=access==='host-access'?'host':'guest';calls.push({party,ids,windows:ranges});if(party===gatedParty)await gate();if(failure===party)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  return party==='host'?[{start:at('10:00'),end:at('10:30')}]:[{start:at('11:00'),end:at('11:30')}];
 }});
 const manual=new RequesterAvailability(database,env);
 const revision=async()=>Number(await sql.query(`select revision from fmat.requests where id='${requestId}';`));
 const check=async(actor=credential)=>service.read(actor,{requestId,revision:await revision()});
 const flags=()=>sql.query(`select host_availability_failed||','||availability_failed from fmat.requests where id='${requestId}';`);
 const bundle=(kind:'host'|'guest')=>({accessToken:kind+'-access',refreshToken:kind+'-refresh',subject:'fixture-'+kind,expiresAt:1,scopes:[...calendarScopes[kind]]});
 let guestEncrypted='';
 const reconnect=async()=>{await sql.query(`update fmat.requests set availability_mode='calendar',revision=revision+1 where id='${requestId}';update fmat.calendar_connections set revoked_at=null,encrypted_credential='${guestEncrypted}',generation=gen_random_uuid(),selected_calendar_ids=array['guest-calendar'] where principal_id='${requestId}';`);};
 async function paused(mutate:()=>Promise<unknown>,expected='STALE_REVISION',actor=credential){
  let release!:()=>void,entered!:()=>void;const arrived=new Promise<void>(r=>entered=r),waiting=new Promise<void>(r=>release=r);gate=async()=>{entered();await waiting;};
  const pending=check(actor),rejected=assert.rejects(pending,code(expected));await arrived;
  try{await mutate();}finally{release();}await rejected;gate=async()=>{};
 }
 try{
  const create=await fetch(local.API_URL+'/auth/v1/admin/users',{method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(create.status,200);host=(await create.json()).id;
  const login=await fetch(local.API_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:local.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);authToken=(await login.json()).access_token;hostCredential=await verifyHostToken(authToken,{env});
  guestEncrypted=cipher.seal(bundle('guest'),'google:guest:'+requestId);const hostEncrypted=cipher.seal(bundle('host'),'google:host:'+host);
  await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invite}','${email}','${createHash('sha256').update(invite).digest('hex')}',now()+interval '1 day','availability-evaluation-test');insert into fmat.hosts(id,email,invitation_id,handle,display_name,rules,rules_version,conflict_calendar_ids,booking_calendar_id) values('${host}','${email}','${invite}','eval-${host.slice(0,8)}','Fixture','${JSON.stringify(rules)}',1,array['host-calendar'],'booking');insert into fmat.requests(id,host_id,details,token_hash,expires_at,availability_mode) values('${requestId}','${host}','${JSON.stringify(details)}','${hash}',now()+interval '3 days','calendar');insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential,guest_authority_key,selected_calendar_ids) values('host','${host}','fixture-host',array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],'${hostEncrypted}',null,'{}'),('guest','${requestId}','fixture-guest',array['https://www.googleapis.com/auth/calendar.events.freebusy','https://www.googleapis.com/auth/calendar.calendarlist.readonly'],'${guestEncrypted}','${hash}',array['guest-calendar']);`);
  assert.equal(await sql.query(`select has_function_privilege('anon','public.fmat_availability_evaluation(text,jsonb,jsonb)','EXECUTE')||','||has_function_privilege('authenticated','public.fmat_availability_evaluation(text,jsonb,jsonb)','EXECUTE')||','||has_function_privilege('service_role','public.fmat_availability_evaluation(text,jsonb,jsonb)','EXECUTE');`),'false,false,true');
  const evaluated=await check();assert.equal(refreshes,2);assert.equal(evaluated.evaluation.status,'ready');assert.deepEqual(evaluated.evaluation.windows,[{start:day+'T11:30:00Z',end:day+'T12:00:00Z'}]);
  assert.deepEqual(calls[0],{party:'host',ids:['host-calendar'],windows:[{start:at('09:50'),end:at('12:10')}]});assert.deepEqual(calls[1],{party:'guest',ids:['guest-calendar'],windows});
  const receipt=await service.check(hostCredential,{requestId,revision:1});assert.deepEqual(Object.keys(receipt).sort(),['checked','checkedAt','complete','revision']);assert.equal(receipt.complete,false);assert.ok(!JSON.stringify(receipt).includes('calendar'));
  const before=calls.length;await assert.rejects(service.check(guestCredential(randomUUID(),token),{requestId,revision:1}),code('NOT_FOUND'));await assert.rejects(service.check(guestCredential(requestId,randomBytes(32).toString('base64url')),{requestId,revision:1}),code('NOT_FOUND'));await assert.rejects(service.check({...credential} as Credential,{requestId,revision:1}),code('UNAUTHORIZED'));assert.equal(calls.length,before);
  failure='guest';await assert.rejects(check(),code('PROVIDER_UNAVAILABLE'));assert.equal(await flags(),'false,true');assert.equal(await revision(),2);assert.equal(await sql.query(`select candidates='[]' and current_proposal_version is null and evaluated_at is null from fmat.requests where id='${requestId}';`),'t');
  await manual.manual(credential,{revision:await revision(),confirmed:true,timezone:'UTC',windows});const readCount=calls.length;
  failure=null;await check();assert.equal(await flags(),'false,false');assert.equal(calls.length,readCount+1,'Explicit manual replacement reads only the host Calendar');await reconnect();
  failure='host';await assert.rejects(check(),code('PROVIDER_UNAVAILABLE'));assert.equal(await flags(),'true,false');
  await manual.manual(credential,{revision:await revision(),confirmed:true,timezone:'UTC',windows});assert.equal(await flags(),'true,false','Manual requester replacement cannot clear a host failure');
  await assert.rejects(database.rpc('fmat_command',{p_operation:'candidates_save',p_actor:{kind:'worker',id:'test'},p_input:{requestId,expectedRevision:await revision(),rulesVersion:1,candidates:[]}}),code('RECONNECT_REQUIRED'));
  failure=null;const manualResult=await check();assert.equal(await flags(),'false,false');assert.deepEqual(manualResult.evaluation.windows,[{start:day+'T10:40:00Z',end:day+'T12:00:00Z'}]);
  await reconnect();
  await paused(()=>sql.query(`update fmat.requests set revision=revision+1,details=jsonb_set(details,'{purpose}','"Changed"') where id='${requestId}';`));
  await paused(()=>sql.query(`update fmat.hosts set rules_version=rules_version+1 where id='${host}';`));
  await paused(()=>sql.query(`update fmat.hosts set conflict_calendar_ids=array['changed-calendar'] where id='${host}';`));
  await sql.query(`update fmat.hosts set conflict_calendar_ids=array['host-calendar'] where id='${host}';`);
  await paused(()=>sql.query(`update fmat.calendar_connections set generation=gen_random_uuid() where principal_id='${host}';`));
  gatedParty='guest';await paused(()=>sql.query(`update fmat.calendar_connections set generation=gen_random_uuid() where principal_id='${requestId}';`));
  await paused(async()=>manual.manual(credential,{revision:await revision(),confirmed:true,timezone:'UTC',windows}));
  await reconnect();gatedParty='host';
  await paused(async()=>database.rpc('fmat_availability_evaluation',{p_operation:'start',p_credential:credential,p_input:{requestId,revision:await revision(),checkId:randomUUID()}}));
  await paused(()=>sql.query(`update fmat.requests set availability_check_started_at=now()-interval '6 minutes' where id='${requestId}';`));
  await paused(()=>sql.query(`update fmat.calendar_connections set revoked_at=now(),encrypted_credential=null where principal_id='${requestId}';`),'RECONNECT_REQUIRED');await reconnect();
  await paused(()=>sql.query(`update auth.users set banned_until=now()+interval '1 day' where id='${host}';`),'NOT_FOUND');await sql.query(`update auth.users set banned_until=null where id='${host}';`);
  // A local confirmed write is included before Google catches up, and its
  // appearance during the provider read invalidates the frozen snapshot.
  const approval=randomUUID();
  await paused(()=>sql.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values('${otherRequest}','${host}','${JSON.stringify(details)}','${createHash('sha256').update(otherRequest).digest('hex')}',now()+interval '3 days');insert into fmat.proposals(request_id,version,details,rules_version) values('${otherRequest}',1,'{}',1);insert into fmat.host_approvals(id,request_id,proposal_version,host_id,source,approved_revision) values('${approval}','${otherRequest}',1,'${host}','authenticated_web',1);insert into fmat.booking_identities(request_id,event_id) values('${otherRequest}','fmat123');insert into fmat.booking_attempts(request_id,host_id,proposal_version,approval_id,expected_revision,rules_version,connection_id,connection_provider_subject,calendar_id,event_id,payload,payload_fingerprint,starts_at,ends_at,phase) select '${otherRequest}','${host}',1,'${approval}',1,1,id,'fixture-host','booking','fmat123','{}','fixture','${at('11:25')}','${at('12:00')}','confirmed' from fmat.calendar_connections where principal_id='${host}';`));
  const blocked=await check();assert.deepEqual(blocked.evaluation.windows,[]);
  // Observe a real booking-preparation lock wait. Evaluation can finish in
  // the host-lock owner's transaction because booking no longer grabs the
  // Calendar row first and creates a host/connection deadlock cycle.
  const locker=new LocalSql(),waiter=new LocalSql(),lockName='availability-lock-'+host.slice(0,8);
  let bookingWait:Promise<string>|undefined;
  try{
   await locker.query(`begin;select id from fmat.hosts where id='${host}' for update;`);
   bookingWait=waiter.query(`set application_name='${lockName}';do $$ begin perform fmat.prepare_booking((select r from fmat.requests r where id='${otherRequest}'),'${approval}');exception when no_data_found then null;end $$;select 'released';`);
   // Attach immediately: a lock/deadlock failure must never be unhandled.
   const observedWait=bookingWait.then(value=>({value}),error=>({error}));
   let observed=false;
   for(let i=0;i<50;i++){if(await sql.query(`select exists(select 1 from pg_stat_activity where application_name='${lockName}' and wait_event_type='Lock');`)==='t'){observed=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
   assert.ok(observed,'Booking actually waits on the host row');
   const input={requestId,revision:await revision(),checkId:randomUUID()};
   assert.equal(await locker.query(`select public.fmat_availability_evaluation('start','${JSON.stringify(credential)}','${JSON.stringify(input)}')->>'revision';`),String(input.revision));
   await locker.query('commit;');const result=await observedWait;assert.ok('value' in result);assert.equal(result.value,'released');
  }finally{await locker.query('rollback;').catch(()=>{});await bookingWait?.catch(()=>{});locker.close();waiter.close();}
  await paused(async()=>{const logout=await fetch(local.API_URL+'/auth/v1/logout?scope=global',{method:'POST',headers:{apikey:local.ANON_KEY,authorization:'Bearer '+authToken}});assert.equal(logout.status,204);},'UNAUTHORIZED',hostCredential);
  await check(); // A request-bound guest does not depend on the host browser session.
  await sql.query(`update fmat.requests set token_revoked_at=now() where id='${requestId}';`);await assert.rejects(check(),code('NOT_FOUND'));
 }finally{
  if(host){await sql.query(`set session_replication_role=replica;delete from fmat.booking_attempts where host_id='${host}';delete from fmat.host_approvals where host_id='${host}';delete from fmat.booking_identities where request_id='${otherRequest}';delete from fmat.proposals where request_id='${otherRequest}';delete from fmat.audit_events where subject_id in('${requestId}','${otherRequest}');delete from fmat.calendar_connections where principal_id in('${host}','${requestId}');delete from fmat.request_history where request_id in('${requestId}','${otherRequest}');delete from fmat.requests where host_id='${host}';delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invite}';set session_replication_role=origin;`);const removed=await fetch(local.API_URL+'/auth/v1/admin/users/'+host,{method:'DELETE',headers});assert.equal(removed.status,200);}sql.close();
 }
});
