import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {AgentOAuthError,decodeOAuthForm,parseAuthorizationQuery,parseScopes,parseTokenBody,pkceChallenge,validateRedirect,verifyPkce} from './protocol.ts';
const env={APP_ORIGIN:'https://release.example.test'};
const resource=env.APP_ORIGIN+'/mcp',client='00000000-0000-4000-8000-000000000001',redirect='https://client.example.test/callback?existing=1',verifier=randomBytes(32).toString('base64url');
const query={client_id:client,redirect_uri:redirect,response_type:'code',resource,scope:'host:write host:read',state:'opaque state',code_challenge:pkceChallenge(verifier),code_challenge_method:'S256'};
const code={grant_type:'authorization_code',client_id:client,redirect_uri:redirect,resource,code:'a'.repeat(43),code_verifier:verifier};
const form=(input:Record<string,string>)=>new URLSearchParams(input).toString();
const error=(code:string)=>(cause:unknown)=>cause instanceof AgentOAuthError&&cause.code===code;
test('OAuth authorization and token parsing retain exact resource/callback and canonical role scopes',()=>{
 const parsed=parseAuthorizationQuery(form({...query,ignored_extension:'opaque'}),env);
 assert.equal(parsed.resource,resource);assert.equal(parsed.redirect_uri,redirect);assert.equal(parsed.scope,'host:read host:write');assert.equal(parsed.state,'opaque state');assert.equal('ignored_extension'in parsed,false);
 assert.equal(parseTokenBody(form(code),env).grant_type,'authorization_code');
 assert.deepEqual(parseTokenBody(form({grant_type:'refresh_token',client_id:client,resource,refresh_token:'a'.repeat(43),scope:'request:write request:read'}),env),{grant_type:'refresh_token',client_id:client,resource,refresh_token:'a'.repeat(43),scope:'request:read request:write'});
});
test('OAuth parsing rejects duplicate decoded fields, malformed encodings and bounded-input violations',()=>{
 for(const raw of ['resource=a&resource=b','resource=a&res%6furce=a','%FF=x','state=%C0%AF','state=%','state=%0D%0A','x=1&x=2','bad-key=x','__proto__=x','missingequals','x='+ 'a'.repeat(16384),Array.from({length:33},(_,i)=>'x'+i+'=a').join('&')])assert.throws(()=>decodeOAuthForm(raw),error('invalid_request'));
 assert.equal(decodeOAuthForm('state=a%2Bb+c').state,'a+b c');
});
test('OAuth authorization, code and refresh require the exact resource without implicit defaults',()=>{
 for(const target of ['',resource+'/',resource+'#fragment','https://other.test/mcp',resource.replace('https:','http:')]){
  assert.throws(()=>parseAuthorizationQuery(form({...query,resource:target}),env),error('invalid_target'));
  assert.throws(()=>parseTokenBody(form({...code,resource:target}),env),error('invalid_target'));
  assert.throws(()=>parseTokenBody(form({grant_type:'refresh_token',client_id:client,resource:target,refresh_token:'a'.repeat(43)}),env),error('invalid_target'));
 }
 const missing={...code};delete (missing as Partial<typeof code>).resource;assert.throws(()=>parseTokenBody(form(missing),env),error('invalid_target'));
});
test('OAuth has no implicit, mixed-role or unknown permissions and does not accept plain PKCE',()=>{
 for(const scope of ['', 'openid','host:read request:read','host:read host:read',' host:read','host:read\thost:write','host:read  host:write'])assert.throws(()=>parseScopes(scope),error('invalid_scope'));
 for(const patch of [{response_type:'token'},{code_challenge_method:'plain'},{code_challenge:'a'.repeat(42)},{state:''},{client_id:'foreign'}])assert.throws(()=>parseAuthorizationQuery(form({...query,...patch}),env),error('invalid_request'));
 assert.throws(()=>parseTokenBody(form({...code,client_secret:'secret'}),env),error('invalid_request'));
 assert.throws(()=>parseTokenBody(form({...code,grant_type:'password'}),env),error('unsupported_grant_type'));
});
test('OAuth callbacks allow HTTPS and exact loopback HTTP but reject credentials, fragments and parser aliases',()=>{
 for(const url of [redirect,'http://127.0.0.1:4567/callback','http://localhost:4567/callback','http://[::1]:4567/callback'])assert.equal(validateRedirect(url),url);
 for(const url of ['http://public.test/callback','https://user:password@client.test/callback','https://client.test/#','https://client.test/#fragment','https://client.test/\ncallback','https://client.test\\@other.test','/callback','javascript:alert(1)','https:client.test/callback','http://127.1/cb','http://2130706433/cb','http://%31%32%37.0.0.1/cb'])assert.throws(()=>validateRedirect(url),error('invalid_request'));
 // Canonicalization is intentionally absent: registration comparison must use
 // the original exact string, even when the URL parser sees the same origin.
 assert.notEqual(validateRedirect('https://client.test:443/cb'),validateRedirect('https://client.test/cb'));
});
test('S256 uses the RFC verifier alphabet and constant-length comparisons',()=>{
 const v='dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
 assert.equal(pkceChallenge(v),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
 assert.equal(verifyPkce(v,pkceChallenge(v)),true);assert.equal(verifyPkce(verifier,pkceChallenge(v)),false);
 for(const bad of ['short','a'.repeat(129),'a'.repeat(42)+'+']){assert.equal(verifyPkce(bad,pkceChallenge(v)),false);assert.throws(()=>pkceChallenge(bad),error('invalid_request'));}
 assert.equal(verifyPkce(v,pkceChallenge(v).slice(0,-1)+'N'),false);
});
