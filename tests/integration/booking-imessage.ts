import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {Database} from '../../lib/server/database/client.ts';
import type {Credential} from '../../lib/server/identity/credentials.ts';
import {HostIMessage} from '../../lib/server/photon/linking.ts';
import {browserProof} from '../../lib/server/photon/proof.ts';
import {dispatchLinkCodes} from '../../lib/server/photon/delivery.ts';
import {dispatchPhotonInputs} from '../../lib/server/photon/execution.ts';
import {dispatchPhotonReplies} from '../../lib/server/photon/replies.ts';
import {photonWebhook} from '../../lib/server/photon/webhook.ts';
import {LocalSql,cleanupFixtureJobsSql} from './local-sql.ts';
import {verifyBookingWorker} from './booking-worker.ts';

export async function verifyIMessageBooking(db:Database,baseEnv:NodeJS.ProcessEnv,host:{id:string;credential:Credential},createProposal:()=>Promise<string>){
 const sql=new LocalSql(),holder=new LocalSql(),project=randomUUID(),receiver=randomUUID(),secret=randomBytes(32).toString('hex');
 const env={...baseEnv,APP_ORIGIN:'http://localhost:3000',PHOTON_PROJECT_ID:project,PHOTON_WEBHOOK_ID:receiver,IMESSAGE_WEBHOOK_SECRET:secret};
 const phone='+1555'+String(Math.floor(Math.random()*9000000)+1000000),space={id:'any;-;'+phone,platform:'imessage',type:'dm',phone:'shared'};
 const browser=browserProof(),service=new HostIMessage(db,env,{async prepare(){return {line:'shared',spaceId:space.id};}}),bodies=new Map<string,string>();
 let link='',decisions=0;
 async function receive(text:string,key=randomUUID()){
  const timestamp=String(Math.floor(Date.now()/1000));let body=bodies.get(key);
  if(!body){body=JSON.stringify({event:'messages',space,message:{id:key,platform:'imessage',direction:'inbound',timestamp:new Date().toISOString(),sender:{id:phone,platform:'imessage'},space,content:{type:'text',text}}});bodies.set(key,body);}
  const request=new Request('https://fixture.invalid/api/providers/photon',{method:'POST',body,headers:{'content-type':'application/json','x-spectrum-webhook-id':receiver,'x-spectrum-timestamp':timestamp,'x-spectrum-signature':'v0='+createHmac('sha256',secret).update(`v0:${timestamp}:${body}`).digest('hex')}});
  assert.equal((await photonWebhook(request,{env,database:db})).status,200);return key;
 }
 async function reply(key:string){return sql.query(`select r.text from fmat.photon_replies r join fmat.photon_inbox i on i.id=r.inbox_id where i.project_id='${project}' and i.message_id='${key}';`);}
 async function turn(text:string){const key=await receive(text);assert.equal((await dispatchPhotonInputs(db,env)).accepted,1);assert.equal(await sql.query(`select runtime_message_id is null from fmat.photon_inbox where project_id='${project}' and message_id='${key}';`),'t');return {key,text:await reply(key)};}
 async function deliver(){for(let n=0;n<30;n++){const batch=await dispatchPhotonReplies(db,env,{async send(_route,recipient,_text,id,authorize){assert.equal(recipient,phone);await authorize();return {status:'delivered',providerReference:id};},async reconcile(){assert.fail('fresh fixture reply');}});if(!batch.claimed)return;}assert.fail('reply fixture did not drain');}
 async function review(id:string){
  // Each independent provider scenario starts a new logical quota window.
  await sql.query(`update fmat.conversation_budgets set minute_started_at=clock_timestamp()-interval '61 seconds',hour_started_at=clock_timestamp()-interval '61 minutes' where name='host:${host.id}';`);
  await turn('request '+id);const message=await turn('review');await deliver();const reference=message.text.match(/Review reference: ([a-f0-9-]{36})/u)?.[1];assert.ok(reference);return reference;
 }
 try{
  await sql.query(`insert into fmat.photon_receivers(project_id,receiver_id,enabled) values('${project}','${receiver}',true);`);
  const started=await service.start(host.credential,browser,{phone,idempotencyKey:randomUUID()});let code='';
  await dispatchLinkCodes(db,env,{async send(_route,recipient,text){assert.equal(recipient,phone);code=text.match(/code is (\d{6})/u)![1];return {status:'delivered',providerReference:randomUUID()};},async reconcile(){assert.fail('fresh fixture code');}});
  link=(await service.verify(host.credential,browser,{challengeId:started.challenge!.id,code,idempotencyKey:randomUUID()})).link!.id;await delay(5);
  const raced=await createProposal(),old=await review(raced);
  assert.match((await turn('yes')).text,/No decision was recorded/);
  const pid=Number((await holder.query(`begin;select pg_backend_pid();select id from fmat.requests where id='${raced}' for update;`)).split('\n')[0]);
  const incoming=await receive('approve '+old),waiting=dispatchPhotonInputs(db,env);let blocked=false;
  for(let n=0;n<100;n++){if(await sql.query(`select exists(select 1 from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid)));`)==='t'){blocked=true;break;}await delay(10);}assert.ok(blocked);
  await holder.query(`update fmat.requests set revision=revision+1 where id='${raced}';commit;`);assert.equal((await waiting).accepted,1);
  assert.match(await reply(incoming),/No new decision was recorded/);assert.equal(await sql.query(`select count(*) from fmat.host_approvals where request_id='${raced}';`),'0');
  const decline=await review(raced);assert.match((await turn('decline '+decline)).text,/Declined proposal/);assert.match((await turn('decline '+decline)).text,/already recorded.*declined/);
  assert.equal(await sql.query(`select count(*) from fmat.booking_attempts where request_id='${raced}';`),'0');
  await verifyBookingWorker(db,env,host.id,async()=>{
   const id=await createProposal(),reference=await review(id),approved=await turn('approve '+reference);assert.match(approved.text,/Approval recorded.*Booking is pending/);decisions++;
   // A replayed provider receipt and a new explicit retry both retain one effect.
   await receive('approve '+reference,approved.key);assert.equal((await dispatchPhotonInputs(db,env)).accepted,0);
   assert.match((await turn('approve '+reference)).text,/already recorded.*booking/);
   assert.equal(await sql.query(`select count(*) from fmat.booking_attempts where request_id='${id}';`),'1');
   assert.equal(await sql.query(`select count(*) from fmat.web_approval_decisions where request_id='${id}';`),'0');
   assert.equal(await sql.query(`select source from fmat.host_approvals where request_id='${id}';`),'verified_imessage');return id;
  });
  assert.ok(decisions>1,'multiple worker failure/recovery scenarios exercised channel approvals');
  await service.unlink(host.credential,browser,{linkId:link});
 }finally{
  await holder.query('rollback;');holder.close();
  await sql.query(cleanupFixtureJobsSql(`payload->>'inboxId' in(select id::text from fmat.photon_inbox where project_id='${project}')`));
  await sql.query(`delete from fmat.photon_proposal_decisions where link_id in(select id from fmat.photon_links where project_id='${project}');delete from fmat.photon_proposal_reviews where link_id in(select id from fmat.photon_links where project_id='${project}');delete from fmat.photon_replies where project_id='${project}';delete from fmat.photon_inbox where project_id='${project}';delete from fmat.conversation_grants where credential->>'linkId'='${link}';delete from fmat.conversation_scopes where host_id='${host.id}';delete from fmat.photon_links where project_id='${project}';delete from fmat.photon_link_challenges where project_id='${project}';delete from fmat.photon_receivers where project_id='${project}';`);sql.close();
 }
}
