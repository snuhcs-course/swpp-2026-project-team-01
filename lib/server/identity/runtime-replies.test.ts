import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {captureReply,deliverMessage,settleMessage,type DeliveryState} from './runtime-delivery.ts';
import type {RuntimeMessages,RuntimeAuth} from './runtime-messages.ts';

test('checkpoint retry preserves only final text and replays failed settlement without another model input',async()=>{
 const auth:RuntimeAuth={authenticator:'fmat-conversation',principalType:'user',principalId:randomUUID(),attributes:{conversationId:randomUUID(),messageId:randomUUID()}};
 const state:DeliveryState={seen:{},active:null};let lose=true;const results:unknown[]=[];
 const messages={async deliver(){return {id:auth.attributes.messageId,text:'Input',status:'pending'};},async settle(...args:unknown[]){if(lose){lose=false;throw new Error('database outage before commit');}results.push(args);}} as unknown as RuntimeMessages;
 await deliverMessage(auth,'session',auth.attributes.conversationId,state,messages);
 captureReply(state,'Internal tool narration','tool-calls',0,2);
 captureReply(state,'First final block','stop',1,5);captureReply(state,'Second final block','stop',1,6);
 await assert.rejects(()=>settleMessage(state,'session','completed',messages),/outage/);
 const restored=structuredClone(state);
 assert.equal(await deliverMessage(auth,'session',auth.attributes.conversationId,restored,messages),undefined);
 assert.deepEqual(results[0],[auth,'session','completed','First final block\n\nSecond final block']);
 await settleMessage(restored,'session','failed',messages);
 assert.deepEqual(results[1],results[0],'late failure cannot replace checkpointed success');
});
