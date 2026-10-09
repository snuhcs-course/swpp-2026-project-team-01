import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {verifyHostToken,type Credential} from '../../lib/server/identity/credentials.ts';
import {InvitationOperator} from '../../lib/server/identity/invitation-operator.ts';
import {BrowserCommands} from '../../lib/server/identity/browser-commands.ts';
import {Conversations} from '../../lib/server/identity/conversations.ts';
import {HostSetup} from '../../lib/server/setup/commands.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {browserProof} from '../../lib/server/photon/proof.ts';
import {dispatchLinkCodes} from '../../lib/server/photon/delivery.ts';
import {dispatchPhotonReplies} from '../../lib/server/photon/replies.ts';
import type {HostIMessage} from '../../lib/server/photon/linking.ts';
import type {Database} from '../../lib/server/database/client.ts';
import type {LocalSql} from './local-sql.ts';
import {setupAmbiguous} from '../runtime/setup-preferences.ts';

const errorCode=(code:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===code;
export async function verifySetupIsolation(input:{sql:LocalSql;db:Database;env:NodeJS.ProcessEnv;local:Record<string,string>;host:string;credential:Credential;token:string;scope:string;origin:string;service:HostIMessage;privateTurn:(phone:string,text:string,scope:string)=>Promise<string>}){
 const {sql,db,env,local,host,credential,token,scope,origin,service,privateTurn}=input;
 assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
 const headers={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'};
 const email=randomUUID()+'@example.test',password=randomUUID()+randomUUID(),operator='isolation-'+randomUUID(),phone='+155502'+String(Math.floor(Math.random()*9000)+1000),proof=browserProof();
 const setup=new HostSetup(db),conversations=new Conversations(db),access=new BrowserCommands(db),invitations=new InvitationOperator(db,env);
 const firstBefore=await setup.read(credential);let other='',invitation:string=randomUUID();
 try{
  const created=await fetch(local.API_URL+'/auth/v1/admin/users',{method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(created.status,200);other=(await created.json()).id;
  const login=await fetch(local.API_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:local.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);const otherToken=(await login.json()).access_token,otherCredential=await verifyHostToken(otherToken,{env});
  assert.equal((await access.host(otherCredential)).admitted,false);
  invitation=(await invitations.issue({project:'local',operator,email,delivery:'manual',idempotencyKey:randomUUID()})).invitationId;
  const invite=await invitations.recover({project:'local',operator,invitationId:invitation});
  await assert.rejects(access.redeem(credential,{code:invite.code,idempotencyKey:randomUUID()}),errorCode('INVITATION_INVALID'));
  assert.equal((await access.redeem(otherCredential,{code:invite.code,idempotencyKey:randomUUID()})).admitted,true);
  const otherGrant=await conversations.open(otherCredential,{audience:'host_setup'}),otherScope=otherGrant.conversationId;
  assert.notEqual(otherScope,scope);
  await assert.rejects(conversations.authorize(otherCredential,scope),errorCode('NOT_FOUND'));
  await assert.rejects(conversations.authorize(credential,otherScope),errorCode('NOT_FOUND'));
  await assert.rejects(conversations.checkExecution(otherGrant.grantId,scope),errorCode('UNAUTHORIZED'));
  const started=await service.start(otherCredential,proof,{phone,idempotencyKey:randomUUID()});let code='';
  await dispatchLinkCodes(db,env,{async send(_route,recipient,text){assert.equal(recipient,phone);code=text.match(/code is (\d{6})/u)![1];return {status:'accepted',providerReference:'isolation-code'};},async reconcile(){assert.fail('fresh link code');}});
  assert.ok((await service.verify(otherCredential,proof,{challengeId:started.challenge!.id,code,idempotencyKey:randomUUID()})).link);
  assert.equal(await privateTurn(phone,setupAmbiguous,otherScope),'Which weekdays and start and end times work for meetings?');
  const otherState=await setup.read(otherCredential);assert.deepEqual(otherState.draft?.clarifications,['Which weekdays and start and end times work for meetings?']);assert.equal(otherState.confirmed.handle,null);
  assert.deepEqual(await setup.read(credential),firstBefore,'The other private sender cannot modify the first host');
  const ownHeaders={authorization:'Bearer '+otherToken,'content-type':'application/json'},firstHeaders={authorization:'Bearer '+token,'content-type':'application/json'};
  const own=await fetch(origin+'/api/conversations/'+otherScope,{headers:ownHeaders});assert.equal(own.status,200);assert.equal((await own.json()).messages[0].text,setupAmbiguous);
  for(const [target,requestHeaders] of [[scope,ownHeaders],[otherScope,firstHeaders]] as const){
   assert.equal((await fetch(origin+'/api/conversations/'+target,{headers:requestHeaders})).status,404);
   assert.equal((await fetch(origin+'/api/conversations/'+target+'/stream',{headers:requestHeaders})).status,404);
   assert.equal((await fetch(origin+'/api/conversations/'+target+'/messages',{method:'POST',headers:requestHeaders,body:JSON.stringify({clientId:randomUUID(),text:'Cross-host mutation'})})).status,404);
  }
  const phoneGrant=await sql.query(`select grant_id from fmat.runtime_messages where conversation_id='${otherScope}';`);
  await assert.rejects(conversations.checkExecution(phoneGrant,scope),errorCode('UNAUTHORIZED'));
  assert.deepEqual(await setup.read(otherCredential),otherState);assert.deepEqual(await setup.read(credential),firstBefore);
  const firstSession=await sql.query(`select runtime_session_id from fmat.conversation_scopes where id='${scope}';`),secondSession=await sql.query(`select runtime_session_id from fmat.conversation_scopes where id='${otherScope}';`);
  assert.ok(firstSession&&secondSession);assert.notEqual(firstSession,secondSession);
  let sent=0;await dispatchPhotonReplies(db,env,{async send(route,recipient,text,_id,authorize){await authorize();sent++;assert.equal(recipient,phone);assert.equal(route.spaceId,'any;-;'+phone);assert.equal(text,'Which weekdays and start and end times work for meetings?');return {status:'delivered',providerReference:'isolation-reply'};},async reconcile(){assert.fail('fresh isolated reply');}});assert.equal(sent,1);
  assert.equal(await sql.query(`select count(*) from fmat.booking_attempts where host_id in('${host}','${other}');`),'0');
 }finally{
  if(other){
   // Preserve the first host's fixtures and drain only this sender's queue rows.
   await sql.query(`delete from fmat.queue_publications p using fmat.jobs j,fmat.photon_inbox i where p.job_id=j.id and j.payload->>'inboxId'=i.id::text and i.project_id='${env.PHOTON_PROJECT_ID}' and i.sender_id='${phone}';
    delete from pgmq.q_fmat_jobs q using fmat.jobs j,fmat.photon_inbox i where q.message->>'jobId'=j.id::text and j.payload->>'inboxId'=i.id::text and i.project_id='${env.PHOTON_PROJECT_ID}' and i.sender_id='${phone}';
    delete from fmat.jobs j using fmat.photon_inbox i where j.payload->>'inboxId'=i.id::text and i.project_id='${env.PHOTON_PROJECT_ID}' and i.sender_id='${phone}';
    delete from fmat.photon_replies where inbox_id in(select id from fmat.photon_inbox where project_id='${env.PHOTON_PROJECT_ID}' and sender_id='${phone}');
    delete from fmat.photon_inbox where project_id='${env.PHOTON_PROJECT_ID}' and sender_id='${phone}';
    delete from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where host_id='${other}');
    delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where host_id='${other}');delete from fmat.conversation_scopes where host_id='${other}';
    delete from fmat.photon_links where host_id='${other}';delete from fmat.photon_link_challenges where host_id='${other}';
    delete from fmat.idempotency where actor_scope in('host:${other}','invitation_operator:local:${operator}');delete from fmat.audit_events where actor->>'id'='${other}' or subject_id='${invitation}';
    delete from fmat.hosts where id='${other}';delete from fmat.invitation_deliveries where invitation_id='${invitation}';delete from fmat.invitations where id='${invitation}';`);
   assert.equal((await fetch(local.API_URL+'/auth/v1/admin/users/'+other,{method:'DELETE',headers})).status,200);
  }
 }
}
