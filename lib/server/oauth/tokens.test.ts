import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,importJWK,SignJWT,decodeJwt} from 'jose';
import {AgentOAuthTokens,type AgentTokenGrant} from './tokens.ts';
import {AgentOAuthError} from './protocol.ts';
import {ApplicationError} from '../errors.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
const now=Date.parse('2026-10-08T12:00:00Z'),second=now/1000;
const grant:AgentTokenGrant={grantId:'00000000-0000-4000-8000-000000000001',clientId:'00000000-0000-4000-8000-000000000002',actorKind:'guest',actorId:'00000000-0000-4000-8000-000000000003',scope:'request:write request:read',grantExpiresAt:second+3600};
async function keys(kid='current'){const pair=await generateKeyPair('ES256',{extractable:true});return {...await exportJWK(pair.privateKey),kid};}
const key=await keys(),env={APP_ORIGIN:'https://release.example.test',AGENT_OAUTH_SIGNING_JWK:JSON.stringify(key)};
const allow=async()=>{};
const invalid=(e:unknown)=>e instanceof AgentOAuthError&&e.code==='invalid_token'&&e.status===401;
const unavailable=(e:unknown)=>e instanceof ApplicationError&&e.code==='CONFIGURATION_UNAVAILABLE';
test('OAuth access tokens bind issuer/resource/client/grant/actor with bounded lifetime and no credential promotion',async()=>{
 const tokens=new AgentOAuthTokens(env,()=>now);let checked=0;
 const token=await tokens.issue(grant,async()=>{checked++;});assert.equal(checked,2);
 const claims=await tokens.verify(token,async c=>{checked++;assert.equal(c.grant_id,grant.grantId);assert.equal(c.client_id,grant.clientId);});
 assert.equal(checked,3);assert.equal(claims.aud,env.APP_ORIGIN+'/mcp');assert.equal(claims.iss,env.APP_ORIGIN);assert.equal(claims.sub,grant.actorId);assert.equal(claims.scope,'request:read request:write');assert.equal(claims.exp,second+300);assert.ok(Object.isFrozen(claims));
 assert.throws(()=>requireCredential(claims as unknown as Credential));
 assert.notEqual(decodeJwt(await tokens.issue(grant,allow)).jti,claims.jti);
 assert.equal(decodeJwt(await tokens.issue({...grant,grantExpiresAt:second+10},allow)).exp,second+10);
 const jwks=await tokens.jwks();assert.equal(jwks.keys.length,1);assert.equal('d'in jwks.keys[0],false);assert.ok(!JSON.stringify(jwks).includes(key.d!));jwks.keys[0].kid='changed';assert.equal((await tokens.jwks()).keys[0].kid,'current');
});
test('OAuth token verification rejects wrong signature, algorithm, key/header, claim type and resource before authority lookup',async()=>{
 const tokens=new AgentOAuthTokens(env,()=>now),legit=await tokens.issue(grant,allow),payload=decodeJwt(legit),privateKey=await importJWK(key,'ES256');let calls=0;
 const check=()=>{calls++;return Promise.resolve();};
 for(const patch of [{iss:'https://other.test'},{aud:'authenticated'},{aud:[env.APP_ORIGIN+'/mcp']},{sub:'bad'},{client_id:'bad'},{grant_id:'bad'},{actor_kind:'host'},{actor_kind:'intake'},{scope:'request:intake'},{scope:'request:read host:read'},{scope:'request:write request:read'},{scope:'request:read request:read'},{exp:second},{iat:second+1},{exp:second+301},{jti:'bad'},{email:'private@example.test'}]){
  const forged=await new SignJWT({...payload,...patch}).setProtectedHeader({alg:'ES256',typ:'at+jwt',kid:'current'}).sign(privateKey);await assert.rejects(tokens.verify(forged,check),invalid);
 }
 for(const header of [{alg:'ES256',typ:'JWT',kid:'current'},{alg:'ES256',typ:'at+jwt',kid:'unknown'},{alg:'ES256',typ:'at+jwt',kid:'current',jku:'https://untrusted.test/keys'},{alg:'ES256',typ:'at+jwt',kid:'current',jwk:(await tokens.jwks()).keys[0]}]){
  await assert.rejects(tokens.verify(await new SignJWT(payload).setProtectedHeader(header).sign(privateKey),check),invalid);
 }
 for(const field of ['iss','aud','sub','iat','exp','jti','client_id','grant_id','actor_kind','scope']){
  const missing={...payload};delete missing[field];await assert.rejects(tokens.verify(await new SignJWT(missing).setProtectedHeader({alg:'ES256',typ:'at+jwt',kid:'current'}).sign(privateKey),check),invalid);
 }
 const different=await importJWK(await keys('current'),'ES256');await assert.rejects(tokens.verify(await new SignJWT(payload).setProtectedHeader({alg:'ES256',typ:'at+jwt',kid:'current'}).sign(different),check),invalid);
 await assert.rejects(tokens.verify(await new SignJWT(payload).setProtectedHeader({alg:'HS256',typ:'at+jwt',kid:'current'}).sign(new Uint8Array(32)),check),invalid);
 for(const raw of ['bad','x'.repeat(8193),legit.slice(0,-5)+'AAAAA'])await assert.rejects(tokens.verify(raw,check),invalid);
 assert.equal(calls,0);
});
test('OAuth signing and verification recheck current authority and wall-clock expiry after waits',async()=>{
 let clock=now;const tokens=new AgentOAuthTokens(env,()=>clock);const denied=new ApplicationError('FORBIDDEN',403);
 await assert.rejects(tokens.issue(grant,async()=>{throw denied;}),e=>e===denied);
 let calls=0;await assert.rejects(tokens.issue(grant,async()=>{if(++calls===2)throw denied;}),e=>e===denied);
 clock=now;calls=0;await assert.rejects(tokens.issue({...grant,grantExpiresAt:second+1},async()=>{if(++calls===2)clock+=1000;}));
 clock=now;const token=await tokens.issue({...grant,grantExpiresAt:second+1},allow);
 await assert.rejects(tokens.verify(token,async()=>{throw denied;}),e=>e===denied);
 await assert.rejects(tokens.verify(token,async()=>{clock+=1000;}),invalid);
 await assert.rejects(tokens.issue({...grant,grantExpiresAt:second},allow));
 await assert.rejects(tokens.issue({...grant,actorKind:'host'},allow));
});
test('OAuth key rotation retains only configured public verification keys and never trusts missing or malformed configuration',async()=>{
 const oldTokens=new AgentOAuthTokens(env,()=>now),old=await oldTokens.issue(grant,allow),next=await keys('next');
 const retired=(await oldTokens.jwks()).keys;
 const rotated=new AgentOAuthTokens({...env,AGENT_OAUTH_SIGNING_JWK:JSON.stringify(next),AGENT_OAUTH_RETIRED_JWKS:JSON.stringify(retired)},()=>now);
 assert.equal((await rotated.verify(old,allow)).grant_id,grant.grantId);assert.equal((await rotated.jwks()).keys.length,2);
 const newToken=await rotated.issue(grant,allow);await assert.rejects(oldTokens.verify(newToken,allow),invalid);
 await assert.rejects(new AgentOAuthTokens({...env,AGENT_OAUTH_SIGNING_JWK:JSON.stringify(next)},()=>now).verify(old,allow),invalid);
 for(const patch of [{AGENT_OAUTH_SIGNING_JWK:''},{AGENT_OAUTH_SIGNING_JWK:'{}'},{AGENT_OAUTH_SIGNING_JWK:JSON.stringify({...key,d:next.d})},{AGENT_OAUTH_RETIRED_JWKS:JSON.stringify([key])},{AGENT_OAUTH_RETIRED_JWKS:JSON.stringify(retired)},{AGENT_OAUTH_RETIRED_JWKS:JSON.stringify(Array.from({length:4},(_,i)=>({...retired[0],kid:'old'+i})))},{AGENT_OAUTH_SIGNING_JWK:JSON.stringify({...key,alg:'HS256'})}])await assert.rejects(new AgentOAuthTokens({...env,...patch},()=>now).jwks(),unavailable);
});
