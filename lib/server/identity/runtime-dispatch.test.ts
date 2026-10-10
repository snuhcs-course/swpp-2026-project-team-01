import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireDispatchSecret, dispatchPending } from './runtime-dispatch.ts';
import { Database } from '../database/client.ts';
import { Conversations } from './conversations.ts';
import { ApplicationError } from '../errors.ts';

test('dispatcher credentials are explicit and cannot be replaced by a host or guest credential', () => {
  const env={RUNTIME_DISPATCH_SECRET:'b'.repeat(64)};
  for(const value of ['', 'Bearer user-token', 'Request '+'b'.repeat(64)]) assert.throws(()=>requireDispatchSecret(new Request('https://example.test',{headers:{authorization:value}}),env),ApplicationError);
  assert.doesNotThrow(()=>requireDispatchSecret(new Request('https://example.test',{headers:{authorization:'Bearer '+'b'.repeat(64)}}),env));
  assert.throws(()=>requireDispatchSecret(new Request('https://example.test'),{}),ApplicationError);
});
test('revoked recovery never sends and transient failures remain retryable', async () => {
  const row={messageId:'91000000-0000-4000-8000-000000000001',conversationId:'92000000-0000-4000-8000-000000000001',grantId:'93000000-0000-4000-8000-000000000001',leaseToken:'94000000-0000-4000-8000-000000000001',text:'saved input',sessionId:'canonical'};
  for(const [status,outcome] of [[401,'revoked'],[503,'retry']] as const) {
    const finishes: unknown[]=[];let sent=false;
    const db={rpc:async (_name:string,p:Record<string,unknown>)=>{if(p.p_operation==='claim')return[row];finishes.push(p.p_input);return{};}} as Database;
    const access={checkExecution:async()=>{throw new ApplicationError(status===401?'UNAUTHORIZED':'PROVIDER_UNAVAILABLE',status);}} as unknown as Conversations;
    const result=await dispatchPending(async()=>{sent=true;},db,access);
    assert.equal(sent,false);assert.deepEqual(result,{claimed:1,sent:0});
    assert.deepEqual(finishes,[{messageId:row.messageId,leaseToken:row.leaseToken,outcome}]);
  }
});

test('dispatcher records each claimed lease after success or provider failure without leaking the failure', async () => {
  const row={messageId:'91000000-0000-4000-8000-000000000001',conversationId:'92000000-0000-4000-8000-000000000001',grantId:'93000000-0000-4000-8000-000000000001',leaseToken:'94000000-0000-4000-8000-000000000001',text:'saved input',sessionId:'canonical'};
  for(const fail of [false,true]) {
    const calls: {operation:unknown;input:unknown}[]=[];let sends=0,checks=0;
    const db={rpc:async (_name:string,p:Record<string,unknown>)=>{calls.push({operation:p.p_operation,input:p.p_input});return p.p_operation==='claim'?[row]:{};}} as Database;
    const access={checkExecution:async(grantId:string,conversationId:string)=>{checks++;assert.equal(grantId,row.grantId);assert.equal(conversationId,row.conversationId);}} as unknown as Conversations;
    const result=await dispatchPending(async(scope,text,auth,sessionId)=>{
      sends++;assert.equal(checks,1);assert.equal(scope,row.conversationId);assert.equal(text,row.text);assert.equal(sessionId,row.sessionId);
      assert.deepEqual(auth,{authenticator:'fmat-conversation',principalType:'user',principalId:row.grantId,attributes:{conversationId:row.conversationId,messageId:row.messageId}});
      if(fail)throw new Error('private-provider-token-and-message');
    },db,access);
    assert.equal(sends,1);assert.deepEqual(result,{claimed:1,sent:fail?0:1});
    assert.deepEqual(calls,[{operation:'claim',input:{}},{operation:'finish',input:{messageId:row.messageId,leaseToken:row.leaseToken,outcome:fail?'retry':'sent'}}]);
    assert.doesNotMatch(JSON.stringify({result,calls}),/private-provider/);
  }
});
