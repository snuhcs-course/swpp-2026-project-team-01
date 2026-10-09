import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes,createHash,createHmac} from 'node:crypto';
import {mkdir,mkdtemp,writeFile,readFile,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {dispatchPhotonReplies} from '../../lib/server/photon/replies.ts';
import {setTimeout as delay} from 'node:timers/promises';
import {Database} from '../../lib/server/database/client.ts';
import {verifyHostToken} from '../../lib/server/identity/credentials.ts';
import {Conversations} from '../../lib/server/identity/conversations.ts';
import {HostIMessage} from '../../lib/server/photon/linking.ts';
import {dispatchLinkCodes} from '../../lib/server/photon/delivery.ts';
import {dispatchPhotonInputs} from '../../lib/server/photon/execution.ts';
import {photonWebhook} from '../../lib/server/photon/webhook.ts';
import {browserProof} from '../../lib/server/photon/proof.ts';
import {LocalSql} from './local-sql.ts';
import {startBrowserRuntime} from '../runtime/fixture-server.ts';
import {describedPreferences,describedReply} from '../runtime/setup-preferences.ts';
import {InvitationOperator} from '../../lib/server/identity/invitation-operator.ts';
import {BrowserCommands} from '../../lib/server/identity/browser-commands.ts';
import {HostSetup} from '../../lib/server/setup/commands.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {verifySetupIsolation} from './setup-host-isolation.ts';
import {verifySharedSetupReview} from './setup-channel-review.ts';

test('signed linked input executes once in the real eve setup session and loses authority after unlink',{timeout:180_000},async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const project=randomUUID(),receiver=randomUUID(),secret=randomBytes(32).toString('hex'),dispatchSecret=randomBytes(32).toString('hex');
 const env={APP_ORIGIN:'http://localhost:3000',INVITATION_CODE_KEY:randomBytes(32).toString('base64'),SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),PHOTON_PROJECT_ID:project,PHOTON_WEBHOOK_ID:receiver,IMESSAGE_WEBHOOK_SECRET:secret};
 const sql=new LocalSql(),holder=new LocalSql(),db=new Database(env),conversations=new Conversations(db);
 const headers={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'};
 const email=randomUUID()+'@example.test',password=randomUUID()+randomUUID(),operator='setup-'+randomUUID(),phone='+155501'+String(Math.floor(Math.random()*9000)+1000),browser=browserProof();
 let host='',invitation:string=randomUUID(),runtime:Awaited<ReturnType<typeof startBrowserRuntime>>|undefined;
 const service=new HostIMessage(db,env,{async prepare(number){return {line:'shared',spaceId:'any;-;'+number};}});
 const providerInputs=new Map<string,string>();
 function request(key:string,text=describedPreferences,sender=phone){
  const timestamp=String(Math.floor(Date.now()/1000)),space={id:'any;-;'+sender,platform:'imessage',type:'dm',phone:'shared'};
  let body=providerInputs.get(key);
  if(!body){body=JSON.stringify({event:'messages',space,message:{id:key,platform:'imessage',direction:'inbound',timestamp:new Date().toISOString(),sender:{id:sender,platform:'imessage'},space,content:{type:'text',text}}});providerInputs.set(key,body);}
  return new Request('https://fixture.invalid/api/providers/photon',{method:'POST',body,headers:{'content-type':'application/json','x-spectrum-webhook-id':receiver,'x-spectrum-timestamp':timestamp,'x-spectrum-signature':'v0='+createHmac('sha256',secret).update(`v0:${timestamp}:${body}`).digest('hex')}});
 }
 async function settled(scope:string){for(let n=0;n<200;n++){if(await sql.query(`select not exists(select 1 from fmat.runtime_messages where conversation_id='${scope}' and status='pending');`)==='t')return;await delay(50);}assert.fail('runtime turn did not settle');}
 try{
  const created=await fetch(local.API_URL+'/auth/v1/admin/users',{method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(created.status,200);host=(await created.json()).id;
  const login=await fetch(local.API_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:local.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);const token=(await login.json()).access_token;
  const credential=await verifyHostToken(token,{env});
  const browserCommands=new BrowserCommands(db),invitations=new InvitationOperator(db,env);
  assert.equal((await browserCommands.host(credential)).admitted,false);
  await assert.rejects(new HostSetup(db).read(credential),(error:unknown)=>error instanceof ApplicationError&&error.code==='HOST_NOT_ADMITTED');
  const issued=await invitations.issue({project:'local',operator,email,delivery:'manual',idempotencyKey:randomUUID()});invitation=issued.invitationId;
  const privateInvite=await invitations.recover({project:'local',operator,invitationId:invitation}),redeem={code:privateInvite.code,idempotencyKey:randomUUID()};
  assert.equal((await browserCommands.redeem(credential,redeem)).admitted,true);assert.equal((await browserCommands.redeem(credential,redeem)).admitted,true);
  assert.equal((await browserCommands.host(credential)).calendarConnected,false);
  await sql.query(`insert into fmat.photon_receivers(project_id,receiver_id,enabled) values('${project}','${receiver}',true);`);
  const started=await service.start(credential,browser,{phone,idempotencyKey:randomUUID()});let code='';
  await dispatchLinkCodes(db,env,{async send(_route,_phone,text){code=text.match(/code is (\d{6})/u)![1];return {status:'accepted',providerReference:'fixture'};},async reconcile(){return {status:'uncertain',providerReference:null};}});
  const linked=await service.verify(credential,browser,{challengeId:started.challenge!.id,code,idempotencyKey:randomUUID()});assert.ok(linked.link);
  const grant=await conversations.open(credential,{audience:'host_setup'}),scope=grant.conversationId;
  // Date transport has millisecond precision; ensure the synthetic sender time
  // is genuinely later than database link creation (which is microsecond time).
  await delay(5);
  const ingress=await Promise.all(Array.from({length:6},()=>photonWebhook(request('preferences'),{env,database:db})));
  assert.ok(ingress.every(r=>r.status===200));
  // A web-consumed host budget also delays private iMessage input.
  await sql.query(`insert into fmat.conversation_budgets values('host:${host}',clock_timestamp(),20,clock_timestamp(),20) on conflict(name) do update set minute_used=20,minute_started_at=clock_timestamp();`);
  assert.deepEqual(await dispatchPhotonInputs(db,env),{accepted:0,revoked:0,limited:0});
  assert.equal(await sql.query(`select count(*) from fmat.runtime_messages where conversation_id='${scope}';`),'0');
  assert.equal(await sql.query(`select j.status='pending' and j.available_at>clock_timestamp()+interval '55 seconds' and i.processed_at is null from fmat.jobs j join fmat.photon_inbox i on j.payload->>'inboxId'=i.id::text where i.project_id='${project}';`),'t');
  assert.deepEqual(await dispatchPhotonInputs(db,env),{accepted:0,revoked:0,limited:0},'not reclaimed before delay');
  await sql.query(`update fmat.conversation_budgets set minute_started_at=clock_timestamp()-interval '61 seconds' where name='host:${host}';update fmat.jobs set available_at=clock_timestamp() where payload->>'inboxId' in(select id::text from fmat.photon_inbox where project_id='${project}');`);
  const lost=new Database(env,async(...args)=>{const response=await fetch(...args);assert.equal(response.status,200);await response.text();throw new Error('Synthetic lost committed dispatch response');});
  await assert.rejects(()=>dispatchPhotonInputs(lost,env));
  const replay=await Promise.all([dispatchPhotonInputs(db,env),dispatchPhotonInputs(db,env)]);assert.equal(replay.reduce((n,r)=>n+r.accepted,0),0);
  assert.equal(await sql.query(`select count(*) from fmat.runtime_messages where conversation_id='${scope}';`),'1');
  await mkdir('.local/rebuild',{recursive:true});
  const faultDir=await mkdtemp(resolve('.local/rebuild/photon-reply-fault-'));
  const marker=join(faultDir,'settlement-blocked'),release=join(faultDir,'release'),modelCalls=join(faultDir,'model-calls'),preload=join(faultDir,'preload.mjs');
  await writeFile(preload,`import {existsSync,writeFileSync} from 'node:fs';
process.env.TOKEN_ENCRYPTION_KEY=${JSON.stringify(env.TOKEN_ENCRYPTION_KEY)};
const original=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
 if(url.startsWith('https://www.googleapis.com/calendar/v3/users/me/calendarList')){
  if(new Headers(init?.headers).get('authorization')!=='Bearer shared-setup-fixture')throw new Error('Unexpected Calendar fixture token');
  return Response.json({items:[{id:'shared-setup',summary:'Fixture calendar',accessRole:'owner',primary:true,timeZone:'Asia/Seoul'}]});
 }
 if(url.endsWith('/rest/v1/rpc/fmat_runtime_message')&&typeof init?.body==='string'){
  const body=JSON.parse(init.body);
  if(body.p_operation==='settle'&&body.p_input.reply&&!existsSync(${JSON.stringify(release)})){
   writeFileSync(${JSON.stringify(marker)},'blocked');
   return Response.json({message:'synthetic precommit outage'},{status:503});
  }
 }
 return original(input,init);
};`);
  runtime=await startBrowserRuntime(local,env.APP_ORIGIN,dispatchSecret,{preload,modelCallLog:modelCalls});
  const dispatch=()=>fetch(runtime!.origin+'/api/internal/conversations/dispatch',{method:'POST',headers:{authorization:'Bearer '+dispatchSecret}});
  const response=await dispatch();assert.equal(response.status,200);assert.equal((await response.json()).sent,1);
  // Observe the finished durable turn while its SQL settlement is unavailable.
  let stream:Response|undefined;
  for(let n=0;n<300;n++){
   stream=await fetch(runtime.origin+'/api/conversations/'+scope+'/stream',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(30_000)});
   if(stream.status!==204)break;
   // Dispatch acceptance precedes canonical-session binding on slower runners.
   // A 204 is an authorized not-yet-bound snapshot, not a failed turn.
   await delay(100);
  }
  assert.equal(stream?.status,200);const reader=stream!.body!.getReader();let output='';
  try{while(!output.includes('session.waiting')){const next=await reader.read();if(next.done)break;output+=new TextDecoder().decode(next.value);}}finally{await reader.cancel();}
  assert.match(output,/session.waiting/u);assert.ok(output.includes(describedReply));await access(marker);
  assert.equal(await sql.query(`select status from fmat.runtime_messages where conversation_id='${scope}';`),'pending');
  assert.equal(await sql.query(`select count(*) from fmat.photon_replies where project_id='${project}';`),'0');
  // The shared dispatcher may also claim inputs from concurrent integration
  // fixtures. Count this input, not every model call in the runtime process.
  const inputHash=createHash('sha256').update(describedPreferences).digest('hex');
  const readCalls=async()=> (await readFile(modelCalls,'utf8')).trim().split('\n').map(line=>JSON.parse(line) as {inputHash:string});
  const inputCalls=async()=> (await readCalls()).filter(call=>call.inputHash===inputHash).length;
  const callsBefore=await inputCalls();assert.ok(callsBefore>0);
  await runtime.stop();await writeFile(release,'resume');await runtime.restart();
  await sql.query(`update fmat.runtime_messages set next_dispatch_at=clock_timestamp()-interval '1 second',dispatch_until=null,dispatch_token=null where conversation_id='${scope}';`);
  assert.equal((await dispatch()).status,200);await settled(scope);
  assert.equal(await inputCalls(),callsBefore,'restart settles saved output without another model invocation');
  assert.equal(await sql.query(`select text from fmat.photon_replies where project_id='${project}';`),describedReply);
  assert.equal(await sql.query(`select count(*) from fmat.photon_replies where project_id='${project}';`),'1');
  // Lose the provider-result database acknowledgment after committing it.
  let sends=0,reconciles=0;const replyId=await sql.query(`select id from fmat.photon_replies where project_id='${project}';`);
  const replyProvider={async send(route:{line:string;spaceId:string},recipient:string,text:string,id:string,authorize:()=>Promise<void>){
   await authorize();sends++;assert.equal(route.spaceId,'any;-;'+phone);assert.equal(recipient,phone);assert.equal(text,describedReply);assert.equal(id,replyId);
   return {status:'accepted' as const,providerReference:'fixture-reply-guid'};
  },async reconcile(_route:unknown,reference:string|null){reconciles++;assert.equal(reference,'fixture-reply-guid');return {status:'delivered' as const,providerReference:reference};}};
  const lostFinish=new Database(env,async(input,init)=>{const response=await fetch(input,init);if(JSON.parse(String(init?.body)).p_operation==='finish'){assert.equal(response.status,200);await response.text();throw new Error('Lost committed reply acknowledgment');}return response;});
  await Promise.all([dispatchPhotonReplies(lostFinish,env,replyProvider),dispatchPhotonReplies(lostFinish,env,replyProvider)]);
  assert.equal(sends,1,'concurrent workers dispatch one frozen reply');
  await sql.query(`update fmat.photon_replies set checked_at=clock_timestamp()-interval '31 seconds' where project_id='${project}';`);
  await dispatchPhotonReplies(db,env,replyProvider);assert.equal(sends,1);assert.equal(reconciles,1);
  assert.equal(await sql.query(`select status||':'||(text is null)::text from fmat.photon_replies where id='${replyId}';`),'delivered:true');
  assert.equal(await sql.query(`select status from fmat.runtime_messages where conversation_id='${scope}';`),'completed');
  assert.equal(await sql.query(`select count(*) from fmat.setup_drafts d join fmat.setup_conversations c on c.id=d.conversation_id where c.host_id='${host}';`),'1');
  assert.equal(await sql.query(`select channel from fmat.setup_turns t join fmat.setup_conversations c on c.id=t.conversation_id where c.host_id='${host}';`),'imessage');
  assert.equal(await sql.query(`select rules is null from fmat.hosts where id='${host}';`),'t');
  const session=await sql.query(`select runtime_session_id from fmat.conversation_scopes where id='${scope}';`);assert.ok(session);
  const webHeaders={authorization:'Bearer '+token,'content-type':'application/json'};
  const view=await fetch(runtime.origin+'/api/conversations/'+scope,{headers:webHeaders});assert.equal(view.status,200);assert.equal((await view.json()).messages[0].text,describedPreferences);
  const web=await fetch(runtime.origin+`/api/conversations/${scope}/messages`,{method:'POST',headers:webHeaders,body:JSON.stringify({clientId:randomUUID(),text:'Continue from the browser.'})});assert.equal(web.status,202);await settled(scope);
  assert.ok((await readCalls()).some(call=>call.inputHash===createHash('sha256').update('Continue from the browser.').digest('hex')),'the model log includes the distinct continuation');
  assert.equal(await inputCalls(),callsBefore,'a different input cannot change the original input replay count');
  assert.equal(await sql.query(`select runtime_session_id from fmat.conversation_scopes where id='${scope}';`),session,'web resumes the same runtime session');
  assert.equal(await sql.query(`select count(*) from fmat.photon_replies where project_id='${project}';`),'1','web continuation does not send an iMessage reply');
  await verifySharedSetupReview({sql,database:db,env,host,credential,scope,async turn(text){
   const key=randomUUID();assert.equal((await photonWebhook(request(key,text),{env,database:db})).status,200);
   assert.equal((await dispatchPhotonInputs(db,env)).accepted,1);assert.equal((await dispatch()).status,200);await settled(scope);
   return sql.query(`select r.text from fmat.photon_replies r join fmat.photon_inbox i on i.id=r.inbox_id where i.project_id='${project}' and i.message_id='${key}';`);
  }});
  // Finish these additional replies through the real ordered worker so the
  // following unlink test still pauses its own reply at provider preflight.
  const sharedReplyIds=new Set<string>();
  for(let n=0;n<5;n++)assert.equal((await dispatchPhotonReplies(db,env,{async send(route,recipient,_text,id,authorize){
   await authorize();assert.equal(route.spaceId,'any;-;'+phone);assert.equal(recipient,phone);assert.ok(!sharedReplyIds.has(id));sharedReplyIds.add(id);
   return {status:'delivered',providerReference:'fixture:'+id};
  },async reconcile(){assert.fail('fresh fixture replies should not need reconciliation');}})).claimed,1);
  assert.equal(sharedReplyIds.size,5);
  await verifySetupIsolation({sql,db,env,local,host,credential,token,scope,origin:runtime.origin,service,async privateTurn(sender,text,otherScope){
   const key=randomUUID();await delay(5);assert.equal((await photonWebhook(request(key,text,sender),{env,database:db})).status,200);
   assert.equal((await dispatchPhotonInputs(db,env)).accepted,1);assert.equal((await dispatch()).status,200);await settled(otherScope);
   return sql.query(`select r.text from fmat.photon_replies r join fmat.photon_inbox i on i.id=r.inbox_id where i.project_id='${project}' and i.message_id='${key}';`);
  }});
  const messagesBeforeUnlink=Number(await sql.query(`select count(*) from fmat.runtime_messages where conversation_id='${scope}';`));
  const draftsBeforeUnlink=await sql.query(`select count(*) from fmat.setup_drafts d join fmat.setup_conversations c on c.id=d.conversation_id where c.host_id='${host}';`);
  assert.equal((await photonWebhook(request('reply-before-unlink','A second private turn. Bearer photon-secret https://example.test/?%63ode=photon-code'),{env,database:db})).status,200);
  await dispatchPhotonInputs(db,env);assert.equal((await dispatch()).status,200);await settled(scope);
  const protectedPrivate='A second private turn. [x] https://example.test/?[x]';
  assert.equal(await sql.query(`select m.text from fmat.runtime_messages m join fmat.photon_inbox i on i.runtime_message_id=m.id where i.project_id='${project}' and i.message_id='reply-before-unlink';`),protectedPrivate);
  assert.ok((await readCalls()).some(call=>call.inputHash===createHash('sha256').update(protectedPrivate).digest('hex')),'signed private input reaches the actual model only after protection');
  assert.ok(!(await readCalls()).some(call=>call.inputHash===createHash('sha256').update('A second private turn. Bearer photon-secret https://example.test/?%63ode=photon-code').digest('hex')));
  let preflightReady!:()=>void,releasePreflight!:()=>void;
  const ready=new Promise<void>(resolve=>preflightReady=resolve),paused=new Promise<void>(resolve=>releasePreflight=resolve);
  const revokedSend=dispatchPhotonReplies(db,env,{async send(_route,_phone,_text,_id,authorize){
   preflightReady();await paused;await authorize();assert.fail('revoked reply reached provider send');
  },async reconcile(){assert.fail('prepared reply must use preflight');}});
  await ready;
  // A real concurrent unlink transaction wins while dispatch waits for the
  // host lock. The processor must inspect the newly committed link state.
  assert.equal((await photonWebhook(request('queued','Queued synthetic preference'),{env,database:db})).status,200);
  await sql.query(`update fmat.conversation_budgets set minute_used=20,minute_started_at=clock_timestamp() where name='host:${host}';`);
  assert.deepEqual(await dispatchPhotonInputs(db,env),{accepted:0,revoked:0,limited:0});
  assert.equal(await sql.query(`select processed_at is null from fmat.photon_inbox where project_id='${project}' and message_id='queued';`),'t');
  await sql.query(`update fmat.jobs set available_at=clock_timestamp() where payload->>'inboxId' in(select id::text from fmat.photon_inbox where project_id='${project}' and message_id='queued');`);
  const pid=Number((await holder.query(`begin;select pg_backend_pid();select id from fmat.hosts where id='${host}' for update;`)).split('\n')[0]);
  const waiting=dispatchPhotonInputs(db,env);let blocked=false;
  for(let n=0;n<100;n++){blocked=await sql.query(`select exists(select 1 from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid)));`)==='t';if(blocked)break;await delay(20);}
  assert.equal(blocked,true,'observed real host lock wait');
  await holder.query(`update fmat.photon_links set revoked_at=clock_timestamp() where id='${linked.link.id}';commit;`);
  assert.equal((await waiting).revoked,1);releasePreflight();await revokedSend;
  assert.equal(await sql.query(`select r.revoked_at is not null and r.text is null from fmat.photon_replies r join fmat.photon_inbox i on i.id=r.inbox_id where i.project_id='${project}' and i.message_id='reply-before-unlink';`),'t','unlink after provider preflight suppresses private send');
  assert.equal(await sql.query(`select processing_outcome from fmat.photon_inbox where project_id='${project}' and message_id='queued';`),'revoked');
  assert.equal(Number(await sql.query(`select count(*) from fmat.runtime_messages where conversation_id='${scope}';`)),messagesBeforeUnlink+1);
  // Accepted grants cannot be reused after unlink, even though the host's
  // independent web session remains authorized.
  const phoneGrant=await sql.query(`select grant_id from fmat.runtime_messages where conversation_id='${scope}' order by created_at limit 1;`);
  await assert.rejects(()=>conversations.checkExecution(phoneGrant,scope));await conversations.checkExecution(grant.grantId,scope);
  assert.equal((await photonWebhook(request('preferences'),{env,database:db})).status,200);await dispatchPhotonInputs(db,env);
  assert.equal(await sql.query(`select count(*) from fmat.setup_drafts d join fmat.setup_conversations c on c.id=d.conversation_id where c.host_id='${host}';`),draftsBeforeUnlink);
 }finally{
  await holder.query('rollback;');await runtime?.stop();
  if(host){await sql.query(`delete from fmat.queue_publications p using fmat.jobs j,fmat.photon_inbox i where p.job_id=j.id and j.payload->>'inboxId'=i.id::text and i.project_id='${project}';delete from pgmq.q_fmat_jobs q using fmat.jobs j,fmat.photon_inbox i where q.message->>'jobId'=j.id::text and j.payload->>'inboxId'=i.id::text and i.project_id='${project}';delete from fmat.jobs j using fmat.photon_inbox i where j.payload->>'inboxId'=i.id::text and i.project_id='${project}';delete from fmat.photon_replies where project_id='${project}';delete from fmat.photon_inbox where project_id='${project}';delete from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_scopes where host_id='${host}';delete from fmat.photon_links where project_id='${project}';delete from fmat.photon_link_challenges where project_id='${project}';delete from fmat.photon_receivers where project_id='${project}';delete from fmat.audit_events where actor->>'id'='${host}';delete from fmat.idempotency where actor_scope='host:${host}';delete from fmat.hosts where id='${host}';delete from fmat.invitation_deliveries where invitation_id='${invitation}';delete from fmat.invitations where id='${invitation}';delete from fmat.idempotency where actor_scope='invitation_operator:local:${operator}';delete from fmat.audit_events where subject_id='${invitation}';`);assert.equal((await fetch(local.API_URL+'/auth/v1/admin/users/'+host,{method:'DELETE',headers})).status,200);}
  sql.close();holder.close();
 }
});
