import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AgentOAuthRegistry} from './registry.ts';
import {AgentOAuthError,pkceChallenge} from './protocol.ts';
import {guestCredential} from '../identity/credentials.ts';
const env={APP_ORIGIN:'https://release.example.test'},resource=env.APP_ORIGIN+'/mcp',client=randomUUID(),id=randomUUID();
const secret='a'.repeat(43),request=randomUUID(),redirect='https://client.example/cb?existing=1';
const form=(value:Record<string,string>)=>new URLSearchParams(value).toString();
const query={client_id:client,redirect_uri:redirect,response_type:'code',state:'state',scope:'request:read',resource,code_challenge:pkceChallenge(secret),code_challenge_method:'S256'};
const state={authorizationId:id,clientId:client,clientName:'Personal agent',redirectUri:redirect,resource,scope:'request:read',state:'state',decision:null,expiresAt:new Date(Date.now()+600000).toISOString()};
test('OAuth registry charges malformed registrations and authorization attempts without creating authority',async()=>{
 let calls=0;const registry=new AgentOAuthRegistry(env,{async rpc(name,p){calls++;if(name==='fmat_oauth_register'){assert.equal(p.p_name,null);return {error:'invalid_client_metadata'};}assert.equal((p.p_input as Record<string,string>).codeChallengeMethod,'invalid');return {error:'invalid_request'};}});
 for(const raw of ['{','[]','{}',JSON.stringify({redirect_uris:['http://evil.example/cb']}),JSON.stringify({redirect_uris:[redirect],token_endpoint_auth_method:'client_secret_basic'})])await assert.rejects(registry.register(raw),e=>e instanceof AgentOAuthError&&e.code==='invalid_client_metadata');
 for(const raw of [form({...query,response_type:'token'}),form({...query,scope:'unknown'}),form(query)+'&state=repeated'])await assert.rejects(registry.start(raw),e=>e instanceof AgentOAuthError);
 assert.equal(calls,8);
 const limited=new AgentOAuthRegistry(env,{async rpc(){return {error:'rate_limited'};}});
 await assert.rejects(limited.register('{}'),e=>e instanceof AgentOAuthError&&e.status===429);await assert.rejects(limited.start('bad'),e=>e instanceof AgentOAuthError&&e.status===429);
});
test('OAuth registry projects public registration metadata and only persists a hashed browser binding',async()=>{
 let hash='';const registry=new AgentOAuthRegistry(env,{async rpc(name,p){
  if(name==='fmat_oauth_register'){assert.equal(p.p_resource,resource);return {clientId:client,name:'Agent',redirectUris:[redirect],resource,createdAt:new Date().toISOString()};}
  hash=(p.p_input as Record<string,string>).browserHash;return {authorizationId:id,expiresAt:state.expiresAt};
 }});
 const registered=await registry.register(JSON.stringify({client_name:' Agent ',redirect_uris:[redirect],logo_uri:'https://never-fetch.example/logo',client_uri:'https://never-fetch.example/metadata'}));
 assert.equal(registered.token_endpoint_auth_method,'none');assert.equal('client_secret' in registered,false);assert.equal('logo_uri' in registered,false);
 const started=await registry.start(form(query));assert.match(hash,/^[a-f0-9]{64}$/u);assert.match(started.binding,/^[A-Za-z0-9_-]{43}$/u);assert.notEqual(hash,started.binding);
});
test('OAuth consent recovers the same code after lost responses, preserves callback state and never accepts forged actor JSON',async()=>{
 const codeHashes:string[]=[];const registry=new AgentOAuthRegistry(env,{async rpc(name,p){if(name==='fmat_oauth_authorization_read')return state;codeHashes.push(String(p.p_code_hash));return {decision:p.p_decision,redirectUri:redirect,state:'state',codeExpiresAt:p.p_decision==='grant'?new Date(Date.now()+60000).toISOString():null};}});
 const credential=guestCredential(request,secret),first=await registry.decide(id,secret,'grant',credential),second=await registry.decide(id,secret,'grant',credential);
 assert.equal(first.redirectUri,second.redirectUri);assert.equal(codeHashes[0],codeHashes[1]);const url=new URL(first.redirectUri);assert.equal(url.searchParams.get('existing'),'1');assert.equal(url.searchParams.get('state'),'state');assert.match(url.searchParams.get('code')!,/^[A-Za-z0-9_-]{43}$/u);assert.ok(!first.redirectUri.includes(secret));
 await assert.rejects(registry.decide(id,secret,'grant',{...credential}));
 const denied=new URL((await registry.decide(id,secret,'deny',null)).redirectUri);assert.equal(denied.searchParams.get('error'),'access_denied');assert.equal(denied.searchParams.has('code'),false);
 await assert.rejects(registry.read(id,'wrong'));
});
