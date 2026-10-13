import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudflareEmail,type PreparedEmail} from './cloudflare.ts';
const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_EMAIL_FROM:'no-reply@findmeatime.com',CLOUDFLARE_EMAIL_API_TOKEN:'synthetic-token'};
const email:PreparedEmail={id:'00000000-0000-4000-8000-000000000001',accountId:env.CLOUDFLARE_ACCOUNT_ID,message:{from:'no-reply@findmeatime.com',to:'guest@example.test',subject:'Confirmed',html:'<p>Confirmed</p>',text:'Confirmed'}};
const accepted={success:true,errors:[],result:{message_id:'synthetic-message',delivered:[],queued:[email.message.to],permanent_bounces:[],suppressed_recipients:[]}};
test('Cloudflare sends the frozen message once and requires recipient acceptance evidence',async()=>{
 let calls=0;
 const provider=new CloudflareEmail(env,async(url,init)=>{
  calls++;assert.equal(url,`https://api.cloudflare.com/client/v4/accounts/${email.accountId}/email/sending/send`);
  assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');
  const headers=new Headers(init?.headers);assert.equal(headers.get('authorization'),'Bearer '+env.CLOUDFLARE_EMAIL_API_TOKEN);assert.equal(headers.has('Idempotency-Key'),false);
  assert.deepEqual(JSON.parse(String(init?.body)),email.message);
  assert.ok(init?.signal instanceof AbortSignal);
  return Response.json(accepted);
 });
 assert.deepEqual(await provider.send(email),{outcome:'sent',providerReference:'synthetic-message'});assert.equal(calls,1);
});
test('Cloudflare delivered evidence applies only to the frozen single recipient',async()=>{
 for(const delivered of [[email.message.to.toUpperCase()],['someone@example.test']]){
  let calls=0;const provider=new CloudflareEmail(env,async()=>{calls++;return Response.json({...accepted,result:{...accepted.result,queued:[],delivered}});});
  assert.equal((await provider.send(email)).outcome,delivered[0].toLowerCase()===email.message.to?'sent':'uncertain');assert.equal(calls,1);
 }
 let calls=0;const provider=new CloudflareEmail(env,async()=>{calls++;return Response.json(accepted);});
 for(const message of [{...email.message,to:[email.message.to,'other@example.test']},{...email.message,cc:['other@example.test']},{...email.message,bcc:['other@example.test']}])await assert.rejects(provider.send({...email,message}));
 assert.equal(calls,0,'partial multi-recipient acceptance is prevented before dispatch');
});
test('Missing evidence and unknown errors never become sent and are never retried',async()=>{
 const cases=[Response.json({success:true}),Response.json({...accepted,result:{...accepted.result,message_id:undefined}}),Response.json({...accepted,result:{...accepted.result,queued:['other@example.test']}}),new Response('invalid json'),new Response('x'.repeat(262145)),Response.json({success:false,errors:[{code:99999}]},{status:400}),Response.json({success:false,errors:[{code:10001}]},{status:500}),new Response(null,{status:204})];
 for(const response of cases){let calls=0;const provider=new CloudflareEmail(env,async()=>{calls++;return response;});assert.equal((await provider.send(email)).outcome,'uncertain');assert.equal(calls,1);}
 let calls=0;const provider=new CloudflareEmail(env,async()=>{calls++;throw new Error('lost response');});
 assert.equal((await provider.send(email)).outcome,'uncertain');assert.equal(calls,1);
});
test('Suppression and permanent bounce override a queued recipient',async()=>{
 for(const [field,outcome] of [['suppressed_recipients','suppressed'],['permanent_bounces','failed']] as const){
  const provider=new CloudflareEmail(env,async()=>Response.json({...accepted,result:{...accepted.result,[field]:['GUEST@example.test']}}));
  assert.equal((await provider.send(email)).outcome,outcome);
 }
 const provider=new CloudflareEmail(env,async()=>Response.json({success:false,errors:[{code:10102}]},{status:403}));
 assert.deepEqual(await provider.send(email),{outcome:'failed',reason:'provider_rejected'});
});
test('Invalid sender, missing configuration and changed account cannot send',async()=>{
 let calls=0;const fetcher:typeof fetch=async()=>{calls++;return Response.json(accepted);};
 for(const config of [{...env,CLOUDFLARE_EMAIL_API_TOKEN:''},{...env,CLOUDFLARE_EMAIL_FROM:'fallback@example.test'},{...env,CLOUDFLARE_ACCOUNT_ID:'b'.repeat(32)}])await assert.rejects(new CloudflareEmail(config,fetcher).send(email));
 await assert.rejects(new CloudflareEmail(env,fetcher).send({...email,message:{...email.message,subject:'Injected\r\nHeader'}}));assert.equal(calls,0);
});
