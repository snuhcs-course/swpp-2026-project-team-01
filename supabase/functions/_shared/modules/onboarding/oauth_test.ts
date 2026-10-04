import { createOAuth } from './oauth.ts';
import type { Database } from '../../database.ts';
import type { Environment } from '../../env.ts';
import type { GoogleProvider } from '../../providers/google.ts';
import { encryptSecret } from '../../security.ts';
const env: Environment = {
  supabaseUrl: 'https://test.supabase.co',
  appOrigin: 'https://findmeatime.com',
  serviceKey: 'secret',
  workerSecret: 'x'.repeat(32),
  encryptionKey: btoa('x'.repeat(32)),
  googleClientId: 'client',
  googleClientSecret: 'secret',
  openaiModel: 'gpt-4o-mini-2024-07-18',
  externalSends: false,
};
function assert(value: unknown) {
  if (!value) throw new Error('Assertion failed');
}
Deno.test('credential refresh echoes captured version and re-reads exact current credential metadata', async () => {
  const old = {
    accessToken: 'old',
    refreshToken: 'refresh',
    expiresAt: '2000-01-01T00:00:00Z',
    scope: 'read',
  };
  const fresh = { ...old, accessToken: 'fresh', expiresAt: '2099-01-01T00:00:00Z' };
  const encryptedOld = await encryptSecret(old, env.encryptionKey!);
  const encryptedFresh = await encryptSecret(fresh, env.encryptionKey!);
  let reads = 0;
  let captured: Record<string, unknown> = {};
  const db = {
    command: (operation: string, _actor: unknown, input: Record<string, unknown>) => {
      if (operation === 'token_update') {
        captured = input;
        return Promise.resolve({ ok: true });
      }
      reads++;
      return Promise.resolve({
        connectionId: 'connection',
        encryptedCredential: reads === 1 ? encryptedOld : encryptedFresh,
        providerSubject: 'subject',
        updatedAt: reads === 1 ? '2030-01-01T00:00:00Z' : '2030-01-01T00:01:00Z',
      });
    },
  } as unknown as Database;
  const google = { refresh: () => Promise.resolve(fresh) } as unknown as GoogleProvider;
  const result = await createOAuth(env, db, google).credential({ hostId: 'host' });
  assert(
    reads === 2 && captured.expectedUpdatedAt === '2030-01-01T00:00:00Z' &&
      captured.providerSubject === 'subject' &&
      result.connection.updatedAt === '2030-01-01T00:01:00Z' &&
      result.credential.accessToken === 'fresh',
  );
});
Deno.test('OAuth state and browser binding are hashed and PKCE is independent', async () => {
  let input: Record<string, unknown> = {};
  const db = {
    command: (_op: string, _actor: unknown, value: Record<string, unknown>) => {
      input = value;
      return Promise.resolve({ encryptedVerifier: value.encryptedVerifier });
    },
  } as unknown as Database;
  const result = await createOAuth(env, db).start({ kind: 'host', id: 'host' }, 'unique-key');
  const url = new URL(result.url);
  assert(url.searchParams.get('code_challenge_method') === 'S256');
  assert(url.searchParams.get('redirect_uri') === `${env.appOrigin}/api/google/callback`);
  assert(input.stateHash !== url.searchParams.get('state'));
  assert(typeof input.encryptedVerifier === 'string');
  assert(result.cookie.includes('HttpOnly; SameSite=Lax'));
  assert(result.cookie.includes('Secure'));
  assert(!url.searchParams.get('scope')?.includes('calendar.freebusy'));
});
Deno.test('callback missing browser binding never consumes state or exchanges provider code', async () => {
  let consumed = false;
  const db = {
    command: () => {
      consumed = true;
      throw new Error();
    },
  } as unknown as Database;
  let rejected = false;
  try {
    await createOAuth(env, db).callback(
      new Request(`https://callback?state=${'a'.repeat(43)}&code=code`),
    );
  } catch {
    rejected = true;
  }
  assert(rejected && !consumed);
});
Deno.test('denied consent consumes bound state and returns resumable requester path', async () => {
  const db = {
    command: () =>
      Promise.resolve({
        actor: { kind: 'guest', requestId: 'request-1' },
        context: { requestId: 'request-1' },
      }),
  } as unknown as Database;
  const google = {
    exchange: () => {
      throw new Error('Must not exchange denied consent');
    },
  } as unknown as GoogleProvider;
  const state = 'a'.repeat(43);
  const result = await createOAuth(env, db, google).callback(
    new Request(`https://callback?state=${state}&error=access_denied`, {
      headers: { cookie: `fmat_oauth_${state.slice(0, 16)}=browser-secret` },
    }),
  );
  assert(result.redirect === `${env.appOrigin}/requests/request-1?calendar=denied`);
  assert(result.cookie.includes('Max-Age=0'));
});
Deno.test('OAuth reconnect retry returns identical saved state and binding despite randomized proposed artifacts', async () => {
  let saved: unknown;
  const db = {
    command: (_operation: string, _actor: unknown, input: Record<string, unknown>) => {
      saved ??= { encryptedVerifier: input.encryptedVerifier };
      return Promise.resolve(saved);
    },
  } as unknown as Database;
  const oauth = createOAuth(env, db);
  const first = await oauth.start({ kind: 'host', id: 'host' }, 'same-key');
  const second = await oauth.start({ kind: 'host', id: 'host' }, 'same-key');
  assert(first.url === second.url && first.cookie === second.cookie);
});
