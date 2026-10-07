import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes,createHash,createHmac} from 'node:crypto';
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
import {describedPreferences} from '../runtime/setup-preferences.ts';

test('signed linked input executes once in the real eve setup session and loses authority after unlink',{timeout:120_000},async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const project=randomUUID(),receiver=randomUUID(),secret=randomBytes(32).toString('hex'),dispatchSecret=randomBytes(32).toString('hex');
 const env={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),PHOTON_PROJECT_ID:project,PHOTON_WEBHOOK_ID:receiver,IMESSAGE_WEBHOOK_SECRET:secret};
 const sql=new LocalSql(),holder=new LocalSql(),db=new Database(env),conversations=new Conversations(db);
 const headers={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'};
 const email=randomUUID()+'@example.test',password=randomUUID()+randomUUID(),invitation=randomUUID(),phone='+155501'+String(Math.floor(Math.random()*9000)+1000),browser=browserProof();
 let host='',runtime:Awaited<ReturnType<typeof startBrowserRuntime>>|undefined;
 const service=new HostIMessage(db,env,{async prepare(number){return {line:'shared',spaceId:'any;-;'+number};}});
 const providerInputs=new Map<string,string>();
 function request(key:string,text=describedPreferences){
  const timestamp=String(Math.floor(Date.now()/1000)),space={id:'any;-;'+phone,platform:'imessage',type:'dm',phone:'shared'};
  let body=providerInputs.get(key);
  if(!body){body=JSON.stringify({event:'messages',space,message:{id:key,platform:'imessage',direction:'inbound',timestamp:new Date().toISOString(),sender:{id:phone,platform:'imessage'},space,content:{type:'text',text}}});providerInputs.set(key,body);}
  return new Request('https://fixture.invalid/api/providers/photon',{method:'POST',body,headers:{'content-type':'application/json','x-spectrum-webhook-id':receiver,'x-spectrum-timestamp':timestamp,'x-spectrum-signature':'v0='+createHmac('sha256',secret).update(`v0:${timestamp}:${body}`).digest('hex')}});
 }
 async function settled(scope:string){for(let n=0;n<200;n++){if(await sql.query(`select not exists(select 1 from fmat.runtime_messages where conversation_id='${scope}' and status='pending');`)==='t')return;await delay(50);}assert.fail('runtime turn did not settle');}
 try{
  const created=await fetch(local.API_URL+'/auth/v1/admin/users',{method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(created.status,200);host=(await created.json()).id;
  const login=await fetch(local.API_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:local.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);const token=(await login.json()).access_token;
  const credential=await verifyHostToken(token,{env});
  await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','${email}','${createHash('sha256').update(invitation).digest('hex')}',now()+interval '1 day','photon-execution-test');insert into fmat.hosts(id,email,invitation_id) values('${host}','${email}','${invitation}');insert into fmat.photon_receivers(project_id,receiver_id,enabled) values('${project}','${receiver}',true);`);
  const started=await service.start(credential,browser,{phone,idempotencyKey:randomUUID()});let code='';
  await dispatchLinkCodes(db,env,{async send(_route,_phone,text){code=text.match(/code is (\d{6})/u)![1];return {status:'accepted',providerReference:'fixture'};},async reconcile(){return {status:'uncertain',providerReference:null};}});
  const linked=await service.verify(credential,browser,{challengeId:started.challenge!.id,code,idempotencyKey:randomUUID()});assert.ok(linked.link);
  const grant=await conversations.open(credential,{audience:'host_setup'}),scope=grant.conversationId;
  // Date transport has millisecond precision; ensure the synthetic sender time
  // is genuinely later than database link creation (which is microsecond time).
  await delay(5);
  const ingress=await Promise.all(Array.from({length:6},()=>photonWebhook(request('preferences'),{env,database:db})));
  assert.ok(ingress.every(r=>r.status===200));
  const lost=new Database(env,async(...args)=>{const response=await fetch(...args);assert.equal(response.status,200);await response.text();throw new Error('Synthetic lost committed dispatch response');});
  await assert.rejects(()=>dispatchPhotonInputs(lost,env));
  const replay=await Promise.all([dispatchPhotonInputs(db,env),dispatchPhotonInputs(db,env)]);assert.equal(replay.reduce((n,r)=>n+r.accepted,0),0);
  assert.equal(await sql.query(`select count(*) from fmat.runtime_messages where conversation_id='${scope}';`),'1');
  runtime=await startBrowserRuntime(local,'http://fixture.local',dispatchSecret);
  const dispatch=()=>fetch(runtime!.origin+'/api/internal/conversations/dispatch',{method:'POST',headers:{authorization:'Bearer '+dispatchSecret}});
  const response=await dispatch();assert.equal(response.status,200);assert.equal((await response.json()).sent,1);await settled(scope);
  assert.equal(await sql.query(`select status from fmat.runtime_messages where conversation_id='${scope}';`),'completed');
  assert.equal(await sql.query(`select count(*) from fmat.setup_drafts d join fmat.setup_conversations c on c.id=d.conversation_id where c.host_id='${host}';`),'1');
  assert.equal(await sql.query(`select channel from fmat.setup_turns t join fmat.setup_conversations c on c.id=t.conversation_id where c.host_id='${host}';`),'imessage');
  assert.equal(await sql.query(`select rules is null from fmat.hosts where id='${host}';`),'t');
  const session=await sql.query(`select runtime_session_id from fmat.conversation_scopes where id='${scope}';`);assert.ok(session);
  const webHeaders={authorization:'Bearer '+token,'content-type':'application/json'};
  const view=await fetch(runtime.origin+'/api/conversations/'+scope,{headers:webHeaders});assert.equal(view.status,200);assert.equal((await view.json()).messages[0].text,describedPreferences);
  const web=await fetch(runtime.origin+`/api/conversations/${scope}/messages`,{method:'POST',headers:webHeaders,body:JSON.stringify({clientId:randomUUID(),text:'Continue from the browser.'})});assert.equal(web.status,202);await settled(scope);
  assert.equal(await sql.query(`select runtime_session_id from fmat.conversation_scopes where id='${scope}';`),session,'web resumes the same runtime session');
  // A real concurrent unlink transaction wins while dispatch waits for the
  // host lock. The processor must inspect the newly committed link state.
  assert.equal((await photonWebhook(request('queued','Queued synthetic preference'),{env,database:db})).status,200);
  const pid=Number((await holder.query(`begin;select pg_backend_pid();select id from fmat.hosts where id='${host}' for update;`)).split('\n')[0]);
  const waiting=dispatchPhotonInputs(db,env);let blocked=false;
  for(let n=0;n<100;n++){blocked=await sql.query(`select exists(select 1 from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid)));`)==='t';if(blocked)break;await delay(20);}
  assert.equal(blocked,true,'observed real host lock wait');
  await holder.query(`update fmat.photon_links set revoked_at=clock_timestamp() where id='${linked.link.id}';commit;`);
  assert.equal((await waiting).revoked,1);
  assert.equal(await sql.query(`select processing_outcome from fmat.photon_inbox where project_id='${project}' and message_id='queued';`),'revoked');
  assert.equal(await sql.query(`select count(*) from fmat.runtime_messages where conversation_id='${scope}';`),'2');
  // Accepted grants cannot be reused after unlink, even though the host's
  // independent web session remains authorized.
  const phoneGrant=await sql.query(`select grant_id from fmat.runtime_messages where conversation_id='${scope}' order by created_at limit 1;`);
  await assert.rejects(()=>conversations.checkExecution(phoneGrant,scope));await conversations.checkExecution(grant.grantId,scope);
  assert.equal((await photonWebhook(request('preferences'),{env,database:db})).status,200);await dispatchPhotonInputs(db,env);
  assert.equal(await sql.query(`select count(*) from fmat.setup_drafts d join fmat.setup_conversations c on c.id=d.conversation_id where c.host_id='${host}';`),'1');
 }finally{
  await holder.query('rollback;');await runtime?.stop();
  if(host){await sql.query(`delete from fmat.queue_publications p using fmat.jobs j,fmat.photon_inbox i where p.job_id=j.id and j.payload->>'inboxId'=i.id::text and i.project_id='${project}';delete from pgmq.q_fmat_jobs q using fmat.jobs j,fmat.photon_inbox i where q.message->>'jobId'=j.id::text and j.payload->>'inboxId'=i.id::text and i.project_id='${project}';delete from fmat.jobs j using fmat.photon_inbox i where j.payload->>'inboxId'=i.id::text and i.project_id='${project}';delete from fmat.photon_inbox where project_id='${project}';delete from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_scopes where host_id='${host}';delete from fmat.photon_links where project_id='${project}';delete from fmat.photon_link_challenges where project_id='${project}';delete from fmat.photon_receivers where project_id='${project}';delete from fmat.audit_events where actor->>'id'='${host}';delete from fmat.idempotency where actor_scope='host:${host}';delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invitation}';`);assert.equal((await fetch(local.API_URL+'/auth/v1/admin/users/'+host,{method:'DELETE',headers})).status,200);}
  sql.close();holder.close();
 }
});
