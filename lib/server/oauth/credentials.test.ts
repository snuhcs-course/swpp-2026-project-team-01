import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK} from 'jose';
import {AgentCredentials,requireAgentCredential} from './credentials.ts';
import {AgentOAuthTokens} from './tokens.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
import {AgentOAuthError} from './protocol.ts';
const second=Date.parse('2026-10-08T12:00:00Z')/1000;
const pair=await generateKeyPair('ES256',{extractable:true});
const env={APP_ORIGIN:'https://release.example.test',AGENT_OAUTH_SIGNING_JWK:JSON.stringify({...await exportJWK(pair.privateKey),kid:'test'})};
const grant={grantId:'00000000-0000-4000-8000-000000000001',clientId:'00000000-0000-4000-8000-000000000002',actorKind:'guest' as const,actorId:'00000000-0000-4000-8000-000000000003',scope:'request:read',grantExpiresAt:second+3600};
const token=await new AgentOAuthTokens(env,()=>second*1000).issue(grant,async()=>{});
const invalid=(e:unknown)=>e instanceof AgentOAuthError&&e.code==='invalid_token';
test('agent credential verifies current binding without forwarding token or creating browser authority',async()=>{
 let calls=0;
 const adapter=new AgentCredentials(env,{rpc:async(name,input)=>{
  calls++;assert.equal(name,'fmat_oauth_grant_check');
  assert.deepEqual(input,{p_id:grant.grantId,p_client_id:grant.clientId,p_resource:env.APP_ORIGIN+'/mcp',p_actor_kind:'guest',p_actor_id:grant.actorId,p_scope:grant.scope});
  return grant;
 }},()=>second*1000);
 const credential=await adapter.verify(token);assert.equal(calls,1);
 requireAgentCredential(credential,second*1000);assert.ok(Object.isFrozen(credential));assert.ok(Object.isFrozen(credential.claims));
 assert.equal(JSON.stringify(credential).includes(token),false);
 assert.throws(()=>requireCredential(credential as unknown as Credential));
 for(const forged of [{...credential},JSON.parse(JSON.stringify(credential)),credential.claims,null])assert.throws(()=>requireAgentCredential(forged,second*1000),invalid);
 assert.throws(()=>requireAgentCredential(credential,(second+300)*1000),invalid);
 await adapter.verify(token);assert.equal(calls,2,'each use rechecks authority');
});
test('agent credential rejects denied, malformed, changed or shorter-lived current grants',async()=>{
 for(const result of [{error:'invalid_grant'},null,{...grant,actorKind:'host'},{...grant,actorId:grant.clientId},{...grant,clientId:grant.actorId},{...grant,grantId:grant.actorId},{...grant,scope:'request:write'},{...grant,grantExpiresAt:second+299},{...grant,tokenHash:'secret'}]){
  await assert.rejects(new AgentCredentials(env,{rpc:async()=>result},()=>second*1000).verify(token),invalid);
 }
});
test('agent credential rejects expiry during authority lookup and invalid signatures before lookup',async()=>{
 let now=second*1000,calls=0;
 const adapter=new AgentCredentials(env,{rpc:async()=>{calls++;now+=300000;return grant;}},()=>now);
 await assert.rejects(adapter.verify('invalid'),invalid);assert.equal(calls,0);
 await assert.rejects(adapter.verify(token),invalid);assert.equal(calls,1);
});
