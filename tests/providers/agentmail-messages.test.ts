import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AgentMailMessages} from '../../lib/server/agentmail/messages.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
const env={AGENTMAIL_INBOX_ID:'inbox@example.test',AGENTMAIL_API_KEY:'fixture-secret'};
const receipt={inboxId:env.AGENTMAIL_INBOX_ID,threadId:'thread-1',messageId:'<id/1@example.test>',occurredAt:'2026-10-08T00:00:00Z'};
const value={inbox_id:receipt.inboxId,thread_id:receipt.threadId,message_id:receipt.messageId,timestamp:receipt.occurredAt,labels:['received'],from:'Requester <guest@example.test>',to:['inbox@example.test'],text:'Full body with quoted history',extracted_text:'New scheduling text',headers:{'Authentication-Results':'forged; dmarc=pass'},html:'<script>private</script>',preview:'incomplete'};
const code=(expected:string)=>(e:unknown)=>e instanceof ApplicationError&&e.code===expected;
const service=(patch:Record<string,unknown>={})=>new AgentMailMessages(env,async()=>Response.json({...value,...patch}));
test('AgentMail full read pins origin and identity and projects only untrusted claims and new text',async()=>{
 const reader=new AgentMailMessages(env,async(url,init)=>{assert.equal(String(url),'https://api.agentmail.to/v0/inboxes/inbox%40example.test/messages/%3Cid%2F1%40example.test%3E');assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer fixture-secret');return Response.json(value);});
 const result=await reader.get(receipt);assert.equal(result.senderClaim,'guest@example.test');assert.deepEqual(result.content,{status:'available',text:'New scheduling text',source:'extracted_text'});assert.ok(!JSON.stringify(result).includes('dmarc'));assert.ok(!JSON.stringify(result).includes('script'));assert.ok(!JSON.stringify(result).includes('incomplete'));
});
test('AgentMail does not infer blank or truncated content and never substitutes preview/HTML or falls back from empty extraction',async()=>{
 for(const [patch,reason]of [[{extracted_text:undefined,text:undefined},'missing_text'],[{extracted_text:''},'empty_text'],[{extracted_text:'x'.repeat(10_001)},'text_too_long']] as const)assert.deepEqual((await service(patch).get(receipt)).content,{status:'unavailable',reason});
 assert.deepEqual((await service({extracted_text:undefined}).get(receipt)).content,{status:'available',text:value.text,source:'text'});
});
test('AgentMail rejects changed identities, restricted labels and malformed sender evidence',async()=>{
 for(const patch of [{inbox_id:'other@example.test'},{thread_id:'other'},{message_id:'other'},{timestamp:'2026-10-09T00:00:00Z'}])await assert.rejects(service(patch).get(receipt),code('IDEMPOTENCY_CONFLICT'));
 for(const labels of [[],['sent'],['received','spam'],['received','blocked'],['received','unauthenticated'],['received','trash']])await assert.rejects(service({labels}).get(receipt),code('FORBIDDEN'));
 for(const from of ['a@example.test,b@example.test','a@example.test, <b@example.test>','a@example.test\r\nBcc: evil@example.test','ambiguous'])await assert.rejects(service({from}).get(receipt),code('PROVIDER_UNAVAILABLE'));
 await assert.rejects(service().get({...receipt,inboxId:'another@example.test'}),code('INVALID_INPUT'));
});
test('AgentMail read failures are sanitized and HTTP redirects are never followed',async()=>{
 for(const status of [401,403,429,500,302])await assert.rejects(new AgentMailMessages(env,async()=>new Response('private provider error',{status})).get(receipt),code('PROVIDER_UNAVAILABLE'));
 await assert.rejects(new AgentMailMessages(env,async()=>new Response(null,{status:404})).get(receipt),code('NOT_FOUND'));
 await assert.rejects(new AgentMailMessages(env,async()=>{throw new Error('private secret');}).get(receipt),code('PROVIDER_UNAVAILABLE'));
 for(const response of [new Response('{}'),new Response('invalid',{headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'application/json','content-length':'2097153'}}),new Response(new Uint8Array([0xff]),{headers:{'content-type':'application/json'}})])await assert.rejects(new AgentMailMessages(env,async()=>response).get(receipt),code('PROVIDER_UNAVAILABLE'));
});
test('AgentMail streamed response limit cancels oversized bodies without trusting Content-Length',async()=>{
 let cancelled=false;const stream=new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array(1_048_576));},cancel(){cancelled=true;}});
 await assert.rejects(new AgentMailMessages(env,async()=>new Response(stream,{headers:{'content-type':'application/json'}})).get(receipt),code('PROVIDER_UNAVAILABLE'));assert.equal(cancelled,true);
});

test('AgentMail body deadline cancels a stalled successful response',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let cancelled=false;
 const stream=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
 const read=new AgentMailMessages(env,async()=>new Response(stream,{headers:{'content-type':'application/json'}})).get(receipt);
 await new Promise(resolve=>setImmediate(resolve));
 const rejected=assert.rejects(read,code('PROVIDER_UNAVAILABLE'));t.mock.timers.tick(10_000);await rejected;assert.equal(cancelled,true);
});
