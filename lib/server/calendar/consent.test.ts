import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {CalendarConsent} from './consent.ts';
import {TokenCipher} from './encryption.ts';
import {Database} from '../database/client.ts';
import {guestCredential} from '../identity/credentials.ts';

test('Calendar start separates state, browser binding, PKCE and nonce and persists only hashes/encrypted secrets',async()=>{
 const env={APP_ORIGIN:'https://release.example.test',SUPABASE_URL:'https://database.example.test',SUPABASE_SECRET_KEY:'synthetic',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),GOOGLE_CLIENT_ID:'fixture-client',GOOGLE_CLIENT_SECRET:'fixture-secret'};
 let input:Record<string,string>={};
 const database=new Database(env,async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.equal(body.p_operation,'start');input=body.p_input;return Response.json({started:true});});
 const started=await new CalendarConsent(database,env).start(guestCredential(randomUUID(),randomBytes(32).toString('base64url')));
 const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
 assert.equal(input.stateHash,digest(started.state));assert.equal(input.bindingHash,digest(started.binding));
 const secret=new TokenCipher(env).open(input.encryptedVerifier,'oauth:'+input.stateHash) as {verifier:string;nonce:string};
 assert.deepEqual(Object.keys(secret).sort(),['nonce','verifier']);assert.equal(new Set([started.state,started.binding,secret.verifier,secret.nonce]).size,4);
 for(const value of [started.state,started.binding,secret.verifier,secret.nonce]){assert.match(value,/^[A-Za-z0-9_-]{43}$/u);assert.ok(!JSON.stringify(input).includes(value));}
 const url=new URL(started.url);assert.equal(url.searchParams.get('state'),started.state);assert.equal(url.searchParams.get('nonce'),secret.nonce);
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('code_challenge'),createHash('sha256').update(secret.verifier).digest('base64url'));
 assert.equal(url.searchParams.get('redirect_uri'),input.redirectUri);assert.equal(input.redirectUri,env.APP_ORIGIN+'/connections/google/callback');
 assert.ok(!url.href.includes(started.binding));assert.ok(!url.href.includes(secret.verifier));assert.ok(!url.href.includes(env.GOOGLE_CLIENT_SECRET));
});

test('Calendar callback rejects missing or malformed state/binding before any persistence or provider exchange',async()=>{
 let calls=0;
 const database=new Database({SUPABASE_URL:'https://database.example.test',SUPABASE_SECRET_KEY:'synthetic'},async()=>{calls++;throw new Error('Invalid callback reached SQL');});
 const consent=new CalendarConsent(database,{}, {authorization(){throw new Error('Unexpected start');},async exchange(){calls++;throw new Error('Invalid callback reached Google');}});
 const valid=randomBytes(32).toString('base64url');
 for(const invalid of ['', 'x'.repeat(42),'x'.repeat(44),'!'.repeat(43)]){
  await assert.rejects(consent.callback(valid,invalid,'private-code',false));
  await assert.rejects(consent.callback(invalid,valid,'private-code',false));
 }
 assert.equal(calls,0);
});
