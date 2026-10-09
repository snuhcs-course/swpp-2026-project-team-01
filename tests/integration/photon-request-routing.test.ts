import {HostRevisionReview} from '../../lib/server/identity/host-revision-review.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes,createHash,createHmac} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Database} from '../../lib/server/database/client.ts';
import {verifyHostToken,type Credential} from '../../lib/server/identity/credentials.ts';
import {Conversations} from '../../lib/server/identity/conversations.ts';
import {HostIMessage} from '../../lib/server/photon/linking.ts';
import {dispatchLinkCodes} from '../../lib/server/photon/delivery.ts';
import {dispatchPhotonInputs} from '../../lib/server/photon/execution.ts';
import {dispatchPhotonReplies} from '../../lib/server/photon/replies.ts';
import {photonWebhook} from '../../lib/server/photon/webhook.ts';
import {browserProof} from '../../lib/server/photon/proof.ts';
import {LocalSql,cleanupFixtureJobsSql} from './local-sql.ts';
import {startBrowserRuntime} from '../runtime/fixture-server.ts';

test('signed private selection survives restart, preserves request scope and retries safely around web locks',{timeout:180_000},async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.ok(['127.0.0.1','localhost'].includes(new URL(local.API_URL).hostname));
 const project=randomUUID(),receiver=randomUUID(),secret=randomBytes(32).toString('hex'),dispatchSecret=randomBytes(32).toString('hex');
 const env={APP_ORIGIN:'http://localhost:3000',SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),PHOTON_PROJECT_ID:project,PHOTON_WEBHOOK_ID:receiver,IMESSAGE_WEBHOOK_SECRET:secret};
 const sql=new LocalSql(),holder=new LocalSql(),db=new Database(env),conversations=new Conversations(db);
 const service=new HostIMessage(db,env,{async prepare(number){return {line:'shared',spaceId:'any;-;'+number};}});
 const headers={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'};
 const hosts:{id:string;invite:string;phone:string;credential:Credential;browser:string;link:string}[]=[];
 const requests=[randomUUID(),randomUUID(),randomUUID()],bodies=new Map<string,string>();
 let runtime:Awaited<ReturnType<typeof startBrowserRuntime>>|undefined;
 async function link(n:number){
  const host=hosts[n],started=await service.start(host.credential,host.browser,{phone:host.phone,idempotencyKey:randomUUID()});let code='';
  await dispatchLinkCodes(db,env,{async send(_route,recipient,text){assert.equal(recipient,host.phone);code=text.match(/code is (\d{6})/u)![1];return {status:'delivered',providerReference:randomUUID()};},async reconcile(){assert.fail('new fixture code cannot need reconciliation');}});
  const value=await service.verify(host.credential,host.browser,{challengeId:started.challenge!.id,code,idempotencyKey:randomUUID()});host.link=value.link!.id;
  await delay(5);
 }
 async function receive(n:number,text:string,key=randomUUID()){
  const phone=hosts[n].phone,space={id:'any;-;'+phone,platform:'imessage',type:'dm',phone:'shared'},timestamp=String(Math.floor(Date.now()/1000));
  let body=bodies.get(key);if(!body){body=JSON.stringify({event:'messages',space,message:{id:key,platform:'imessage',direction:'inbound',timestamp:new Date().toISOString(),sender:{id:phone,platform:'imessage'},space,content:{type:'text',text}}});bodies.set(key,body);}
  const request=new Request('https://fixture.invalid/api/providers/photon',{method:'POST',body,headers:{'content-type':'application/json','x-spectrum-webhook-id':receiver,'x-spectrum-timestamp':timestamp,'x-spectrum-signature':'v0='+createHmac('sha256',secret).update(`v0:${timestamp}:${body}`).digest('hex')}});
  assert.equal((await photonWebhook(request,{env,database:db})).status,200);return key;
 }
 async function receipt(key:string){return JSON.parse(await sql.query(`select json_build_object('messageId',runtime_message_id,'scope',conversation_id,'grant',execution_grant_id,'processed',processed_at is not null) from fmat.photon_inbox where project_id='${project}' and message_id='${key}';`));}
 async function reply(key:string){return sql.query(`select r.text from fmat.photon_replies r join fmat.photon_inbox i on i.id=r.inbox_id where i.project_id='${project}' and i.message_id='${key}';`);}
 async function execute(key:string){
  const input=await receipt(key);assert.ok(input.messageId);
  assert.equal((await fetch(runtime!.origin+'/api/internal/conversations/dispatch',{method:'POST',headers:{authorization:'Bearer '+dispatchSecret}})).status,200);
  for(let n=0;n<300;n++){
   const status=await sql.query(`select status from fmat.runtime_messages where id='${input.messageId}';`);
   if(status!=='pending'){assert.equal(status,'completed');return reply(key);}await delay(50);
  }assert.fail('private request runtime did not settle');
 }
 async function turn(n:number,text:string){const key=await receive(n,text);assert.equal((await dispatchPhotonInputs(db,env)).accepted,1);const input=await receipt(key);return {key,input,text:input.messageId?await execute(key):await reply(key)};}
 async function blocked(pid:number){for(let n=0;n<100;n++){if(await sql.query(`select exists(select 1 from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid)));`)==='t')return;await delay(20);}assert.fail('request-lock wait was not observed');}
 try{
  await sql.query(`insert into fmat.photon_receivers(project_id,receiver_id,enabled) values('${project}','${receiver}',true);`);
  for(let n=0;n<2;n++){
   const email=randomUUID()+'@routing.test',password=randomUUID()+randomUUID(),invite=randomUUID();
   const created=await fetch(local.API_URL+'/auth/v1/admin/users',{method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(created.status,200);const id=(await created.json()).id;
   const login=await fetch(local.API_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:local.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);
   const credential=await verifyHostToken((await login.json()).access_token,{env});
   hosts.push({id,invite,credential,phone:'+1555'+String(Math.floor(Math.random()*9000000)+1000000),browser:browserProof(),link:''});
   await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invite}','${email}','${createHash('sha256').update(invite).digest('hex')}',now()+interval '1 day','routing-fixture');insert into fmat.hosts(id,email,invitation_id) values('${id}','${email}','${invite}');`);
   await link(n);
  }
  for(let n=0;n<3;n++)await sql.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values('${requests[n]}','${hosts[n===2?1:0].id}','{"purpose":"Routing meeting ${n+1}"}','${createHash('sha256').update(requests[n]).digest('hex')}',now()+interval '1 day');`);
  runtime=await startBrowserRuntime(local,env.APP_ORIGIN,dispatchSecret);
  assert.equal((await turn(0,'private-request-question')).text,'Setup has no selected request.');
  const selected=await turn(0,'request '+requests[0]);assert.match(selected.text,/^Selected request /);assert.equal(selected.input.messageId,null);
  // First-scope creation must not hold the host while waiting on a web request writer.
  const pid=Number((await holder.query(`begin;select pg_backend_pid();select id from fmat.requests where id='${requests[0]}' for update;`)).split('\n')[0]);
  const firstKey=await receive(0,'private-request-question'),waiting=dispatchPhotonInputs(db,env);await blocked(pid);
  await sql.query(`begin;set local lock_timeout='500ms';select id from fmat.hosts where id='${hosts[0].id}' for update;rollback;`);
  await holder.query(`update fmat.requests set details=jsonb_set(details,'{purpose}','"First edited in web"') where id='${requests[0]}';commit;`);
  assert.equal((await waiting).accepted,1);
  assert.equal(await execute(firstKey),`Request ${requests[0]}\n\nPrivate request: First edited in web`);
  const first=await receipt(firstKey),web=await conversations.open(hosts[0].credential,{audience:'host_private',requestId:requests[0]});assert.equal(web.conversationId,first.scope);
  // Runtime lock contention returns without waiting while holding the request.
  await holder.query(`begin;select pg_advisory_xact_lock(hashtextextended('runtime:${first.scope}',0));`);
  const busyKey=await receive(0,'private-request-question');assert.equal((await dispatchPhotonInputs(db,env)).accepted,0);assert.equal((await receipt(busyKey)).processed,false);
  await holder.query('commit;');assert.equal((await dispatchPhotonInputs(db,env)).accepted,1);assert.equal(await execute(busyKey),`Request ${requests[0]}\n\nPrivate request: First edited in web`);
  // Freeze a request input, queue selection behind it, and restart before execution.
  const pending=await receive(0,'private-request-question');assert.equal((await dispatchPhotonInputs(db,env)).accepted,1);
  const nextSelection=await receive(0,'request '+requests[1]);assert.equal((await dispatchPhotonInputs(db,env)).accepted,0);
  await runtime.restart();assert.equal(await execute(pending),`Request ${requests[0]}\n\nPrivate request: First edited in web`);
  assert.equal((await dispatchPhotonInputs(db,env)).accepted,1);assert.match(await reply(nextSelection),new RegExp('^Selected request '+requests[1]));
  await receive(0,'request '+requests[0],selected.key);assert.equal((await dispatchPhotonInputs(db,env)).accepted,0,'replayed old selection does not switch back');
  const second=await turn(0,'private-request-question');assert.equal(second.text,`Request ${requests[1]}\n\nPrivate request: Routing meeting 2`);assert.notEqual(second.input.scope,first.scope);
  assert.equal((await conversations.checkExecution(first.grant,first.scope)).requestId,requests[0]);
  const review=await turn(0,'review');assert.equal(review.input.messageId,null,'authored review bypasses the model');assert.equal(review.text,`Request ${requests[1]}\n\nThere is no open proposal to review. Open your host workspace for the current request status.`);
  const foreign=await turn(0,'request '+requests[2]);assert.match(foreign.text,/^That request could not be selected\./);assert.doesNotMatch(foreign.text,/Routing meeting 3/);
  assert.equal(await sql.query(`select selected_request_id from fmat.photon_links where id='${hosts[0].link}';`),requests[1]);
  assert.equal((await turn(1,'private-request-question')).text,'Setup has no selected request.');
  await turn(1,'request '+requests[2]);assert.equal((await turn(1,'private-request-question')).text,`Request ${requests[2]}\n\nPrivate request: Routing meeting 3`);
  await assert.rejects(conversations.open(hosts[1].credential,{audience:'host_private',requestId:requests[0]}));
  const sent=new Map<string,{phone:string;text:string}>();
  for(let n=0;n<30;n++){
   const result=await dispatchPhotonReplies(db,env,{async send(_route,phone,text,id,authorize){await authorize();assert.ok(!sent.has(id));sent.set(id,{phone,text});return {status:'delivered',providerReference:id};},async reconcile(){assert.fail('fresh replies cannot need reconciliation');}});
   if(result.claimed===0)break;
  }
  assert.equal(sent.size,Number(await sql.query(`select count(*) from fmat.photon_replies where project_id='${project}';`)));
  assert.ok([...sent.values()].some(item=>item.phone===hosts[0].phone&&item.text===`Request ${requests[0]}\n\nPrivate request: First edited in web`),'delayed reply retains original request despite later selection');
  assert.ok([...sent.values()].filter(item=>item.phone===hosts[1].phone).every(item=>!item.text.includes(requests[0])&&!item.text.includes(requests[1])));
  await turn(0,'setup');assert.equal((await turn(0,'private-request-question')).text,'Setup has no selected request.');
  await turn(0,'request '+requests[1]);
  const revisionBefore=await sql.query(`select revision from fmat.requests where id='${requests[1]}';`);
  assert.match((await turn(0,'host-revision-fixture')).text,/Private revision drafted/);
  assert.equal(await sql.query(`select revision from fmat.requests where id='${requests[1]}';`),revisionBefore,'actual Eve draft does not change shared revision');
  const revisions=new HostRevisionReview(db),revisionReview=await revisions.read(hosts[0].credential,{requestId:requests[1]});
  assert.equal(revisionReview.review?.details.location,'https://meet.example.test/revised');
  const decision={requestId:requests[1],input:{reviewId:revisionReview.review!.id,expectedRevision:revisionReview.review!.baseRevision,confirmed:true,idempotencyKey:randomUUID()}};
  const applied=await revisions.decide('apply',hosts[0].credential,decision);assert.equal(applied.review?.status,'applied');
  assert.deepEqual(await revisions.decide('apply',hosts[0].credential,decision),applied);
  assert.equal(await sql.query(`select count(*) from fmat.request_history where request_id='${requests[1]}' and operation='details_update';`),'1');
  const oldLink=hosts[0].link;
  await service.unlink(hosts[0].credential,hosts[0].browser,{linkId:oldLink});await assert.rejects(conversations.checkExecution(first.grant,first.scope));
  await sql.query(`update fmat.photon_link_challenges set created_at=created_at-interval '61 seconds',expires_at=expires_at-interval '61 seconds' where host_id='${hosts[0].id}';`);
  await link(0);assert.notEqual(hosts[0].link,oldLink);assert.equal(await sql.query(`select selected_request_id is null from fmat.photon_links where id='${hosts[0].link}';`),'t');
  assert.equal((await turn(0,'private-request-question')).text,'Setup has no selected request.');
  assert.equal(await sql.query(`select count(*) from fmat.host_approvals where host_id='${hosts[0].id}';`),'0');
 }finally{
  try{
  await holder.query('rollback;');await runtime?.stop();
  await sql.query(cleanupFixtureJobsSql(`payload->>'inboxId' in(select id::text from fmat.photon_inbox where project_id='${project}')`));
  await sql.query(`delete from fmat.photon_replies where project_id='${project}';delete from fmat.photon_inbox where project_id='${project}';delete from fmat.photon_links where project_id='${project}';delete from fmat.photon_link_challenges where project_id='${project}';delete from fmat.photon_receivers where project_id='${project}';`);
  for(const host of hosts){
   await sql.query(`delete from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where host_id='${host.id}');delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where host_id='${host.id}');delete from fmat.conversation_scopes where host_id='${host.id}';delete from fmat.request_history where request_id in(select id from fmat.requests where host_id='${host.id}');delete from fmat.requests where host_id='${host.id}';delete from fmat.audit_events where actor->>'id'='${host.id}';delete from fmat.idempotency where actor_scope='host:${host.id}';delete from fmat.hosts where id='${host.id}';delete from fmat.invitations where id='${host.invite}';`);
   assert.equal((await fetch(local.API_URL+'/auth/v1/admin/users/'+host.id,{method:'DELETE',headers})).status,200);
  }
  }finally{sql.close();holder.close();}
 }
});
