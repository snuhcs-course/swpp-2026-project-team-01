import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {TokenCipher} from '../../lib/server/calendar/encryption.ts';

const local='supabase_db_swpp-2026-project-team-01';
const image='public.ecr.aws/supabase/postgres:17.11.0.003';
const literal=(value:unknown)=>"'"+String(value).replaceAll("'","''")+"'";
const json=(value:unknown)=>literal(JSON.stringify(value))+'::jsonb';
function dockerFailure(operation:string,stderr:string,env:NodeJS.ProcessEnv=process.env){
 // Daemon startup errors contain no SQL input; other operations keep only the
 // existing PostgreSQL error line. Never echo commands, dumps or inherited values.
 let detail=(operation==='run'?stderr.split('\n').find(line=>/^(?:docker:|Error response from daemon:)/u.test(line)):stderr.match(/ERROR:  [^\n]+/u)?.[0])??'inspect the isolated target';
 for(const value of Object.entries(env).filter(([key,value])=>Boolean(value&&(value.length>=8||/secret|token|password|key/iu.test(key)))).map(([,value])=>value!).sort((a,b)=>b.length-a.length))detail=detail.split(value).join('[environment value]');
 detail=detail.replace(/https?:\/\/[^\s]+/gu,value=>{try{return new URL(value).origin.replace(/\/\/[^/@]+@/u,'//')+'/[redacted]';}catch{return '[redacted URL]';}});
 return detail.replace(/[\u0000-\u001f\u007f]/gu,' ').slice(0,600);
}

