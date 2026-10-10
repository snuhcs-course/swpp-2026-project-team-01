import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OAuth2Client,type GetTokenOptions,type VerifyIdTokenOptions} from 'google-auth-library';
import {GoogleOAuth,calendarScopes} from './google.ts';
const env={...process.env,APP_ORIGIN:'https://release.example.test',GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'private-secret'};
test('Google requests PKCE, offline consent and distinct host/request scopes on the configured callback',()=>{
  const google=new GoogleOAuth(env),host=new URL(google.authorization('host','state','verifier','nonce')),guest=new URL(google.authorization('guest','state','verifier','nonce'));
  assert.equal(host.origin,'https://accounts.google.com');assert.equal(host.searchParams.get('redirect_uri'),'https://release.example.test/connections/google/callback');
  assert.equal(host.searchParams.get('code_challenge_method'),'S256');assert.equal(host.searchParams.get('nonce'),'nonce');assert.equal(host.searchParams.get('access_type'),'offline');assert.equal(host.searchParams.get('prompt'),'consent');
  assert.equal(host.searchParams.get('include_granted_scopes'),'false');assert.ok(!host.href.includes('private-secret'));assert.ok(!host.href.includes('verifier'));
  assert.deepEqual(guest.searchParams.get('scope')?.split(' '),calendarScopes.guest);assert.ok(host.searchParams.get('scope')?.includes('calendar.events'));
});
test('Google exchanges verify signed identity audience/nonce and reject unusable or excessive requester grants',async t=>{
  let payload:Record<string,unknown>={sub:'google-subject',email:'test@example.test',email_verified:true,nonce:'expected'};
  let scopes=[...calendarScopes.guest] as string[],refresh:string|undefined='private-refresh';
  t.mock.method(OAuth2Client.prototype,'getToken',async (options:GetTokenOptions)=>{assert.equal(options.codeVerifier,'verifier');return {tokens:{access_token:'private-access',refresh_token:refresh,id_token:'signed-token',scope:scopes.join(' '),expiry_date:Date.now()+3600000}};});
  t.mock.method(OAuth2Client.prototype,'verifyIdToken',async (options:VerifyIdTokenOptions)=>{assert.deepEqual(options,{idToken:'signed-token',audience:'test-client'});return {getPayload:()=>payload};});
  const google=new GoogleOAuth(env);assert.equal((await google.exchange('code','verifier','expected','guest')).subject,'google-subject');
  payload={...payload,nonce:'another-browser'};await assert.rejects(google.exchange('code','verifier','expected','guest'),/Reconnect/);
  payload={...payload,nonce:'expected',email_verified:false};await assert.rejects(google.exchange('code','verifier','expected','guest'),/Reconnect/);
  payload={...payload,email_verified:true};scopes.push('https://www.googleapis.com/auth/calendar.events');await assert.rejects(google.exchange('code','verifier','expected','guest'),/Reconnect/);
  scopes=[...calendarScopes.guest];refresh=undefined;await assert.rejects(google.exchange('code','verifier','expected','guest'),/Reconnect/);
  refresh='private-refresh';await assert.rejects(google.exchange('code','verifier','expected','host'),/Reconnect/);
});
