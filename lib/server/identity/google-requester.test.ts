import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {OAuth2Client,type GetTokenOptions} from 'google-auth-library';
import {GoogleRequesterIdentity} from './google-requester.ts';

const env={...process.env,APP_ORIGIN:'https://release.example.test',GOOGLE_CLIENT_ID:'identity-client',GOOGLE_CLIENT_SECRET:'private-secret'};
const state='s'.repeat(43),verifier='v'.repeat(43),nonce='n'.repeat(43);
test('requester identity asks only identity scopes with PKCE, nonce and account selection',()=>{
 const google=new GoogleRequesterIdentity(env),url=new URL(google.authorization(state,verifier,nonce));
 assert.equal(url.origin,'https://accounts.google.com');
 assert.equal(url.searchParams.get('redirect_uri'),env.APP_ORIGIN+'/connections/google/callback');
 assert.deepEqual(url.searchParams.get('scope')?.split(' '),['openid','email','profile']);
 assert.equal(url.searchParams.get('access_type'),'online');assert.equal(url.searchParams.get('prompt'),'select_account');
 assert.equal(url.searchParams.get('include_granted_scopes'),'false');assert.equal(url.searchParams.get('state'),state);
 assert.equal(url.searchParams.get('nonce'),nonce);assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(url.searchParams.get('code_challenge'),createHash('sha256').update(verifier).digest('base64url'));
 assert.ok(!url.href.includes(verifier));assert.ok(!url.href.includes(env.GOOGLE_CLIENT_SECRET));
 assert.throws(()=>google.authorization('bad-state',verifier,nonce));
});

test('signed requester identity rejects invalid proof and returns only bounded contact claims',async t=>{
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const now=Math.floor(Date.now()/1000),base={iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,sub:'provider-subject',iat:now,exp:now+3600,nonce,email:'Person@gmail.com',email_verified:true,name:' Person '};
 let payload:Record<string,unknown>={...base},brokenSignature=false,missingToken=false;
 const jwt=()=>{const input=Buffer.from(JSON.stringify({alg:'RS256',kid:'fixture'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url');return input+'.'+(brokenSignature?Buffer.alloc(256):sign('RSA-SHA256',Buffer.from(input),privateKey)).toString('base64url');};
 // Replace only network I/O. Signature, issuer, audience and timestamps pass
 // through the real Google SDK verification code with the fixture public key.
 t.mock.method(OAuth2Client.prototype,'getFederatedSignonCertsAsync',async()=>({certs:{fixture:publicKey.export({format:'pem',type:'spki'}).toString()}}));
 t.mock.method(OAuth2Client.prototype,'getToken',async(options:GetTokenOptions)=>{
  assert.equal(options.code,'one-time-code');assert.equal(options.codeVerifier,verifier);
  assert.equal(options.redirect_uri,env.APP_ORIGIN+'/connections/google/callback');
  return {tokens:{id_token:missingToken?undefined:jwt(),access_token:'never-return-access',refresh_token:'never-return-refresh',scope:'openid email profile'}};
 });
 const provider=new GoogleRequesterIdentity(env),exchange=()=>provider.exchange('one-time-code',verifier,nonce);
 assert.deepEqual(await exchange(),{subject:'provider-subject',email:'person@gmail.com',name:'Person',contactVerified:true});
 payload={...base,email:'person@company.test',hd:'company.test'};assert.equal((await exchange()).contactVerified,true);
 payload={...base,email:'person@third-party.test',name:undefined};assert.deepEqual(await exchange(),{subject:'provider-subject',email:'person@third-party.test',name:null,contactVerified:false});
 for(const bad of [{nonce:state},{aud:'other-client'},{iss:'https://attacker.test'},{exp:now-1},{iat:now+3600},{email_verified:false},{sub:''},{email:'invalid'},{name:'x'.repeat(201)},{hd:''}]){
  payload={...base,...bad};await assert.rejects(exchange(),(error:unknown)=>error instanceof Error&&'code' in error&&error.code==='OAUTH_STATE_INVALID');
 }
 payload={...base};brokenSignature=true;await assert.rejects(exchange());brokenSignature=false;missingToken=true;await assert.rejects(exchange());
});

test('requester identity sanitizes provider errors without exposing tokens or codes',async t=>{
 t.mock.method(OAuth2Client.prototype,'getToken',async()=>{throw new Error('private-provider-token private-auth-code');});
 await assert.rejects(new GoogleRequesterIdentity(env).exchange('one-time-code',verifier,nonce),error=>{
  assert.ok(error instanceof Error);assert.ok(!error.message.includes('private-'));return true;
 });
});

test('provider transport does not retry a failed single-use code or follow redirects',async()=>{
 let calls=0;
 const client=new OAuth2Client({clientId:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET,
  transporterOptions:{fetchImplementation:async(_url,options)=>{
   calls++;assert.equal(options?.redirect,'error');assert.ok(options?.signal);
   return new Response('private provider failure',{status:503});
  }}});
 await assert.rejects(new GoogleRequesterIdentity(env,client).exchange('one-time-code',verifier,nonce));
 assert.equal(calls,1);
});