test('restore startup diagnostics preserve the cause without inherited values or SQL dumps',()=>{
 const secret='synthetic-private-registry-token';
 assert.equal(dockerFailure('run',`docker: Error response from daemon: denied ${secret}`,{TOKEN:secret}),'docker: Error response from daemon: denied [environment value]');
 assert.equal(dockerFailure('run','docker: registry https://user:password@example.test/path?token=private',{}),'docker: registry https://example.test/[redacted]');
 assert.equal(dockerFailure('exec','private dump contents and SQL input',{}),'inspect the isolated target');
 assert.equal(dockerFailure('run','docker: no space left on device',{}),'docker: no space left on device');
 assert.equal(dockerFailure('run','docker: denied short',{PASSWORD:'short'}),'docker: denied [environment value]');
});
function docker(args:string[],input?:string){
 const result=spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:32*1024*1024,timeout:60000});
 // Never print a dump, SQL input, or inherited credentials on failure.
 assert.equal(result.status,0,`Docker ${args[0]} failed (${result.error?.name??'nonzero exit'}): ${dockerFailure(args[0],result.stderr??'')}`);
 return result.stdout;
}
const query=(name:string,sql:string)=>docker(['exec','-i',name,'psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],sql).trim();
const rpc=(name:string,op:string,actor:unknown,input:unknown)=>JSON.parse(query(name,`select public.fmat_command(${literal(op)},${json(actor)},${json(input)});`));
const dump=(name:string,args:string[])=>docker(['exec',name,'pg_dump','-U','supabase_admin','-d','postgres',...args]);

test('isolated restore preserves populated booking uncertainty, delivery identity, conversations and revocation',async()=>{
 const source=JSON.parse(docker(['inspect',local]))[0];
 assert.equal(source.Config.Labels['com.supabase.cli.project'],'swpp-2026-project-team-01');
 assert.equal(source.State.Running,true);
 assert.equal(source.Config.Image,image,'restore uses the selected pinned PostgreSQL version');
 assert.match(source.Image,/^sha256:[a-f0-9]{64}$/u);
 const localImage=source.Image as string;
 // Only schema leaves the existing local stack. No existing local rows or remote target are read.
 const schema=dump(local,['--schema-only','--schema=auth','--schema=storage','--schema=fmat','--schema=public']);
 const run=randomUUID(),created:string[]=[];
 const origin='fmat-recovery-source-'+run,destination='fmat-recovery-target-'+run;
 const initialize=async(name:string)=>{
  docker(['run','--pull=never','-d','--name',name,'--network','none','--label','fmat.restore-test='+run,
   '--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid,size=512m',
   '-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_USER=supabase_admin','-e','POSTGRES_HOST=/var/run/postgresql',
   localImage,'postgres','-D','/etc/postgresql','-c','cron.launch_active_jobs=off','-c','listen_addresses=localhost']);
  created.push(name);
  const deadline=Date.now()+45000;
  while(true){
   const info=JSON.parse(docker(['inspect',name]))[0];assert.equal(info.State.Running,true,'initialization container must stay live');
   // Wait for the final server, not the entrypoint's temporary initialization server.
   const log=docker(['logs',name]);
   if(log.includes('PostgreSQL init process complete; ready for start up.')){
    const ready=spawnSync('docker',['exec',name,'pg_isready','-U','supabase_admin'],{stdio:'ignore'});
    if(ready.status===0)break;
   }
   assert.ok(Date.now()<deadline,'database initialization deadline');await delay(250);
  }
  const info=JSON.parse(docker(['inspect',name]))[0];
  assert.equal(info.HostConfig.NetworkMode,'none');assert.deepEqual(info.HostConfig.PortBindings,{});
  assert.ok(info.HostConfig.Tmpfs['/var/lib/postgresql/data']);
  assert.equal(query(name,"select current_setting('cron.launch_active_jobs');"),'off');
  query(name,`BEGIN; CREATE ROLE supabase_realtime_admin NOLOGIN NOINHERIT; CREATE ROLE supabase_functions_admin NOLOGIN NOINHERIT;
   DROP SCHEMA auth CASCADE; DROP SCHEMA storage CASCADE; DROP SCHEMA public CASCADE;
   SET ROLE postgres; CREATE EXTENSION IF NOT EXISTS pgmq; CREATE EXTENSION IF NOT EXISTS pg_cron; CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions; RESET ROLE;
   ${schema}
   SET ROLE postgres; SELECT pgmq.create('fmat_jobs'); RESET ROLE; COMMIT;`);
  assert.equal(query(name,'select count(*) from cron.job;'),'0');
 };
 try{
  await initialize(origin);
  const hostId=randomUUID(),inviteId=randomUUID(),connectionId=randomUUID(),sessionId=randomUUID();
  const key=randomBytes(32).toString('base64'),cipher=new TokenCipher({TOKEN_ENCRYPTION_KEY:key});
  const credential={accessToken:'synthetic-access',refreshToken:'synthetic-refresh'},context='google:host:'+hostId;
  const sealed=cipher.seal(credential,context);
  query(origin,`BEGIN;
   INSERT INTO auth.users(id,email,email_confirmed_at) VALUES (${literal(hostId)},'restore@example.test',now());
   INSERT INTO auth.sessions(id,user_id) VALUES (${literal(sessionId)},${literal(hostId)});
   INSERT INTO fmat.invitations(id,email,token_hash,expires_at,issued_by,redeemed_by,redeemed_at)
    VALUES (${literal(inviteId)},'restore@example.test',repeat('a',64),now()+interval '1 day','restore-test',${literal(hostId)},now());
   INSERT INTO fmat.hosts(id,email,invitation_id,handle,display_name,rules,rules_version,conflict_calendar_ids,booking_calendar_id)
    VALUES (${literal(hostId)},'restore@example.test',${literal(inviteId)},'restore-host','Restore host',
    '{"timezone":"UTC","durationMinutes":30,"availability":[{"days":[0,1,2,3,4,5,6],"start":"00:00","end":"23:59"}],"focusBlocks":[],"bufferMinutes":0,"travelMode":"NONE","preferences":""}',1,ARRAY['conflict'],'booking-calendar');
   INSERT INTO fmat.calendar_connections(id,principal_kind,principal_id,provider_subject,scopes,encrypted_credential)
    VALUES (${literal(connectionId)},'host',${literal(hostId)},'synthetic-google-host',ARRAY['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],${literal(sealed)});
   COMMIT;`);
  const host={kind:'host',id:hostId,email:'restore@example.test',confirmationSource:'authenticated_web'},worker={kind:'worker',id:'restore-worker'};
  const operator={kind:'operator',id:'restore-test'};
  const createRequest=(day:number)=>{
   const id=randomUUID(),tokenHash=createHash('sha256').update(id).digest('hex');
   const start=new Date(Date.now()+day*86400000).toISOString(),end=new Date(Date.parse(start)+1800000).toISOString();
   const details={requesterName:'Restore requester',requesterEmail:'requester@example.test',purpose:'Synthetic restoration',durationMinutes:30,timezone:'UTC',windows:[{start,end:new Date(Date.parse(start)+10800000).toISOString()}],mode:'online',location:'https://meet.example.test/restore'};
   const proposal={...details,version:1,start,end};
   query(origin,`BEGIN; INSERT INTO fmat.requests(id,host_id,revision,status,details,token_hash,contact_verified_email,current_proposal_version,requester_agreed_version,expires_at)
    VALUES (${literal(id)},${literal(hostId)},5,'awaiting_approval',${json(details)},${literal(tokenHash)},'requester@example.test',1,1,now()+interval '7 days');
    INSERT INTO fmat.proposals(request_id,version,details,rules_version) VALUES (${literal(id)},1,${json(proposal)},1); COMMIT;`);
   return {id,tokenHash};
  };
  const book=(requestId:string,outcome:'confirmed'|'uncertain')=>{
   rpc(origin,'host_approve',host,{requestId,expectedRevision:5,proposalVersion:1,confirmed:true,idempotencyKey:randomUUID()});
   const claimed=rpc(origin,'jobs_claim',worker,{workerId:worker.id,limit:20});
   const job=claimed.jobs.find((j:{kind:string;payload:{requestId:string}})=>j.kind==='booking'&&j.payload.requestId===requestId);assert.ok(job);
   const fence={jobId:job.id,leaseToken:job.leaseToken};
   const saved=rpc(origin,'booking_load',worker,{requestId,...fence});
   const dispatch={...fence,attemptId:saved.attemptId,expectedRevision:saved.expectedRevision,rulesVersion:saved.rulesVersion,connectionId:saved.connectionId,connectionUpdatedAt:query(origin,`select updated_at from fmat.calendar_connections where id=${literal(connectionId)};`),providerSubject:saved.connectionProviderSubject,feasibility:{valid:true,checkedAt:new Date().toISOString()}};
   assert.equal(rpc(origin,'booking_dispatch',worker,dispatch).dispatched,true);
   rpc(origin,'booking_record_outcome',worker,{...fence,attemptId:saved.attemptId,outcome,...(outcome==='confirmed'?{evidence:{calendarId:saved.calendarId,eventId:saved.eventId,eventUrl:'https://www.google.com/calendar/event?eid=synthetic-restore',payloadFingerprint:saved.payloadFingerprint}}:{reason:'synthetic_lost_response'})});
   return {saved,fence,dispatch};
  };
  const confirmed=createRequest(2);book(confirmed.id,'confirmed');
  const unresolved=createRequest(3),uncertain=book(unresolved.id,'uncertain');
  const active=createRequest(4),guest={kind:'guest',requestId:active.id,tokenHash:active.tokenHash};
  const access=JSON.parse(query(origin,`select public.fmat_conversation_access('open',${json(guest)},${json({requestId:active.id,audience:'request_shared'})});`));
  const clientMessageId=randomUUID(),message={clientId:clientMessageId,text:'Preserve this pending synthetic message'};
  const acceptSql=`select public.fmat_runtime_message('accept',${literal(access.grantId)},${literal(access.conversationId)},${json(message)});`;
  const accepted=JSON.parse(query(origin,acceptSql));
  const hostCredential={kind:'host',subject:hostId,sessionId,expiresAt:new Date(Date.now()+3600000).toISOString()};
  const expiredAccess=JSON.parse(query(origin,`select public.fmat_conversation_access('open',${json(hostCredential)},'{"audience":"host_setup"}');`));
  query(origin,`update auth.sessions set not_after=now()-interval '1 second' where id=${literal(sessionId)};`);
  const deliveryId=randomUUID();
  query(origin,`insert into fmat.outbox(id,dedupe_key,audience,recipient,payload,status,provider_reference)
   values (${literal(deliveryId)},'restore-uncertain','requester','{"email":"requester@example.test"}',jsonb_build_object('type','synthetic','firstDispatchAt',now()-interval '25 hours','encryptedPrepared',repeat('synthetic',4),'providerInboxId','synthetic-inbox'),'uncertain','synthetic-stable-provider-reference');`);
  const deliveryJob=query(origin,`select fmat.enqueue_job('delivery','restore-uncertain-delivery',${json({outboxId:deliveryId})});`),deliveryLease=randomUUID();
  query(origin,`update fmat.jobs set status='running',worker_id='restore-worker',lease_token=${literal(deliveryLease)},lease_until=now()+interval '5 minutes' where id=${literal(deliveryJob)};`);
  // Issue and revoke a real requester delegation, retaining its consumed code and refresh family.
  const resource='https://release.findmeatime.com/mcp',redirect='https://client.example.test/cb',verifier='A'.repeat(43),codeHash='b'.repeat(64),refreshHash='c'.repeat(64),browserHash='d'.repeat(64);
  const client=JSON.parse(query(origin,`select public.fmat_oauth_register('Restore test',ARRAY[${literal(redirect)}],${literal(resource)});`));
  const auth=JSON.parse(query(origin,`select public.fmat_oauth_authorization_start(${json({clientId:client.clientId,resource,redirectUri:redirect,scope:'request:read request:write',codeChallenge:createHash('sha256').update(verifier).digest('base64url'),codeChallengeMethod:'S256',state:'restore',browserHash})});`));
  assert.equal(JSON.parse(query(origin,`select public.fmat_oauth_consent(${literal(auth.authorizationId)},${literal(browserHash)},${json(guest)},'grant',${literal(codeHash)});`)).decision,'grant');
  const exchangeSql=`select public.fmat_oauth_code_exchange(${literal(client.clientId)},${literal(resource)},${literal(codeHash)},${literal(redirect)},${literal(verifier)},${literal(refreshHash)});`;
  const grant=JSON.parse(query(origin,exchangeSql));assert.equal(grant.actorKind,'guest');
  assert.equal(JSON.parse(query(origin,`select public.fmat_oauth_grant_revoke(${literal(grant.grantId)},${json(guest)});`)).revoked,true);
  const tables=JSON.parse(query(origin,"select json_agg(format('%I.%I',schemaname,tablename) order by schemaname,tablename) from pg_tables where schemaname='fmat' or (schemaname='auth' and tablename in ('users','sessions')) or (schemaname='pgmq' and tablename in ('q_fmat_jobs','a_fmat_jobs'));")) as string[];
  const snapshot=(target:string)=>{
   const rows=JSON.parse(query(target,`select jsonb_agg(rows order by position) from (${tables.map((table,index)=>`select ${index} as position,coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') as rows from ${table} t`).join(' UNION ALL ')}) contents;`)) as unknown[];
   return rows.map(value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'));
  };
  const before=snapshot(origin);
  // pgmq's extension-owned queue data is omitted by raw pg_dump here. Export
  // exact COPY columns and the next-message sequence explicitly; don't detach
  // tables from the extension or silently accept an empty recovered queue.
  const queues=['pgmq.q_fmat_jobs','pgmq.a_fmat_jobs'].map(table=>{
   const columns=query(origin,`select string_agg(quote_ident(attname),',' order by attnum) from pg_attribute where attrelid=${literal(table)}::regclass and attnum>0 and not attisdropped;`);
   const rows=docker(['exec','-i',origin,'psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],`COPY ${table} (${columns}) TO STDOUT;`);
   return `COPY ${table} (${columns}) FROM stdin;\n${rows}\\.\n`;
  }).join('\n');
  const sequence=JSON.parse(query(origin,"select json_build_object('value',last_value,'called',is_called) from pgmq.q_fmat_jobs_msg_id_seq;"));
  assert.ok(Number.isSafeInteger(sequence.value));assert.equal(typeof sequence.called,'boolean');
  const data=dump(origin,['--data-only','--schema=fmat','--schema=auth'])+'\n'+queues+
   `SELECT pg_catalog.setval('pgmq.q_fmat_jobs_msg_id_seq',${sequence.value},${sequence.called});\n`;
  await initialize(destination);
  query(destination,`BEGIN; SET session_replication_role=replica; ${data}\nSET session_replication_role=origin; COMMIT;`);
  const after=snapshot(destination);
  tables.forEach((table,index)=>assert.equal(after[index],before[index],'restored contents: '+table));
  const restoredCipher=query(destination,`select encrypted_credential from fmat.calendar_connections where id=${literal(connectionId)};`);
  assert.deepEqual(cipher.open(restoredCipher,context),credential);
  assert.throws(()=>new TokenCipher({TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')}).open(restoredCipher,context));
  assert.throws(()=>cipher.open(restoredCipher,'google:host:'+randomUUID()));
  assert.equal(query(destination,`select status from fmat.requests where id=${literal(confirmed.id)};`),'booked');
  assert.equal(query(destination,`select phase from fmat.booking_attempts where id=${literal(uncertain.saved.attemptId)};`),'uncertain');
  assert.equal(query(destination,`select count(*) from fmat.host_reservations where attempt_id=${literal(uncertain.saved.attemptId)};`),'1');
  assert.equal(query(destination,`select fmat.withdraw_allowed(${literal(unresolved.id)});`),'f');
  assert.throws(()=>rpc(destination,'booking_retry',operator,{requestId:unresolved.id,idempotencyKey:randomUUID()}),/BOOKING_UNCERTAIN/u);
  assert.equal(rpc(destination,'booking_dispatch',worker,uncertain.dispatch).dispatched,false,'restore cannot authorize a second insert');
  const stable=rpc(destination,'booking_load',worker,{requestId:unresolved.id,...uncertain.fence});
  assert.equal(stable.eventId,uncertain.saved.eventId);assert.equal(stable.payloadFingerprint,uncertain.saved.payloadFingerprint);
  assert.throws(()=>query(destination,`update fmat.booking_attempts set event_id='replacement' where id=${literal(stable.attemptId)};`),/BOOKING_SNAPSHOT_IMMUTABLE/u);
  assert.equal(query(destination,`select status||':'||provider_reference from fmat.outbox where id=${literal(deliveryId)};`),'uncertain:synthetic-stable-provider-reference');
  assert.throws(()=>rpc(destination,'delivery_dispatch',worker,{jobId:deliveryJob,leaseToken:deliveryLease,outboxId:deliveryId}),/DELIVERY_RECONCILIATION_REQUIRED/u);
  assert.equal(query(destination,`select status from fmat.outbox where id=${literal(deliveryId)};`),'uncertain');
  assert.deepEqual(JSON.parse(query(destination,acceptSql)),accepted,'same accepted runtime input reuses its restored identity');
  assert.equal(query(destination,`select count(*) from fmat.runtime_messages where client_id=${literal(clientMessageId)};`),'1');
  assert.throws(()=>query(destination,`select public.fmat_conversation_check(${literal(expiredAccess.grantId)},${literal(expiredAccess.conversationId)});`),/UNAUTHORIZED/u);
  assert.equal(JSON.parse(query(destination,exchangeSql)).error,'invalid_grant','consumed code cannot issue again');
  assert.equal(JSON.parse(query(destination,`select public.fmat_oauth_refresh(${literal(client.clientId)},${literal(resource)},${literal(refreshHash)},${literal('e'.repeat(64))},null);`)).error,'invalid_grant');
  assert.equal(JSON.parse(query(destination,`select public.fmat_oauth_grant_check(${literal(grant.grantId)},${literal(client.clientId)},${literal(resource)},'guest',${literal(active.id)},'request:read');`)).error,'invalid_grant');
  assert.equal(query(destination,"select has_schema_privilege('anon','fmat','USAGE') or has_schema_privilege('authenticated','fmat','USAGE');"),'f');
  assert.equal(query(destination,'select count(*) from cron.job;'),'0');
  const laterId=query(destination,"select fmat.enqueue_job('restore_probe','restore-sequence-probe','{}');");
  assert.ok(Number(query(destination,`select message_id from fmat.queue_publications where job_id=${literal(laterId)};`))>sequence.value,'restored sequence permits a new unique queue publication');
  console.log(JSON.stringify({restoredTables:tables.length,confirmedBooking:true,uncertainBookingHeld:true,stableProviderIdentity:true,uncertainDeliveryFenced:true,pendingConversationReplay:true,revokedOAuthDenied:true,expiredSessionDenied:true,credentialKeyRequired:true,network:'none',providerCalls:0}));
 }finally{
  const cleanupErrors:unknown[]=[];
  for(const name of created.reverse()){
   try{
    const info=JSON.parse(docker(['inspect',name]))[0];assert.equal(info.Config.Labels['fmat.restore-test'],run);
    docker(['rm','-f','-v',name]);
    assert.equal(docker(['ps','-a','--filter','name='+name,'--format','{{.Names}}']).trim(),'');
   }catch(error){cleanupErrors.push(error);}
  }
  if(cleanupErrors.length)throw new AggregateError(cleanupErrors,'Isolated restore fixture cleanup failed');
 }
});
