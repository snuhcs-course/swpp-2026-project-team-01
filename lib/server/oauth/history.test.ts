import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {generateKeyPair,exportJWK} from 'jose';
import {AgentCredentials} from './credentials.ts';
import {AgentOAuthTokens} from './tokens.ts';
import {agentHistory} from './history.ts';
import {AgentConversations} from './conversations.ts';
import {agentHistoryHttp} from './history-http.ts';
import {relayAgentHistory} from './history-relay.ts';
import {TokenCipher} from '../calendar/encryption.ts';
import type {GenerationTimeline} from '../identity/generation-history.ts';
const pair=await generateKeyPair('ES256',{extractable:true});
const env={APP_ORIGIN:'https://release.example.test',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),AGENT_OAUTH_SIGNING_JWK:JSON.stringify({...await exportJWK(pair.privateKey),kid:'test'})};
const grant={grantId:randomUUID(),clientId:randomUUID(),actorKind:'guest' as const,actorId:randomUUID(),scope:'request:read',grantExpiresAt:Math.floor(Date.now()/1000)+3600};
const token=await new AgentOAuthTokens(env).issue(grant,async()=>{}),credentials=new AgentCredentials(env,{rpc:async()=>grant}),credential=await credentials.verify(token);
const target={audience:'request_shared' as const,requestId:grant.actorId},binding={conversationId:randomUUID(),sessionId:'runtime-secret'};
const timeline={conversationId:binding.conversationId,audience:target.audience,generation:0,generations:[{generation:0,sessionId:binding.sessionId,terminalTail:null}]};
const access={history:async()=>timeline};
const attach=()=>({getStreamTailIndex:async()=>100,getEventStream:async({startIndex}:{startIndex:number})=>new ReadableStream({start(c){for(let i=startIndex;i<=100;i++)c.enqueue(i===1?{type:'action.result',data:{secret:'hidden-tool'}}:{type:'message.completed',data:{message:'text '+i}});c.close();}})});
test('history pagination and polling preserve cursor while hiding runtime bindings and private events',async()=>{
 const a=await agentHistory(credential,{target},attach,new AbortController().signal,access,env);
 assert.equal(a.events.length,100);assert.equal(a.hasMore,true);assert.doesNotMatch(JSON.stringify(a),/runtime-secret|hidden-tool/);
 const b=await agentHistory(credential,{target,cursor:a.nextCursor},attach,new AbortController().signal,access,env);
 assert.equal(b.events.length,1);assert.equal(b.hasMore,false);
 const c=await agentHistory(credential,{target,cursor:b.nextCursor},attach,new AbortController().signal,access,env);assert.equal(c.events.length,0);
});
test('cursor cannot move between targets, grants, runtime bindings or its expiry',async()=>{
 const a=await agentHistory(credential,{target},attach,new AbortController().signal,access,env);
 for(const [input,resolver,now] of [
  [{target:{...target,requestId:randomUUID()},cursor:a.nextCursor},access,Date.now],
  [{target,cursor:a.nextCursor}, {history:async()=>({...timeline,generations:[{...timeline.generations[0],sessionId:'replacement'}]})},Date.now],
  [{target,cursor:a.nextCursor+'invalid'},access,Date.now],
 ] as const)await assert.rejects(agentHistory(credential,input,attach,new AbortController().signal,resolver,env,now));
 const other={...grant,grantId:randomUUID()},otherToken=await new AgentOAuthTokens(env).issue(other,async()=>{}),otherCredential=await new AgentCredentials(env,{rpc:async()=>other}).verify(otherToken);
 await assert.rejects(agentHistory(otherCredential,{target,cursor:a.nextCursor},attach,new AbortController().signal,access,env));
 // A refreshed token keeps the grant but cannot revive an expired continuation.
 const future=Date.now()+16*60_000,futureToken=await new AgentOAuthTokens(env,()=>future).issue(grant,async()=>{});
 const refreshed=await new AgentCredentials(env,{rpc:async()=>grant},()=>future).verify(futureToken);
 await assert.rejects(agentHistory(refreshed,{target,cursor:a.nextCursor},attach,new AbortController().signal,access,env,()=>future));
});
test('changed authority after reading discards history and absent conversations never attach',async()=>{
 let calls=0;await assert.rejects(agentHistory(credential,{target},attach,new AbortController().signal,{history:async()=>{if(++calls===3)throw Error('revoked');return timeline;}},env));
 const empty=await agentHistory(credential,{target},()=>{throw Error('must not attach');},new AbortController().signal,{history:async()=>null},env);
 assert.deepEqual(empty,{events:[],nextCursor:null,hasMore:false});
});
test('legacy and logical encrypted cursors both continue across recovered generations',async()=>{
 const context='agent-history:'+JSON.stringify([credential.claims.aud,credential.claims.grant_id,target]);
 const cipher=new TokenCipher(env),expiresAt=Date.now()+15*60_000;
 let active:GenerationTimeline=timeline;
 const scoped={history:async()=>active};
 const first=await agentHistory(credential,{target},attach,new AbortController().signal,scoped,env);
 const legacy=cipher.seal({...binding,position:100,expiresAt},context);
 active={...timeline,generation:1,generations:[{...timeline.generations[0],terminalTail:100},{generation:1,sessionId:'successor-secret',terminalTail:null}]};
 const combined=(id:string)=>id===binding.sessionId?attach():{getStreamTailIndex:async()=>0,getEventStream:async()=>new ReadableStream({start(c){c.enqueue({type:'message.completed',meta:{id:'successor-event'},data:{message:'Recovered reply'}});c.close();}})};
 for(const cursor of [legacy,first.nextCursor]){
  const page=await agentHistory(credential,{target,cursor},combined,new AbortController().signal,scoped,env);
  assert.deepEqual(page.events.map(e=>e.cursor),[101,102]);assert.equal(page.hasMore,false);
  assert.doesNotMatch(JSON.stringify(page),/runtime-secret|successor-secret|terminalTail|generation/);
  const polled=await agentHistory(credential,{target,cursor:page.nextCursor},combined,new AbortController().signal,scoped,env);
  assert.equal(polled.events.length,0);
 }
 for(const [sessionId,position] of [['foreign-session',0],[binding.sessionId,102]] as const){
  const cursor=cipher.seal({...binding,sessionId,position,expiresAt},context);
  await assert.rejects(agentHistory(credential,{target,cursor},combined,new AbortController().signal,scoped,env));
 }
});
test('cursor issued while the successor is unbound survives its authorized binding',async()=>{
 let active:GenerationTimeline={...timeline,generation:1,generations:[{...timeline.generations[0],terminalTail:100},{generation:1,sessionId:null,terminalTail:null}]};
 const scoped={history:async()=>active};
 const first=await agentHistory(credential,{target},attach,new AbortController().signal,scoped,env);
 const last=await agentHistory(credential,{target,cursor:first.nextCursor},attach,new AbortController().signal,scoped,env);
 active={...active,generations:[active.generations[0],{generation:1,sessionId:'newly-bound',terminalTail:null}]};
 const page=await agentHistory(credential,{target,cursor:last.nextCursor},id=>id===binding.sessionId?attach():{
  getStreamTailIndex:async()=>0,getEventStream:async()=>new ReadableStream({start(c){c.enqueue({type:'message.completed',data:{message:'next'}});c.close();}}),
 },new AbortController().signal,scoped,env);
 assert.equal(page.events.length,1);assert.equal(page.events[0].cursor,102);
});
test('protected runtime route and fixed relay perform a signed-token round trip',async()=>{
 const resolver=new AgentConversations({rpc:async()=>timeline});
 const handle=agentHistoryHttp(env,credentials,resolver);
 const fetcher:typeof fetch=async(input,init)=>{assert.equal(input,env.APP_ORIGIN+'/api/agent/conversations/read');assert.equal(new Headers(init?.headers).get('cookie'),null);return handle(new Request(input,init),attach);};
 const page=await relayAgentHistory({target},token,new AbortController().signal,env,fetcher);assert.equal(page.events.length,100);
 for(const [path,headers,status] of [
 ['/api/agent/conversations/read',{},401],
 ['/api/agent/conversations/read?token=secret',{authorization:'Bearer '+token},400],
 ['/api/agent/conversations/read',{authorization:'Bearer '+token,origin:'https://foreign.test'},403],
 ] as const){const response=await handle(new Request(env.APP_ORIGIN+path,{method:'POST',headers,body:'{}'}),()=>{throw Error('denied before runtime');});assert.equal(response.status,status);assert.match(response.headers.get('cache-control')??'',/no-store/);}
});
