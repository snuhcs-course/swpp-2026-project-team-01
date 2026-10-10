import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guestCredential, requireCredential, verifyHostToken, type Credential } from './credentials.ts';
import { Conversations } from './conversations.ts';
import { Database, type Fetch } from '../database/client.ts';
import { ApplicationError, publicError } from '../errors.ts';
import { conversationView } from '../../contracts/conversations.ts';

const subject = '80000000-0000-4000-8000-000000000001';
const sessionId = '81000000-0000-4000-8000-000000000001';
const requestId = '83000000-0000-4000-8000-000000000001';
const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture', SUPABASE_SECRET_KEY: 'sb_secret_fixture' };
const now = Date.now();
function token(overrides = {}) {
  return ['header', Buffer.from(JSON.stringify({ sub: subject, session_id: sessionId, iss: `${env.SUPABASE_URL}/auth/v1`,
    aud: 'authenticated', role: 'authenticated', exp: Math.floor(now / 1000) + 3600, ...overrides })).toString('base64url'), 'signature'].join('.');
}
const acceptedUser = { id: subject, email: 'host@fixture.test', email_confirmed_at: new Date(now).toISOString(),
  user_metadata: { id: 'attacker', role: 'operator', hostApproved: true } };
function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): Fetch {
  return ((url: string | URL | Request, init?: RequestInit) => Promise.resolve(handler(String(url), init))) as Fetch;
}
const code = (expected: string) => (e: unknown) => e instanceof ApplicationError && e.code === expected;

test('host authority requires Auth verification of the original token and ignores user metadata', async () => {
  let calls = 0;
  const original = token();
  const credential = await verifyHostToken(original, { env, now, fetcher: fakeFetch((url, init) => {
    calls++; assert.equal(url, `${env.SUPABASE_URL}/auth/v1/user`);
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${original}`);
    assert.equal(new Headers(init?.headers).get('apikey'), env.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store');
    return Response.json(acceptedUser);
  }) });
  assert.equal(calls, 1); requireCredential(credential);
  assert.equal(credential.kind, 'host');
  assert.ok(Object.isFrozen(credential));
  assert.doesNotMatch(JSON.stringify(credential), /attacker|operator|hostApproved|fixture.test|signature/);
});

test('wrong provider, audience, anonymous and expired credentials fail before network access', async () => {
  let calls = 0;
  const fetcher = fakeFetch(() => { calls++; return Response.json(acceptedUser); });
  for (const claims of [{ iss: 'https://accounts.google.com' }, { aud: 'another-app' }, { role: 'service_role' },
    { exp: Math.floor(now / 1000) - 1 }, { is_anonymous: true }, { session_id: undefined }]) {
    await assert.rejects(verifyHostToken(token(claims), { env, now, fetcher }), code('UNAUTHORIZED'));
  }
  assert.equal(calls, 0);
});

test('forged JWT payloads cannot become authority when Auth rejects or returns another subject', async () => {
  for (const response of [new Response(null, { status: 401 }), Response.json({ ...acceptedUser, id: requestId }),
    Response.json({ ...acceptedUser, email_confirmed_at: null })]) {
    await assert.rejects(verifyHostToken(token(), { env, now, fetcher: fakeFetch(() => response) }), code('UNAUTHORIZED'));
  }
  await assert.rejects(verifyHostToken(token(), { env, now, fetcher: fakeFetch(() => { throw new Error('credential=secret'); }) }), code('PROVIDER_UNAVAILABLE'));
});

test('guest credentials carry a request-bound hash and never trust a supplied actor object', async () => {
  const credential = guestCredential(requestId, 'a'.repeat(43));
  requireCredential(credential);
  assert.equal(credential.kind, 'guest');
  if (credential.kind !== 'guest') assert.fail('Expected request credential');
  assert.match(credential.tokenHash, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(credential), /a{43}/);
  assert.throws(() => requireCredential(JSON.parse(JSON.stringify(credential)) as Credential), code('UNAUTHORIZED'));
  assert.throws(() => guestCredential(requestId, 'short'), code('UNAUTHORIZED'));
  let calls = 0;
  const conversations = new Conversations(new Database(env, fakeFetch(() => { calls++; return Response.json({}); })));
  await assert.rejects(conversations.open({ kind: 'host', subject, sessionId, expiresAt: '2099-01-01T00:00:00Z' }, { audience: 'host_setup' }), code('UNAUTHORIZED'));
  await assert.rejects(conversations.open(credential, { audience: 'request_shared', requestId, actor: { kind: 'host' } }), code('INVALID_INPUT'));
  assert.equal(calls, 0);
});

test('modern secret keys stay in apikey and RPC failures expose only safe categories', async () => {
  const database = new Database(env, fakeFetch((url, init) => {
    assert.equal(url, `${env.SUPABASE_URL}/rest/v1/rpc/fmat_conversation_access`);
    assert.equal(new Headers(init?.headers).get('apikey'), env.SUPABASE_SECRET_KEY);
    assert.equal(new Headers(init?.headers).get('authorization'), null);
    return Response.json({ message: 'REVISION_CONFLICT', details: 'private calendar secret' }, { status: 400 });
  }));
  await assert.rejects(database.rpc('fmat_conversation_access', {}), code('STALE_REVISION'));
  const failing = new Database(env, fakeFetch(() => Response.json({ message: 'private calendar secret' }, { status: 500 })));
  try { await failing.rpc('fmat_command', {}); assert.fail('must reject'); }
  catch (error) { assert.doesNotMatch(JSON.stringify(publicError(error)), /private calendar|secret/); }
});

test('privileged RPC rejects a mislabeled publishable key before any database request',async()=>{
 let calls=0;
 for(const key of ['sb_publishable_public','  sb_publishable_public\n']){
  const database=new Database({...env,SUPABASE_SECRET_KEY:key},fakeFetch(()=>{calls++;return Response.json({ok:true});}));
  await assert.rejects(database.rpc('fmat_command',{}),code('CONFIGURATION_UNAVAILABLE'));
 }
 assert.equal(calls,0,'Known public credentials never reach a privileged RPC');
});

test('browser conversation projection removes execution authority and private fields', () => {
  const view = conversationView.parse({ conversationId: subject, audience: 'request_shared', hostId: subject,
    requestId, readOnly: false, grantId: sessionId, credential: { tokenHash: 'secret' }, actor: { email: 'private' } });
  assert.deepEqual(Object.keys(view).sort(), ['audience', 'conversationId', 'hostId', 'readOnly', 'requestId']);
});

test('temporary conversation quota errors map to safe retryable HTTP 429',async()=>{
 const db=new Database(env,fakeFetch(()=>Response.json({message:'CONVERSATION_RATE_LIMIT',details:'private quota data'},{status:400})));
 try{await db.rpc('fmat_runtime_message',{});assert.fail('expected throttle');}
 catch(error){const response=publicError(error);assert.equal(response.status,429);assert.equal(response.body.error.code,'CONVERSATION_RATE_LIMIT');assert.match(response.body.error.message,/Wait at least a minute/);assert.doesNotMatch(JSON.stringify(response),/private quota/);}
});
