import {test} from 'node:test';
import assert from 'node:assert/strict';
import {agentMailRawMessage} from '../../lib/server/agentmail/raw-message.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
const env={AGENTMAIL_INBOX_ID:'inbox@example.test',AGENTMAIL_API_KEY:'fixture-secret'},input={inboxId:env.AGENTMAIL_INBOX_ID,messageId:'<message@example.test>'};
const raw=Buffer.from('From: guest@example.test\r\n\r\nBody\r\n');
const meta=()=>({message_id:input.messageId,size:raw.length,download_url:'https://cdn.agentmail.to/raw?signature=private',expires_at:new Date(Date.now()+60_000).toISOString()});
const code=(c:string)=>(e:unknown)=>e instanceof ApplicationError&&e.code===c;
test('Raw message download pins both origins and keeps API credentials off the CDN',async()=>{
 let count=0;const result=await agentMailRawMessage(input,{env,fetcher:async(url,init)=>{assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');count++;if(count===1){assert.ok(String(url).startsWith('https://api.agentmail.to/v0/inboxes/'));assert.equal(new Headers(init?.headers).get('authorization'),'Bearer fixture-secret');return Response.json(meta());}assert.equal(String(url),meta().download_url);assert.equal(new Headers(init?.headers).get('authorization'),null);return new Response(raw);}});assert.equal(count,2);assert.deepEqual(result,raw);
});
test('Raw message download rejects changed IDs, expired URLs and unsafe origins without fetching them',async()=>{
 for(const patch of [{message_id:'other'},{expires_at:'2020-01-01T00:00:00Z'},{download_url:'http://cdn.agentmail.to/a'},{download_url:'https://cdn.agentmail.to.evil.test/a'},{download_url:'https://cdn.agentmail.to@evil.test/a'},{download_url:'https://user:pass@cdn.agentmail.to/a'},{size:2_097_153}]){let calls=0;await assert.rejects(agentMailRawMessage(input,{env,fetcher:async()=>{calls++;return Response.json({...meta(),...patch});}}),code('message_id'in patch?'IDEMPOTENCY_CONFLICT':'PROVIDER_UNAVAILABLE'));assert.equal(calls,1);}
});
test('Raw message download rejects size mismatch, malformed metadata and redirects',async()=>{
 for(const response of [new Response('bad',{headers:{'content-type':'application/json'}}),new Response(null,{status:302}),Response.json({...meta(),size:0})])await assert.rejects(agentMailRawMessage(input,{env,fetcher:async()=>response}),code('PROVIDER_UNAVAILABLE'));
 let count=0;await assert.rejects(agentMailRawMessage(input,{env,fetcher:async()=>++count===1?Response.json(meta()):new Response('short')}),code('PROVIDER_UNAVAILABLE'));
});
test('Raw message download cancels a stalled CDN body at the shared deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let count=0,cancelled=false;const stream=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
 const pending=agentMailRawMessage(input,{env,fetcher:async()=>++count===1?Response.json(meta()):new Response(stream)});await new Promise(resolve=>setImmediate(resolve));
 const rejected=assert.rejects(pending,code('PROVIDER_UNAVAILABLE'));t.mock.timers.tick(10_000);await rejected;assert.equal(cancelled,true);
});
