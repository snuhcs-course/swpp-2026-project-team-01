import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AgentMailReplyTransport,type FrozenAgentMailReply} from '../../lib/server/agentmail/reply-transport.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
const env={AGENTMAIL_INBOX_ID:'agent@example.test',AGENTMAIL_API_KEY:'private-fixture-key'};
const now=Date.parse('2026-10-08T10:00:00Z');
const reply:FrozenAgentMailReply={id:'00000000-0000-4000-8000-000000000001',inboxId:env.AGENTMAIL_INBOX_ID,threadId:'thread-1',parentMessageId:'<parent/1@example.test>',recipient:'guest@example.test',text:'Your current proposal is ready to review.',firstAttemptAt:new Date(now).toISOString()};
const accepted={message_id:'<reply/1@example.test>',thread_id:reply.threadId};
const stored={...accepted,inbox_id:reply.inboxId,in_reply_to:reply.parentMessageId,from:'Assistant <agent@example.test>',to:['Guest <guest@example.test>'],cc:[],bcc:[],text:reply.text,labels:['sent']};
const allow=async()=>{};
const errorCode=(code:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===code;
test('AgentMail reply sends one immutable private-recipient request with stable idempotency and encoded parent',async()=>{
 const requests:{url:string;body:unknown;key:string|null}[]=[];let authorized=false;
 const transport=new AgentMailReplyTransport(env,async(url,init)=>{
  assert.equal(authorized,true);assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');assert.equal(init?.method,'POST');
  assert.equal(new Headers(init?.headers).get('authorization'),'Bearer private-fixture-key');
  requests.push({url:String(url),body:JSON.parse(String(init?.body)),key:new Headers(init?.headers).get('Idempotency-Key')});return Response.json(accepted);
 },()=>now);
 const result=await transport.send(reply,async()=>{authorized=true;});
 assert.deepEqual(result,{status:'accepted',messageId:accepted.message_id,threadId:reply.threadId});assert.equal(requests.length,1);
 assert.equal(requests[0].url,'https://api.agentmail.to/v0/inboxes/agent%40example.test/messages/%3Cparent%2F1%40example.test%3E/reply');
 assert.deepEqual(requests[0].body,{to:[reply.recipient],cc:[],bcc:[],reply_all:false,text:reply.text,track_opens:false});
 assert.equal(requests[0].key,'fmat-reply-'+reply.id);
 await transport.send({...reply},allow);assert.deepEqual(requests[1],requests[0]);
 assert.ok(!JSON.stringify(result).includes('private-fixture-key'));
});
test('AgentMail reply validates frozen input and current authority before any provider call',async()=>{
 let calls=0;const transport=new AgentMailReplyTransport(env,async()=>{calls++;return Response.json(accepted);},()=>now);
 for(const patch of [{recipient:'victim@example.test\r\nBcc:another@example.test'},{text:' '},{text:'x'.repeat(10001)},{id:'bad'},{parentMessageId:'..'},{parentMessageId:'.'},{firstAttemptAt:'2026-10-09T10:00:00Z'},{cc:['other@example.test']}])await assert.rejects(transport.send({...reply,...patch},allow),errorCode('INVALID_INPUT'));
 await assert.rejects(transport.send({...reply,inboxId:'other@example.test'},allow),errorCode('FORBIDDEN'));
 await assert.rejects(transport.send(reply,async()=>{throw new ApplicationError('FORBIDDEN',403);}),errorCode('FORBIDDEN'));
 await assert.rejects(new AgentMailReplyTransport({},async()=>{calls++;return Response.json(accepted);},()=>now).send(reply,allow),errorCode('CONFIGURATION_UNAVAILABLE'));
 assert.equal(calls,0);
});
test('AgentMail send never retries transport, HTTP, identity or malformed-response uncertainty',async()=>{
 for(const response of [()=>new Response(null,{status:409}),()=>new Response(null,{status:429}),()=>new Response(null,{status:500}),()=>new Response(null,{status:302}),()=>Response.json({message_id:accepted.message_id,thread_id:'other'}),()=>Response.json({...accepted,message_id:reply.parentMessageId}),()=>Response.json({}),()=>new Response('private error',{headers:{'content-type':'application/json'}}),()=>new Response(new Uint8Array([255]),{headers:{'content-type':'application/json'}}),()=>{throw Error('secret provider error');}]){
  let calls=0;const transport=new AgentMailReplyTransport(env,async()=>{calls++;return response();},()=>now);
  assert.deepEqual(await transport.send(reply,allow),{status:'uncertain',messageId:null});assert.equal(calls,1);
 }
});
test('AgentMail reply refuses sends outside the bounded idempotency window including authorization delays',async()=>{
 let calls=0,clock=now;const transport=new AgentMailReplyTransport(env,async()=>{calls++;return Response.json(accepted);},()=>clock);
 clock=now+23*60*60*1000;assert.equal((await transport.send(reply,allow)).status,'uncertain');assert.equal(calls,0);
 clock=now;assert.equal((await transport.send(reply,async()=>{clock+=23*60*60*1000;})).status,'uncertain');assert.equal(calls,0);
});
test('AgentMail readback requires the exact message, parent, recipient and frozen body and never claims delivery',async()=>{
 const transport=new AgentMailReplyTransport(env,async(url,init)=>{assert.equal(init?.method,'GET');assert.equal(init?.body,undefined);assert.equal(String(url),'https://api.agentmail.to/v0/inboxes/agent%40example.test/messages/%3Creply%2F1%40example.test%3E');return Response.json(stored);},()=>now);
 assert.deepEqual(await transport.inspect(reply,accepted.message_id,allow),{status:'accepted',messageId:accepted.message_id,threadId:reply.threadId});
 for(const patch of [{inbox_id:'other@example.test'},{message_id:'other'},{thread_id:'other'},{in_reply_to:'other'},{from:'other@example.test'},{to:['other@example.test']},{to:[reply.recipient,'other@example.test']},{cc:['other@example.test']},{bcc:['other@example.test']},{text:'changed'},{labels:[]},{labels:['sent','bounced']},{labels:['sent','draft']}]){
  assert.deepEqual(await new AgentMailReplyTransport(env,async()=>Response.json({...stored,...patch}),()=>now).inspect(reply,accepted.message_id,allow),{status:'uncertain',messageId:accepted.message_id});
 }
});
test('AgentMail missing and failed readback does not infer non-send or dispatch another message',async()=>{
 let calls=0;const transport=new AgentMailReplyTransport(env,async(_url,init)=>{calls++;assert.equal(init?.method,'GET');return new Response(null,{status:404});},()=>now);
 assert.deepEqual(await transport.inspect(reply,null,allow),{status:'uncertain',messageId:null});assert.equal(calls,0);
 assert.deepEqual(await transport.inspect(reply,accepted.message_id,allow),{status:'uncertain',messageId:accepted.message_id});assert.equal(calls,1);
 await assert.rejects(transport.inspect(reply,'..',allow),errorCode('INVALID_INPUT'));
 await assert.rejects(transport.inspect(reply,accepted.message_id,async()=>{throw new ApplicationError('FORBIDDEN',403);}),errorCode('FORBIDDEN'));assert.equal(calls,1);
});
test('AgentMail reply bounds streamed and declared responses and cancels stalled bodies',async t=>{
 let cancelled=false;const oversized=new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array(131073));},cancel(){cancelled=true;}});
 assert.equal((await new AgentMailReplyTransport(env,async()=>new Response(oversized,{headers:{'content-type':'application/json'}}),()=>now).send(reply,allow)).status,'uncertain');assert.equal(cancelled,true);
 assert.equal((await new AgentMailReplyTransport(env,async()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'131073'}}),()=>now).send(reply,allow)).status,'uncertain');
 t.mock.timers.enable({apis:['setTimeout']});cancelled=false;
 const stalled=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
 const result=new AgentMailReplyTransport(env,async()=>new Response(stalled,{headers:{'content-type':'application/json'}}),()=>now).send(reply,allow);
 await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(15000);assert.equal((await result).status,'uncertain');assert.equal(cancelled,true);
});
test('AgentMail deadline also aborts a send stalled before response headers without retrying',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0,aborted=false;
 const transport=new AgentMailReplyTransport(env,async(_url,init)=>{calls++;return new Promise<Response>((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>{aborted=true;reject(Error('timeout'));},{once:true});});},()=>now);
 const sent=transport.send(reply,allow);await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(15000);
 assert.deepEqual(await sent,{status:'uncertain',messageId:null});assert.equal(calls,1);assert.equal(aborted,true);
});
