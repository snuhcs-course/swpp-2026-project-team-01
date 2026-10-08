import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {dispatchRequesterEmailReply} from '../../lib/server/agentmail/replies.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import type {Database} from '../../lib/server/database/client.ts';
import {POST} from '../../apps/web/app/api/internal/agentmail/replies/route.ts';
const env={AGENTMAIL_INBOX_ID:'replies@example.test',AGENTMAIL_RECEIVER_ID:randomUUID(),AGENTMAIL_API_KEY:'fixture-key'};
const snapshot=()=>({id:randomUUID(),inboxId:env.AGENTMAIL_INBOX_ID,threadId:'thread',parentMessageId:'incoming',recipient:'guest@example.test',text:'Private answer',firstAttemptAt:new Date().toISOString()});

test('Requester reply worker rechecks authority before a single frozen send and records only acceptance',async()=>{
 const reply=snapshot(),leaseToken=randomUUID(),operations:string[]=[];
 const db:Pick<Database,'rpc'>={rpc:async(name,input)=>{assert.equal(name,'fmat_requester_email_reply_delivery');assert.equal(input.p_inbox_id,env.AGENTMAIL_INBOX_ID);assert.equal(input.p_receiver_id,env.AGENTMAIL_RECEIVER_ID);operations.push(String(input.p_operation));
  if(input.p_operation==='claim')return {action:'send',receiverId:env.AGENTMAIL_RECEIVER_ID,leaseToken,reply};
  if(input.p_operation==='finish')assert.deepEqual(input.p_input,{replyId:reply.id,leaseToken,status:'accepted',messageId:'outgoing',threadId:'thread'});return {};
 }};
 const result=await dispatchRequesterEmailReply(db,env,{send:async(input,authorize)=>{assert.deepEqual(input,reply);await authorize();operations.push('HTTP');return {status:'accepted',messageId:'outgoing',threadId:'thread'};}});
 assert.deepEqual(result,{claimed:1,outcome:'accepted'});assert.deepEqual(operations,['claim','authorize','authorize','HTTP','finish']);
});
test('Requester reply worker does no send for idle, suppressed, invalid config or denied authority',async()=>{
 const forbiddenSend={send:async()=>{assert.fail('must not send');}};
 for(const action of ['idle','suppressed'])assert.deepEqual(await dispatchRequesterEmailReply({rpc:async()=>({action})},env,forbiddenSend),{claimed:0,outcome:action});
 await assert.rejects(dispatchRequesterEmailReply({rpc:async()=>{assert.fail('must not claim');}},{...env,AGENTMAIL_API_KEY:undefined},forbiddenSend));
 for(const deny of ['UNAUTHORIZED','FORBIDDEN','NOT_FOUND','BOOKING_LEASE_LOST'] as const){
  let finish:unknown;const reply=snapshot();
  const result=await dispatchRequesterEmailReply({rpc:async(_,input)=>{if(input.p_operation==='claim')return {action:'send',receiverId:env.AGENTMAIL_RECEIVER_ID,leaseToken:randomUUID(),reply};if(input.p_operation==='authorize')throw new ApplicationError(deny,deny==='BOOKING_LEASE_LOST'?409:403);finish=input.p_input;return {};}},env,forbiddenSend);
  assert.equal(result.outcome,deny==='BOOKING_LEASE_LOST'?'lease_lost':'suppressed');
  if(deny==='BOOKING_LEASE_LOST')assert.equal(finish,undefined);else assert.equal((finish as {status:string}).status,'suppressed');
 }
});
test('Requester reply worker preserves uncertainty after network or lost finish responses without retrying HTTP',async()=>{
 for(const mode of ['network','finish']){
  let sends=0,finishes=0;const reply=snapshot();
  const result=await dispatchRequesterEmailReply({rpc:async(_,input)=>{if(input.p_operation==='claim')return {action:'send',receiverId:env.AGENTMAIL_RECEIVER_ID,leaseToken:randomUUID(),reply};if(input.p_operation==='finish'){finishes++;if(mode==='finish')throw new Error('lost database response');assert.equal((input.p_input as {status:string}).status,'uncertain');}return {};}},env,{send:async(_,authorize)=>{await authorize();sends++;if(mode==='network')throw new Error('lost network response');return {status:'accepted',messageId:'outgoing',threadId:'thread'};}});
  assert.equal(sends,1);assert.equal(finishes,1);assert.deepEqual(result,{claimed:1,outcome:'uncertain'});
 }
});
test('Requester reply worker rejects cross-receiver snapshots before sending',async()=>{
 let status:string|undefined;
 await dispatchRequesterEmailReply({rpc:async(_,input)=>{if(input.p_operation==='claim')return {action:'send',receiverId:randomUUID(),leaseToken:randomUUID(),reply:snapshot()};if(input.p_operation==='finish')status=(input.p_input as {status:string}).status;return {};}},env,{send:async()=>{assert.fail('must not send');}});
 assert.equal(status,'suppressed');
});
test('Requester reply route requires dispatch authentication and never caches denials',async()=>{
 const response=await POST(new Request('https://example.test/api/internal/agentmail/replies',{method:'POST'}));
 assert.equal(response.status,401);assert.match(response.headers.get('cache-control')??'',/no-store/);
});
