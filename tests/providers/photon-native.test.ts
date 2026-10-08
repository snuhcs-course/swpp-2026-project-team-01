import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {readFileSync} from 'node:fs';

// Compatibility spike against the installed, bundled adapter. Do not import
// eve's private implementation into production. A version change must rerun
// these observations before replacing the application-owned receiver/outbox.
test('eve 0.71.3 Photon adapter acknowledges before downstream commit and cannot pin a send identity',async()=>{
  assert.equal(JSON.parse(readFileSync('node_modules/eve/package.json','utf8')).version,'0.71.3');
  const file=pathToFileURL(resolve('node_modules/eve/dist/src/compiled/@photon-ai/chat-adapter-imessage/index.js')).href;
  const {createiMessageAdapter}=await import(file);
  const secret='synthetic-photon-compatibility-secret';
  const adapter=createiMessageAdapter({webhookSecret:secret,credentials:()=>({projectId:'fixture',projectSecret:'fixture'}),
    logger:{debug(){},info(){},warn(){},error(){},child(){return this;}}});
  let finish!:()=>void,committed=false,invocations=0;
  const pending=new Promise<void>(r=>{finish=()=>{committed=true;r();};});
  // Runtime-only injection prevents all network and model calls while exercising
  // the actual webhook verification/normalization/acknowledgment implementation.
  adapter.chat={processMessage(){invocations++;return pending;}};
  const space={id:'any;-;+15550100001',platform:'imessage',type:'dm',phone:'shared'};
  const body=JSON.stringify({event:'messages',space,message:{id:'native-probe',platform:'imessage',direction:'inbound',
    timestamp:new Date().toISOString(),sender:{id:'+15550100001',platform:'imessage'},space,content:{type:'text',text:'Synthetic preference'}}});
  const timestamp=String(Math.floor(Date.now()/1000));
  const request=()=>new Request('https://fixture.invalid',{method:'POST',body,headers:{'x-spectrum-timestamp':timestamp,
    'x-spectrum-signature':'v0='+createHmac('sha256',secret).update(`v0:${timestamp}:${body}`).digest('hex')}});
  assert.equal((await adapter.handleWebhook(request())).status,200);
  assert.equal(invocations,1);assert.equal(committed,false,'native 200 is not a durable application commit');
  const forged=request();forged.headers.set('x-spectrum-signature','v0='+('0'.repeat(64)));
  assert.equal((await adapter.handleWebhook(forged)).status,401);assert.equal(invocations,1,'native signature rejection precedes downstream invocation');
  assert.equal((await adapter.handleWebhook(request())).status,200);assert.equal(invocations,2,'adapter delegates duplicate handling downstream');
  finish();await pending;
  const calls:unknown[][]=[];
  adapter.requireSpace=async()=>({send:async(...args:unknown[])=>{calls.push(args);return {id:`provider-${calls.length}`};}});
  const first=await adapter.postMessage('thread','Synthetic response');
  const second=await adapter.postMessage('thread','Synthetic response');
  assert.notEqual(first.id,second.id);assert.deepEqual(calls.map(c=>c.length),[1,1],'send only receives generated content, not our durable identity');
});

test('native acknowledgment cannot be turned into a failed-commit response after downstream rejection',async()=>{
 const file=pathToFileURL(resolve('node_modules/eve/dist/src/compiled/@photon-ai/chat-adapter-imessage/index.js')).href;
 const {createiMessageAdapter}=await import(file),secret='synthetic-native-failure-secret';
 const adapter=createiMessageAdapter({webhookSecret:secret,credentials:()=>({projectId:'fixture',projectSecret:'fixture'}),logger:{debug(){},info(){},warn(){},error(){},child(){return this;}}});
 let reject!:()=>void,invocations=0;
 const commit=new Promise<void>((_resolve,fail)=>{reject=()=>fail(new Error('synthetic commit unavailable'));});
 const failed=assert.rejects(commit,/synthetic commit unavailable/);
 adapter.chat={processMessage(){invocations++;return commit;}};
 const timestamp=String(Math.floor(Date.now()/1000)),space={id:'any;-;+15550100001',platform:'imessage',type:'dm',phone:'shared'};
 const body=JSON.stringify({event:'messages',space,message:{id:'native-commit-failure',platform:'imessage',direction:'inbound',timestamp:new Date().toISOString(),sender:{id:'+15550100001',platform:'imessage'},space,content:{type:'text',text:'Synthetic preference'}}});
 const request=()=>new Request('https://fixture.invalid',{method:'POST',body,headers:{'x-spectrum-timestamp':timestamp,'x-spectrum-signature':'v0='+createHmac('sha256',secret).update(`v0:${timestamp}:${body}`).digest('hex')}});
 const response=await adapter.handleWebhook(request());assert.equal(response.status,200);reject();await failed;assert.equal(response.status,200);
 assert.equal((await adapter.handleWebhook(request())).status,200);assert.equal(invocations,2,'redelivery still needs application-owned durable deduplication');
});
