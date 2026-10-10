import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Database } from '../../lib/server/database/client.ts';
import { verifyHostToken } from '../../lib/server/identity/credentials.ts';
import { Conversations } from '../../lib/server/identity/conversations.ts';
import { ApplicationError } from '../../lib/server/errors.ts';

test('real local Auth verifies a host, enforces admission, and invalidates execution identity on logout', async () => {
  const local = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const origin = new URL(local.API_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Integration fixtures must use disposable local Supabase');
  const env = { SUPABASE_URL: origin.origin, SUPABASE_SECRET_KEY: local.SERVICE_ROLE_KEY, SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY };
  const adminHeaders = { apikey: local.SERVICE_ROLE_KEY, authorization: `Bearer ${local.SERVICE_ROLE_KEY}`, 'content-type': 'application/json' };
  const email = `identity-${randomUUID()}@example.test`;
  const password = randomUUID() + randomUUID();
  let userId: string | undefined;
  try {
    const create = await fetch(`${origin.origin}/auth/v1/admin/users`, {
      method: 'POST', headers: adminHeaders, body: JSON.stringify({ email, password, email_confirm: true }),
    });
    assert.equal(create.status, 200, 'local fixture user created');
    userId = (await create.json()).id;
    assert.ok(userId);
    const signIn = await fetch(`${origin.origin}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: local.ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    assert.equal(signIn.status, 200, 'local fixture signed in');
    const { access_token: accessToken } = await signIn.json();
    const credential = await verifyHostToken(accessToken, { env });
    const database = new Database(env);
    const identity = await database.rpc('fmat_conversation_access', { p_operation: 'identity', p_credential: credential, p_input: {} });
    assert.deepEqual(identity, { kind: 'host', id: userId, email });
    await assert.rejects(new Conversations(database).open(credential, { audience: 'host_setup' }),
      (error: unknown) => error instanceof ApplicationError && error.code === 'HOST_NOT_ADMITTED');

    const bypass = await fetch(`${origin.origin}/rest/v1/rpc/fmat_conversation_access`, {
      method: 'POST', headers: { apikey: local.ANON_KEY, authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_operation: 'identity', p_credential: credential, p_input: {} }),
    });
    assert.equal(bypass.status, 403, 'ordinary authenticated JWT cannot execute privileged identity RPC');
    const logout = await fetch(`${origin.origin}/auth/v1/logout?scope=global`, {
      method: 'POST', headers: { apikey: local.ANON_KEY, authorization: `Bearer ${accessToken}` },
    });
    assert.equal(logout.status, 204);
    await assert.rejects(database.rpc('fmat_conversation_access', { p_operation: 'identity', p_credential: credential, p_input: {} }),
      (error: unknown) => error instanceof ApplicationError && error.code === 'UNAUTHORIZED');
  } finally {
    if (userId) {
      const remove = await fetch(`${origin.origin}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: adminHeaders });
      assert.equal(remove.status, 200, 'local fixture user removed');
    }
  }
});
