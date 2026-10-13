import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {agentmailWebhook} from '../../lib/server/agentmail/ingress.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
const key=Buffer.alloc(32,8),env:NodeJS.ProcessEnv={NODE_ENV:'test',AGENTMAIL_INBOX_ID:'fixture@agentmail.to',AGENTMAIL_RECEIVER_ID:'10000000-0000-4000-8000-000000000001',AGENTMAIL_WEBHOOK_SECRET:'whsec_'+key.toString('base64')};
function signed(event_type='message.received'){
 const raw=JSON.stringify({event_type,event_id:'event-1',message:{inbox_id:env.AGENTMAIL_INBOX_ID,thread_id:'thread-1',message_id:'message-1',timestamp:'2026-10-08T00:00:00Z',text:'private text'}}),timestamp=String(Math.floor(Date.now()/1000));
 return new Request('https://release.invalid/api/providers/agentmail',{method:'POST',body:raw,headers:{'content-type':'application/json','svix-id':'delivery-1','svix-timestamp':timestamp,'svix-signature':'v1,'+createHmac('sha256',key).update(`delivery-1.${timestamp}.${raw}`).digest('base64')}});
}
test('AgentMail waits for committed receipt and returns no private response state',async()=>{
 let release!:()=>void,settled=false;const gate=new Promise<void>(resolve=>{release=resolve;});
 const result=agentmailWebhook(signed(),{env,database:{async rpc(name,input){assert.equal(name,'fmat_agentmail_ingress');assert.equal(input.p_receiver_id,env.AGENTMAIL_RECEIVER_ID);assert.ok(!JSON.stringify(input).includes('private text'));await gate;return {private:'do not expose'};}}}).then(r=>{settled=true;return r;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);release();const response=await result;assert.equal(response.status,200);assert.equal(await response.text(),'');assert.equal(response.headers.get('cache-control'),'no-store');
});
test('AgentMail failed or lost commit returns retryable failure without leaking state',async()=>{
 const response=await agentmailWebhook(signed(),{env,database:{async rpc(){throw new ApplicationError('PROVIDER_UNAVAILABLE',503);}}});assert.equal(response.status,503);assert.ok(!(await response.text()).includes('fixture@'));
 const conflict=await agentmailWebhook(signed(),{env,database:{async rpc(){throw new ApplicationError('IDEMPOTENCY_CONFLICT',409);}}});assert.equal(conflict.status,409);
});
test('Unsupported authenticated events still check the current receiver fence',async()=>{
 let called=false;const response=await agentmailWebhook(signed('message.received.spam'),{env,database:{async rpc(_name,input){called=true;assert.equal(input.p_input,null);return {};}}});assert.equal(called,true);assert.equal(response.status,204);
 const disabled=await agentmailWebhook(signed('message.sent'),{env,database:{async rpc(){throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);}}});assert.equal(disabled.status,503);
 const missing=await agentmailWebhook(signed(),{env:{NODE_ENV:'test'},database:{async rpc(){assert.fail('missing configuration');}}});assert.equal(missing.status,503);
});
