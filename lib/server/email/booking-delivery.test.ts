import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {BookingDelivery} from './booking-delivery.ts';
import {CloudflareEmail} from './cloudflare.ts';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {TokenCipher} from '../calendar/encryption.ts';
const id='00000000-0000-4000-8000-000000000001';
const lease={workerId:'fixture',jobId:'00000000-0000-4000-8000-000000000002',leaseToken:'00000000-0000-4000-8000-000000000003'};
const env={APP_ORIGIN:'https://release.findmeatime.com',TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64'),CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_EMAIL_FROM:'no-reply@findmeatime.com',CLOUDFLARE_EMAIL_API_TOKEN:'synthetic',SUPABASE_URL:'https://database.example.test',SUPABASE_SECRET_KEY:'synthetic'};
const receipt={confirmedAt:'2030-01-01T00:00:00Z',title:'Review',purpose:'Discuss',start:'2030-01-02T10:00:00Z',end:'2030-01-02T10:30:00Z',timezone:'UTC',mode:'online',location:'https://meet.example.test/room',participants:[{email:'guest@example.test'}],calendarUrl:null,organizer:{email:'organizer@example.test'}};
type Fault='none'|'prepare_ack'|'dispatch_ack'|'record_ack'|'provider_lost'|'lease_expired'|'recipient_changed';
// This fixture tests orchestration against durable RPC acknowledgements. SQL
// authorization, transactions and locking are covered separately by integration tests.
function fixture(fault:Fault='none'){
 let phase='pending',encryptedPrepared:string|null=null,receiptTokenHash:string|null=null,posts=0,used=false;
 const operations:string[]=[],messages:Record<string,string>[]=[];
 const database=new Database(env,async(_url,init)=>{
  const {p_operation:op,p_input:input}=JSON.parse(String(init?.body));operations.push(op);
  if(op==='claim')return Response.json({job:lease});
  if(op==='load'||op==='prepare'){
   if(op==='prepare'){
    assert.equal(phase,'pending');encryptedPrepared=input.encryptedPrepared;receiptTokenHash=input.receiptTokenHash;phase='prepared';
    if(fault==='prepare_ack'&&!used){used=true;throw new Error('lost prepare acknowledgement');}
   }
   return Response.json(['pending','prepared'].includes(phase)?{phase,id,requestId:id,audience:'requester',recipient:'guest@example.test',receipt,basis:'b'.repeat(64),expiresAt:'2030-02-01T00:00:00Z',encryptedPrepared}:{phase});
  }
  if(op==='dispatch'){
   assert.equal(phase,'prepared');phase=fault==='recipient_changed'?'suppressed':'dispatched';
   if(fault==='dispatch_ack'&&!used){used=true;throw new Error('lost dispatch acknowledgement');}
   return Response.json(phase==='suppressed'?{phase}:{phase:'dispatch',id,encryptedPrepared});
  }
  if(op==='record'){
   if(fault==='lease_expired'&&!used){used=true;return Response.json({message:'LEASE_LOST'},{status:409});}
   assert.equal(phase,'dispatched');phase=input.outcome;
   if(fault==='record_ack'&&!used){used=true;throw new Error('lost completion acknowledgement');}
   return Response.json({recorded:true});
  }
  if(op==='retry'||op==='complete')return Response.json({ok:true});
  throw new Error('Unexpected RPC');
 });
 const provider=new CloudflareEmail(env,async(_url,init)=>{
  assert.equal(phase,'dispatched');posts++;messages.push(JSON.parse(String(init?.body)));
  if(fault==='provider_lost')throw new Error('provider accepted but response lost');
  return Response.json({success:true,errors:[],result:{message_id:'message',delivered:[],queued:['guest@example.test'],permanent_bounces:[],suppressed_recipients:[]}});
 });
 return {worker:new BookingDelivery(database,env,provider),operations,messages,state:()=>({phase,encryptedPrepared,receiptTokenHash,posts})};
}
test('Email worker freezes encrypted content and a separate receipt token before its only send',async()=>{
 const f=fixture();assert.deepEqual(await f.worker.run(),{claimed:1,outcome:'sent'});
 const state=f.state();assert.equal(state.posts,1);assert.ok(state.encryptedPrepared);assert.ok(!state.encryptedPrepared.includes('guest@example.test'));
 const frozen=new TokenCipher(env).open(state.encryptedPrepared,'booking-email:'+id) as {message:Record<string,string>};assert.deepEqual(f.messages,[frozen.message]);
 const token=frozen.message.text.match(/#receipt=([A-Za-z0-9_-]{43})/)?.[1];assert.ok(token);assert.equal(createHash('sha256').update(token).digest('hex'),state.receiptTokenHash);
 assert.equal(await f.worker.process(lease),'sent');assert.equal(f.state().posts,1);
 assert.deepEqual(f.operations.slice(0,5),['claim','load','prepare','dispatch','record']);
});
test('Lost preparation acknowledgement retries using the saved ciphertext and token',async()=>{
 const f=fixture('prepare_ack');assert.equal(await f.worker.process(lease),'retry');const prepared=f.state();assert.equal(prepared.posts,0);
 assert.equal(await f.worker.process(lease),'sent');assert.equal(f.state().encryptedPrepared,prepared.encryptedPrepared);assert.equal(f.state().receiptTokenHash,prepared.receiptTokenHash);assert.equal(f.state().posts,1);
});
test('Lost dispatch acknowledgement cannot grant another send',async()=>{
 const f=fixture('dispatch_ack');assert.equal(await f.worker.process(lease),'uncertain');assert.equal(f.state().posts,0);
 assert.equal(await f.worker.process(lease),'uncertain');assert.equal(f.state().posts,0);
});
test('Lost provider response and expired completion lease retain uncertainty without resending',async()=>{
 for(const fault of ['provider_lost','lease_expired'] as const){const f=fixture(fault);assert.equal(await f.worker.process(lease),fault==='lease_expired'?'lease_lost':'uncertain');assert.equal(await f.worker.process(lease),'uncertain');assert.equal(f.state().posts,1);}
});
test('Lost committed completion response recovers sent status without resending',async()=>{
 const f=fixture('record_ack');assert.equal(await f.worker.process(lease),'sent');assert.equal(f.state().posts,1);assert.equal(await f.worker.process(lease),'sent');assert.equal(f.state().posts,1);
});
test('Recipient revocation at dispatch suppresses delivery before provider access',async()=>{
 const f=fixture('recipient_changed');assert.equal(await f.worker.process(lease),'suppressed');assert.equal(f.state().posts,0);
});
test('Missing provider configuration never claims delivery work',async()=>{
 let calls=0;const database=new Database(env,async()=>{calls++;throw new Error('must not claim');});
 await assert.rejects(new BookingDelivery(database,{...env,CLOUDFLARE_EMAIL_API_TOKEN:''}).run(),ApplicationError);assert.equal(calls,0);
});
