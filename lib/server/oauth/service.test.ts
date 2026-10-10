import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {generateKeyPair,exportJWK,decodeJwt} from 'jose';
import {AgentOAuthService,oauthSecretHash} from './service.ts';
import {AgentOAuthError,parseRevocationBody} from './protocol.ts';
import {ApplicationError} from '../errors.ts';
import type {Database} from '../database/client.ts';
const now=Date.now(),pair=await generateKeyPair('ES256',{extractable:true});
const env={APP_ORIGIN:'https://release.example.test',AGENT_OAUTH_SIGNING_JWK:JSON.stringify({...await exportJWK(pair.privateKey),kid:'test'})};
const resource=env.APP_ORIGIN+'/mcp',client=randomUUID(),code=randomBytes(32).toString('base64url');
const grant={grantId:randomUUID(),clientId:client,actorKind:'guest' as const,actorId:randomUUID(),scope:'request:read',grantExpiresAt:Math.floor(now/1000)+60};
const input={grant_type:'authorization_code',client_id:client,resource,code,redirect_uri:'https://client.test/cb',code_verifier:'a'.repeat(43)};
const form=(v:Record<string,string>)=>new URLSearchParams(v).toString();
const invalid=(e:unknown)=>e instanceof AgentOAuthError;
test('OAuth exchange hashes credentials, uses current grants twice and reports remaining signed lifetime',async()=>{
 const calls:{name:string;parameters:Record<string,unknown>}[]=[];let clock=now;
 const db:Pick<Database,'rpc'>={async rpc(name,parameters){calls.push({name,parameters});if(calls.length===3)clock+=3000;return grant;}};
 const result=await new AgentOAuthService(env,db,()=>clock).exchange(form(input));
 assert.deepEqual(calls.map(c=>c.name),['fmat_oauth_code_exchange','fmat_oauth_grant_check','fmat_oauth_grant_check']);
 assert.equal(calls[0].parameters.p_code_hash,oauthSecretHash(code));assert.equal(calls[0].parameters.p_refresh_hash,oauthSecretHash(result.refresh_token));
 assert.ok(!JSON.stringify(calls).includes(code));assert.ok(!JSON.stringify(calls).includes(result.refresh_token));
 const claims=decodeJwt(result.access_token);assert.equal(claims.aud,resource);assert.equal(claims.scope,grant.scope);assert.equal(result.expires_in,57);assert.equal(result.token_type,'Bearer');
 assert.deepEqual(Object.keys(result).sort(),['access_token','expires_in','refresh_token','scope','token_type']);
});
test('OAuth exchange refuses missing keys before consumption and rejects bad RPC data or changed authority',async()=>{
 let calls=0;const db:Pick<Database,'rpc'>={async rpc(){calls++;return grant;}};
 await assert.rejects(new AgentOAuthService({APP_ORIGIN:env.APP_ORIGIN},db).exchange(form(input)),e=>e instanceof ApplicationError&&e.code==='CONFIGURATION_UNAVAILABLE');assert.equal(calls,0);
 for(const response of [{error:'invalid_grant'},{...grant,clientId:randomUUID()},{...grant,privateSecret:'unexpected'},null,{error:'private SQL detail'}]){
  await assert.rejects(new AgentOAuthService(env,{async rpc(){return response;}},()=>now).exchange(form(input)),e=>invalid(e)||e instanceof ApplicationError);
 }
 for(const changeAt of [2,3]){
  let count=0;await assert.rejects(new AgentOAuthService(env,{async rpc(){return ++count===changeAt?{error:'invalid_grant'}:grant;}},()=>now).exchange(form(input)),invalid);
 }
});
test('OAuth refresh passes only hashed credentials and explicit optional narrowing to the committed RPC',async()=>{
 const refresh=randomBytes(32).toString('base64url');let parameters:Record<string,unknown>|undefined;
 const db:Pick<Database,'rpc'>={async rpc(name,p){if(name==='fmat_oauth_refresh')parameters=p;return grant;}};
 const service=new AgentOAuthService(env,db,()=>now);
 const result=await service.exchange(form({grant_type:'refresh_token',client_id:client,resource,refresh_token:refresh,scope:'request:read'}));
 assert.equal(parameters?.p_token_hash,oauthSecretHash(refresh));assert.equal(parameters?.p_next_hash,oauthSecretHash(result.refresh_token));assert.equal(parameters?.p_scope,'request:read');assert.notEqual(refresh,result.refresh_token);
 await service.exchange(form({grant_type:'refresh_token',client_id:client,resource,refresh_token:refresh}));assert.equal(parameters?.p_scope,null);
});
test('OAuth rejects alternate client authentication, foreign resources and duplicate revoke parameters',async()=>{
 let calls=0;const service=new AgentOAuthService(env,{async rpc(){calls++;return grant;}});
 for(const patch of [{client_secret:'secret'},{client_assertion:'jwt'},{client_assertion_type:'jwt'},{resource:resource+'/'},{resource:''}] as Record<string,string>[])await assert.rejects(service.exchange(form({...input,...patch})),invalid);
 assert.equal(calls,0);
 const revoke={client_id:client,resource,token:'unknown',token_type_hint:'unrecognized'};
 assert.deepEqual(parseRevocationBody(form(revoke),env),{client_id:client,resource,token:'unknown'});
 for(const raw of [form(revoke)+'&token=other',form({...revoke,token:'x'.repeat(8193)}),form({...revoke,client_secret:'secret'})])assert.throws(()=>parseRevocationBody(raw,env),invalid);
});
test('OAuth revocation remains available without signing keys and maps a committed neutral result to void',async()=>{
 let parameters:Record<string,unknown>|undefined;
 const service=new AgentOAuthService({APP_ORIGIN:env.APP_ORIGIN},{async rpc(name,p){assert.equal(name,'fmat_oauth_token_revoke');parameters=p;return {revoked:true};}});
 assert.equal(await service.revoke(form({client_id:client,resource,token:'unknown'})),undefined);
 assert.deepEqual(parameters,{p_client_id:client,p_resource:resource,p_token_hash:oauthSecretHash('unknown')});
});
