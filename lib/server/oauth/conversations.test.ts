import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {generateKeyPair,exportJWK} from 'jose';
import {AgentCredentials,type AgentCredential} from './credentials.ts';
import {AgentOAuthTokens} from './tokens.ts';
import {AgentConversations} from './conversations.ts';
const second=Math.floor(Date.now()/1000),pair=await generateKeyPair('ES256',{extractable:true});
const env={APP_ORIGIN:'https://release.example.test',AGENT_OAUTH_SIGNING_JWK:JSON.stringify({...await exportJWK(pair.privateKey),kid:'test'})};
async function credential(kind:'host'|'guest'|'intake',scope:string){
 const grant={grantId:randomUUID(),clientId:randomUUID(),actorKind:kind,actorId:randomUUID(),scope,grantExpiresAt:second+3600};
 const token=await new AgentOAuthTokens(env,()=>second*1000).issue(grant,async()=>{});
 return new AgentCredentials(env,{rpc:async()=>grant},()=>second*1000).verify(token);
}
test('conversation resolver binds claims and audience without manufacturing browser credentials',async()=>{
 const c=await credential('guest','request:read'),conversationId=randomUUID();
 const adapter=new AgentConversations({rpc:async(name,args)=>{
  assert.equal(name,'fmat_agent_operation');assert.equal(args.p_operation,'conversation_resolve');assert.equal(args.p_grant_id,c.claims.grant_id);
  assert.equal(args.p_request_id,c.claims.sub);assert.deepEqual(args.p_input,{audience:'request_shared'});
  return {conversationId,sessionId:'internal-runtime'};
 }},()=>second*1000);
 assert.deepEqual(await adapter.resolve(c,{audience:'request_shared',requestId:c.claims.sub}),{conversationId,sessionId:'internal-runtime'});
});
test('role, scope, target, forged identity and supplied runtime identifiers fail before RPC',async()=>{
 const c=await credential('guest','request:read'),write=await credential('host','host:write');let calls=0;
 const adapter=new AgentConversations({rpc:async()=>{calls++;return {};}},()=>second*1000);
 for(const [actor,target] of [[c,{audience:'host_setup'}],[c,{audience:'host_private',requestId:c.claims.sub}],
 [c,{audience:'request_shared',requestId:randomUUID()}],[c,{audience:'request_shared',requestId:c.claims.sub,sessionId:'forged'}],
 [write,{audience:'host_setup'}],[{...c},{audience:'request_shared',requestId:c.claims.sub}]] as const)
  await assert.rejects(adapter.resolve(actor as AgentCredential,target));
 assert.equal(calls,0);
});
test('revoked grants and malformed binding responses are denied',async()=>{
 const c=await credential('host','host:read');
 for(const result of [{error:'invalid_grant'},{conversationId:null,sessionId:'foreign'},{conversationId:randomUUID(),sessionId:'runtime',secret:'private'}]){
  const adapter=new AgentConversations({rpc:async()=>result},()=>second*1000);await assert.rejects(adapter.resolve(c,{audience:'host_setup'}));
 }
});

test('intake conversation resolution preserves the intake subject and denies host audiences',async()=>{
 const c=await credential('intake','request:read'),requestId=randomUUID();let calls=0;
 const adapter=new AgentConversations({rpc:async(_name,args)=>{calls++;assert.equal(args.p_actor_kind,'intake');assert.equal(args.p_actor_id,c.claims.sub);assert.equal(args.p_request_id,requestId);return {conversationId:null,sessionId:null};}},()=>second*1000);
 assert.deepEqual(await adapter.resolve(c,{audience:'request_shared',requestId}),{conversationId:null,sessionId:null});
 for(const target of [{audience:'host_setup'},{audience:'host_private',requestId}])await assert.rejects(adapter.resolve(c,target));
 assert.equal(calls,1);
});
