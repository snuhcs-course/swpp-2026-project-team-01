import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {generateKeyPair,exportJWK} from 'jose';
import {NextRequest} from 'next/server';
import {AgentOAuthRegistry} from '../../../lib/server/oauth/registry.ts';
import {AgentOAuthService} from '../../../lib/server/oauth/service.ts';
import {pkceChallenge} from '../../../lib/server/oauth/protocol.ts';
import {agentOAuthProtocol,agentAuthorizationCookie,agentLoginReturnCookie} from './agent-oauth-protocol.ts';
import {agentLoginReturn} from './agent-oauth-browser.ts';
const pair=await generateKeyPair('ES256',{extractable:true}),jwk={...await exportJWK(pair.privateKey),kid:'test'};
const env={NODE_ENV:'test' as const,APP_ORIGIN:'https://release.example.test',AGENT_OAUTH_SIGNING_JWK:JSON.stringify(jwk)},client=randomUUID(),id=randomUUID();
test('OAuth discovery and JWKS use configured origin, publish no private key and support credential-free CORS/HEAD',async()=>{
 const protocol=agentOAuthProtocol(env);
 for(const action of ['metadata','resource','jwks']){
  const response=await protocol(new NextRequest('https://attacker.test/ignored',{headers:{origin:'https://client.example','x-forwarded-host':'attacker.test'}}),action),body=await response.json();
  assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),'*');assert.equal(response.headers.get('access-control-allow-credentials'),null);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('set-cookie'),null);assert.ok(!JSON.stringify(body).includes(jwk.d!));assert.ok(!JSON.stringify(body).includes('attacker.test'));
  if(action==='resource')assert.equal(body.resource,env.APP_ORIGIN+'/mcp');if(action==='metadata')assert.equal(body.authorization_endpoint,env.APP_ORIGIN+'/oauth/authorize');
  const head=await protocol(new NextRequest(env.APP_ORIGIN,{method:'HEAD'}),action);assert.equal(await head.text(),'');
 }
 assert.equal((await protocol(new NextRequest(env.APP_ORIGIN,{method:'POST'}),'metadata')).status,405);
 const unavailable=await agentOAuthProtocol({NODE_ENV:'test' as const,APP_ORIGIN:env.APP_ORIGIN})(new NextRequest(env.APP_ORIGIN),'metadata');assert.equal(unavailable.status,503);assert.deepEqual(await unavailable.json(),{error:'temporarily_unavailable'});
});
test('OAuth authorization sets a private initiating-browser cookie and only redirects to local consent',async()=>{
 const registry=new AgentOAuthRegistry(env,{async rpc(){return {authorizationId:id,expiresAt:new Date(Date.now()+600000).toISOString()};}}),protocol=agentOAuthProtocol(env,registry);
 const query=new URLSearchParams({client_id:client,resource:env.APP_ORIGIN+'/mcp',scope:'host:read',redirect_uri:'https://client.example/cb',state:'state',code_challenge:pkceChallenge('a'.repeat(43)),code_challenge_method:'S256',response_type:'code',next:'https://attacker.test'});
 const response=await protocol(new NextRequest(env.APP_ORIGIN+'/oauth/authorize?'+query),'authorize');assert.equal(response.status,303);assert.equal(response.headers.get('location'),env.APP_ORIGIN+'/connect/authorize?authorizationId='+id);assert.equal(response.headers.get('access-control-allow-origin'),null);
 const cookie=response.headers.get('set-cookie')!;assert.ok(cookie.startsWith(agentAuthorizationCookie(id,env)+'='));assert.match(cookie,/HttpOnly/u);assert.match(cookie,/Secure/u);assert.match(cookie,/SameSite=lax/iu);
});
test('OAuth protocol revocation accepts form transport without signing keys and rejects alternate authentication',async()=>{
 const noKey={NODE_ENV:'test' as const,APP_ORIGIN:env.APP_ORIGIN};let calls=0;
 const service=new AgentOAuthService(noKey,{async rpc(){calls++;return {revoked:true};}}),protocol=agentOAuthProtocol(noKey,undefined,service);
 const body=new URLSearchParams({client_id:client,resource:env.APP_ORIGIN+'/mcp',token:'unknown'}).toString();
 const send=(headers:Record<string,string>)=>protocol(new NextRequest(env.APP_ORIGIN+'/oauth/revoke',{method:'POST',headers,body}),'revoke');
 assert.equal((await send({'content-type':'application/json'})).status,415);assert.equal((await send({'content-type':'application/x-www-form-urlencoded',authorization:'Bearer private'})).status,401);assert.equal(calls,0);
 const response=await send({'content-type':'application/x-www-form-urlencoded'});assert.equal(response.status,200);assert.equal(await response.text(),'');assert.equal(calls,1);
});
test('OAuth login return requires a UUID and its original binding, never an arbitrary URL',()=>{
 const previous=process.env.APP_ORIGIN;process.env.APP_ORIGIN=env.APP_ORIGIN;
 try{
  const name=agentLoginReturnCookie(),binding=agentAuthorizationCookie(id);
  const request=(cookie:string)=>new NextRequest(env.APP_ORIGIN+'/auth/callback',{headers:{cookie}});
  assert.equal(agentLoginReturn(request(name+'=https://attacker.test')),null);assert.equal(agentLoginReturn(request(name+'='+id)),null);
  assert.equal(agentLoginReturn(request(name+'='+id+'; '+binding+'='+'a'.repeat(43))),'/connect/authorize?authorizationId='+id);
 }finally{if(previous===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=previous;}
});
