import test from 'node:test';
import assert from 'node:assert/strict';
import {requireMessagingEnvironment} from '../../lib/server/config.ts';
import {ApplicationError,publicError} from '../../lib/server/errors.ts';
import {Database} from '../../lib/server/database/client.ts';
import {CloudflareEmail,type PreparedEmail} from '../../lib/server/email/cloudflare.ts';
import {BookingDelivery} from '../../lib/server/email/booking-delivery.ts';
import {ContactVerificationDelivery} from '../../lib/server/email/contact-delivery.ts';
import {RequesterRecoveryDelivery} from '../../lib/server/email/recovery-delivery.ts';
import {InvitationDelivery} from '../../lib/server/email/invitation-delivery.ts';
import {PhotonHandoffs} from '../../lib/server/photon/handoffs.ts';
import {PhotonTransport} from '../../lib/server/photon/transport.ts';
import {dispatchLinkCodes} from '../../lib/server/photon/delivery.ts';
import {dispatchPhotonReplies} from '../../lib/server/photon/replies.ts';
import {dispatchContactShares} from '../../lib/server/photon/contact-delivery.ts';
import {AgentMailReplyTransport,type FrozenAgentMailReply} from '../../lib/server/agentmail/reply-transport.ts';
import {dispatchRequesterEmailReply} from '../../lib/server/agentmail/replies.ts';
const id='00000000-0000-4000-8000-000000000001';
const base={TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64'),SUPABASE_URL:'https://database.example.test',SUPABASE_SECRET_KEY:'synthetic',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_EMAIL_FROM:'no-reply@findmeatime.com',CLOUDFLARE_EMAIL_API_TOKEN:'synthetic',PHOTON_PROJECT_ID:id,PHOTON_PROJECT_SECRET:'synthetic',AGENTMAIL_INBOX_ID:'inbox@example.test',AGENTMAIL_RECEIVER_ID:id,AGENTMAIL_API_KEY:'synthetic'};
const denied:NodeJS.ProcessEnv[]=[{VERCEL_ENV:'preview'},{VERCEL_ENV:'development'},{VERCEL_ENV:'custom'},{VERCEL:'1'},{VERCEL_URL:'preview.example.test'},{VERCEL_DEPLOYMENT_ID:'private-deployment'},{VERCEL_ENV:''},{VERCEL_ENV:' production'},{VERCEL_ENV:'production',VERCEL_TARGET_ENV:'staging'},{VERCEL_TARGET_ENV:'production'}];
const unavailable=(error:unknown)=>error instanceof ApplicationError&&error.code==='CONFIGURATION_UNAVAILABLE'&&error.status===503;
const email:PreparedEmail={id,accountId:base.CLOUDFLARE_ACCOUNT_ID,message:{from:'no-reply@findmeatime.com',to:'guest@example.test',subject:'Test',html:'Test',text:'Test'}};
const reply:FrozenAgentMailReply={id,inboxId:base.AGENTMAIL_INBOX_ID,threadId:'thread',parentMessageId:'parent',recipient:'guest@example.test',text:'Test',firstAttemptAt:new Date().toISOString()};

test('deployment admission rejects non-production or ambiguous metadata with sanitized errors',()=>{
 for(const env of denied){assert.throws(()=>requireMessagingEnvironment(env),unavailable);try{requireMessagingEnvironment(env);}catch(error){assert.equal(publicError(error,id).body.error.message,'This service is not configured yet.');}}
 for(const env of [{},{VERCEL_ENV:'production'},{VERCEL:'1',VERCEL_ENV:'production',VERCEL_TARGET_ENV:'production'}])assert.doesNotThrow(()=>requireMessagingEnvironment(env));
});

test('all messaging workers reject before database or injected transport access',async()=>{
 let calls=0;const forbidden=async()=>{calls++;throw new Error('Unexpected I/O');};
 for(const marker of denied){
  const env={...base,...marker},db=new Database(env,forbidden),provider=new CloudflareEmail(base,forbidden);
  for(const Worker of [BookingDelivery,ContactVerificationDelivery,RequesterRecoveryDelivery,InvitationDelivery]){
   const worker=new Worker(db,env,provider);
   await assert.rejects(worker.run(),unavailable);
   await assert.rejects(worker.process({}),unavailable);
  }
  await assert.rejects(dispatchLinkCodes(db,env,{send:forbidden,reconcile:forbidden}),unavailable);
  await assert.rejects(dispatchPhotonReplies(db,env,{send:forbidden,reconcile:forbidden}),unavailable);
  const handoffs=new PhotonHandoffs(db,env,{send:forbidden,reconcile:forbidden});
  await assert.rejects(handoffs.prepare(),unavailable);
  await assert.rejects(handoffs.dispatch(),unavailable);
  await assert.rejects(dispatchContactShares(db,env,{shareContact:forbidden}),unavailable);
  await assert.rejects(dispatchRequesterEmailReply(db,env,{send:forbidden}),unavailable);
 }
 assert.equal(calls,0);
});

test('direct messaging transports reject before HTTP, gRPC or authorization callbacks',async()=>{
 let calls=0;const forbidden=async()=>{calls++;throw new Error('Unexpected provider access');};
 for(const marker of denied){
  const env={...base,...marker};
  await assert.rejects(new CloudflareEmail(env,forbidden).send(email),unavailable);
  const photon=new PhotonTransport(env,forbidden,()=>{calls++;throw new Error('Unexpected gRPC');});
  const route={line:'shared',spaceId:'any;-;+15550100001'};
  await assert.rejects(photon.prepare('+15550100001'),unavailable);
  await assert.rejects(photon.send(route,'+15550100001','Test',id,forbidden),unavailable);
  await assert.rejects(photon.shareContact(route,'+15550100001',forbidden),unavailable);
  await assert.rejects(photon.reconcile(route,'saved-reference'),unavailable);
  const agentmail=new AgentMailReplyTransport(env,forbidden);
  await assert.rejects(agentmail.send(reply,forbidden),unavailable);
  await assert.rejects(agentmail.inspect(reply,'saved-reference',forbidden),unavailable);
 }
 assert.equal(calls,0);
});

test('production and standalone workers retain the normal claim boundary and transport evidence checks',async()=>{
 for(const marker of [{},{VERCEL:'1',VERCEL_ENV:'production',VERCEL_TARGET_ENV:'production'}]){
  const env={...base,...marker};let claims=0,sends=0;
  const db=new Database(env,async(_url,init)=>{assert.equal(JSON.parse(String(init?.body)).p_operation,'claim');claims++;return Response.json({job:null});});
  const provider=new CloudflareEmail(env,async()=>{sends++;return Response.json({success:true});});
  for(const Worker of [BookingDelivery,ContactVerificationDelivery,RequesterRecoveryDelivery,InvitationDelivery])assert.equal((await new Worker(db,env,provider).run()).claimed,0);
  assert.equal(claims,4);assert.equal(sends,0);
  const operations:string[]=[];
  const handoffDb=new Database(env,async(_url,init)=>{const operation=JSON.parse(String(init?.body)).p_operation;operations.push(operation);return Response.json(operation==='prepare'?{outcome:'idle'}:{action:'idle'});});
  const handoffs=new PhotonHandoffs(handoffDb,env,{async send(){assert.fail('idle worker must not send');},async reconcile(){assert.fail('idle worker must not reconcile');}});
  assert.deepEqual(await handoffs.prepare(),{handoff:0,limited:0,revoked:0});
  assert.deepEqual(await handoffs.dispatch(),{claimed:0,suppressed:0,recorded:0});
  assert.deepEqual(operations,['prepare','claim']);
  assert.equal((await provider.send(email)).outcome,'uncertain');assert.equal(sends,1);
 }
});
