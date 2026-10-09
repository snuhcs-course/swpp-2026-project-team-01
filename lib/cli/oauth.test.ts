import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {CliOAuthClient} from './oauth.ts';
import {CliFailure} from './mcp.ts';
import {AgentOAuthTokens} from '../server/oauth/tokens.ts';
const origin='https://oauth-cli.example.test',redirect='http://127.0.0.1:45678/callback/'+'x'.repeat(43);
const fails=(error:unknown)=>error instanceof CliFailure&&error.code==='LOGIN_REQUIRED';
async function fixture(intake=false){
 const pair=await generateKeyPair('ES256',{extractable:true}),env={APP_ORIGIN:origin,AGENT_OAUTH_SIGNING_JWK:JSON.stringify({...await exportJWK(pair.privateKey),kid:'oauth-cli'})},tokens=new AgentOAuthTokens(env);
 const grant={grantId:randomUUID(),clientId:randomUUID(),actorKind:intake?'intake' as const:'guest' as const,actorId:randomUUID(),scope:intake?'request:intake request:read':'request:read',grantExpiresAt:Math.floor(Date.now()/1000)+3600};
 let exchangeCalls=0,revocations=0,failExchange=false,badMetadata=false,privateKey=false,claimsPatch:Record<string,unknown>|null=null;let authorization:URL;
 const fetcher:typeof fetch=async(input,init)=>{
  const request=new Request(input,init),url=new URL(request.url);assert.equal(url.origin,origin);assert.equal(init?.redirect,'manual');assert.equal(init?.credentials,'omit');assert.equal(request.headers.get('authorization'),null);
  if(url.pathname==='/.well-known/oauth-authorization-server')return Response.json({issuer:origin,authorization_endpoint:origin+'/oauth/authorize',token_endpoint:(badMetadata?'https://foreign.test':origin)+'/oauth/token',registration_endpoint:origin+'/oauth/register',revocation_endpoint:origin+'/oauth/revoke',jwks_uri:origin+'/oauth/jwks',code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']});
  if(url.pathname==='/.well-known/oauth-protected-resource/mcp')return Response.json({resource:origin+'/mcp',authorization_servers:[origin]});
  if(url.pathname==='/oauth/register'){const data=await request.json();assert.deepEqual(data.redirect_uris,[redirect]);return Response.json({client_id:grant.clientId,redirect_uris:[redirect],token_endpoint_auth_method:'none'});}
  if(url.pathname==='/oauth/jwks')return Response.json(privateKey?{keys:[{...await exportJWK(pair.privateKey),kid:'oauth-cli'}]}:await tokens.jwks());
  const form=new URLSearchParams(await request.text());assert.equal(request.headers.get('content-type'),'application/x-www-form-urlencoded');assert.equal(form.get('resource'),origin+'/mcp');assert.equal(form.get('client_id'),grant.clientId);
  if(url.pathname==='/oauth/revoke'){revocations++;return new Response(null,{status:200});}
  assert.equal(url.pathname,'/oauth/token');exchangeCalls++;
  if(failExchange)throw Error('sensitive provider failure');
  if(form.get('grant_type')==='authorization_code'){assert.equal(form.get('redirect_uri'),redirect);assert.equal(createHash('sha256').update(form.get('code_verifier')!).digest('base64url'),authorization.searchParams.get('code_challenge'));}
  let token=await tokens.issue(grant,async()=>{});
  if(claimsPatch){const now=Math.floor(Date.now()/1000);token=await new SignJWT({iss:origin,aud:origin+'/mcp',sub:grant.actorId,client_id:grant.clientId,grant_id:grant.grantId,actor_kind:grant.actorKind,scope:grant.scope,iat:now,exp:now+300,jti:randomUUID(),...claimsPatch}).setProtectedHeader({alg:'ES256',typ:'at+jwt',kid:'oauth-cli'}).sign(pair.privateKey);}
  return Response.json({access_token:token,refresh_token:(exchangeCalls===1?'a':'b').repeat(43),token_type:'Bearer',expires_in:300,scope:grant.scope});
 };
 const client=new CliOAuthClient(origin,fetcher);
 const begin=async()=>{const attempt=await client.begin(grant.scope,redirect,intake?undefined:grant.actorId,intake?'public-host':undefined);authorization=new URL(attempt.authorizationUrl);return attempt;};
 const callback=()=>redirect+'?'+new URLSearchParams({state:authorization.searchParams.get('state')!,code:'c'.repeat(43)});
 return {client,begin,callback,grant,calls:()=>exchangeCalls,revocations:()=>revocations,breakExchange:()=>{failExchange=true;},badMetadata:()=>{badMetadata=true;},privateKey:()=>{privateKey=true;},patch:(p:Record<string,unknown>)=>{claimsPatch=p;}};
}
test('CLI OAuth validates metadata, PKCE, signed token and rotated refresh/revocation',async()=>{
 const f=await fixture(),attempt=await f.begin(),connection=await attempt.complete(f.callback());assert.equal(connection.actorId,f.grant.actorId);assert.equal(connection.grantId,f.grant.grantId);assert.equal(connection.state,'ready');assert.equal(f.calls(),1);
 await assert.rejects(attempt.complete(f.callback()),fails);assert.equal(f.calls(),1);
 const refreshed=await f.client.refresh(connection);assert.notEqual(refreshed.refreshToken,connection.refreshToken);assert.equal(refreshed.grantId,connection.grantId);await f.client.revoke(refreshed);assert.equal(f.revocations(),1);
});
test('foreign callback, wrong state, duplicate fields and wrong issuer cannot exchange a code',async()=>{
 const f=await fixture(),attempt=await f.begin(),valid=f.callback();
 for(const callback of [valid.replace('127.0.0.1','localhost'),valid.replace('/callback/','/other/'),valid+'&iss=https://foreign.test',valid+'&state=other',valid.replace('state=','wrong='),valid+'&extra=value',valid+'#fragment'])await assert.rejects(attempt.complete(callback),fails);
 assert.equal(f.calls(),0);await attempt.complete(valid);assert.equal(f.calls(),1);
});
test('denial and uncertain exchange are terminal and never automatically retried',async()=>{
 const f=await fixture(),attempt=await f.begin(),denied=new URL(f.callback());denied.searchParams.delete('code');denied.searchParams.set('error','access_denied');await assert.rejects(attempt.complete(denied.href),fails);await assert.rejects(attempt.complete(f.callback()),fails);assert.equal(f.calls(),0);
 const other=await fixture(),pending=await other.begin();other.breakExchange();await assert.rejects(pending.complete(other.callback()),fails);await assert.rejects(pending.complete(other.callback()),fails);assert.equal(other.calls(),1);
});
test('foreign metadata, private JWKS and incorrectly bound signed claims fail closed',async()=>{
 const f=await fixture();f.badMetadata();await assert.rejects(f.begin(),fails);assert.equal(f.calls(),0);
 const keys=await fixture(),attempt=await keys.begin();keys.privateKey();await assert.rejects(attempt.complete(keys.callback()),fails);
 for(const patch of [{aud:'https://foreign.test/mcp'},{iss:'https://foreign.test'},{client_id:randomUUID()},{actor_kind:'host'},{sub:randomUUID()},{exp:Math.floor(Date.now()/1000)-1},{scope:'request:read request:write'}]){
  const f=await fixture(),attempt=await f.begin();f.patch(patch);await assert.rejects(attempt.complete(f.callback()),fails);
 }
});

test('CLI intake authorization binds its public target and rejects actor promotion or mixed targets',async()=>{
 const f=await fixture(true),attempt=await f.begin(),url=new URL(attempt.authorizationUrl);
 assert.equal(url.searchParams.get('handle'),'public-host');assert.equal(url.searchParams.has('request_id'),false);
 const connection=await attempt.complete(f.callback());assert.equal(connection.actorKind,'intake');assert.equal((await f.client.refresh(connection)).actorId,connection.actorId);
 for(const args of [['request:intake',undefined,undefined],['request:intake',randomUUID(),'public-host'],['request:read',undefined,'public-host'],['request:intake',undefined,'app']] as const)
  await assert.rejects(f.client.begin(args[0],redirect,args[1],args[2]),e=>e instanceof CliFailure&&e.code==='INVALID_INPUT');
 const wrong=await fixture(true),pending=await wrong.begin();wrong.patch({actor_kind:'guest'});await assert.rejects(pending.complete(wrong.callback()),fails);
 const existing=await fixture(),guest=await existing.begin();existing.patch({actor_kind:'intake'});await assert.rejects(guest.complete(existing.callback()),fails);
});
