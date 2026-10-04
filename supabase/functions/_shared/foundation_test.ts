import { createApi } from '../api/app.ts';
import { createWorker } from '../worker/app.ts';
import { decryptSecret, encryptSecret, hashToken, jsonInput } from './security.ts';
import type { Database } from './database.ts';
import type { Environment } from './env.ts';
const env: Environment = {
  supabaseUrl: 'https://example.supabase.co',
  serviceKey: 'secret',
  appOrigin: 'https://findmeatime.com',
  workerSecret: 'x'.repeat(32),
  openaiModel: 'gpt-4.1-mini',
  externalSends: false,
};
function assert(condition: unknown) {
  if (!condition) throw new Error('Assertion failed');
}
Deno.test('public health permits allowed origin and rejects unrelated origin', async () => {
  const db = {} as Database;
  const api = createApi(env, db);
  assert((await api.request('/health')).status === 200);
  assert(
    (await api.request('/health', { headers: { Origin: env.appOrigin } })).headers.get(
      'access-control-allow-origin',
    ) === env.appOrigin,
  );
  assert(
    (await api.request('/health', { headers: { Origin: 'https://attacker.example' } })).status ===
      403,
  );
});
Deno.test('worker rejects untrusted caller before database access', async () => {
  let accessed = false;
  const db = {
    command: () => {
      accessed = true;
      throw new Error();
    },
  } as unknown as Database;
  assert(
    (await createWorker(env, db)(new Request('https://worker', { method: 'POST' }))).status === 401,
  );
  assert(!accessed);
});
Deno.test('secrets authenticated encryption rejects changed ciphertext', async () => {
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const encrypted = await encryptSecret({ refreshToken: 'private' }, key);
  assert(
    (await decryptSecret<{ refreshToken: string }>(encrypted, key)).refreshToken === 'private',
  );
  let rejected = false;
  try {
    await decryptSecret(encrypted.slice(0, 10) + 'AAAA' + encrypted.slice(14), key);
  } catch {
    rejected = true;
  }
  assert(rejected);
  assert((await hashToken('private')).length === 64);
});
Deno.test('body is bounded even when content length is missing', async () => {
  let rejected = false;
  try {
    await jsonInput(
      new Request('https://api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'x'.repeat(40000) }),
      }),
    );
  } catch {
    rejected = true;
  }
  assert(rejected);
});
Deno.test('worker completes ping and records handler failure without losing durable work', async () => {
  const calls: { operation: string; input: Record<string, unknown> }[] = [];
  const db = {
    command: (operation: string, _actor: unknown, input: Record<string, unknown>) => {
      calls.push({ operation, input });
      return Promise.resolve(
        operation === 'jobs_claim'
          ? {
            jobs: [
              { id: 'ping-id', kind: 'ping', payload: {}, leaseToken: 'a', attempts: 1 },
              { id: 'failing-id', kind: 'fault', payload: {}, leaseToken: 'b', attempts: 1 },
            ],
          }
          : { ok: true },
      );
    },
  } as unknown as Database;
  const response = await createWorker(env, db, {
    fault: () => Promise.reject(new Error('do not log this secret')),
  })(
    new Request('https://worker', {
      method: 'POST',
      headers: { 'X-Worker-Secret': env.workerSecret },
    }),
  );
  assert(response.status === 200);
  assert(calls.some((call) => call.operation === 'jobs_complete' && call.input.leaseToken === 'a'));
  assert(
    calls.some((call) =>
      call.operation === 'jobs_fail' && call.input.leaseToken === 'b' &&
      call.input.errorCode === 'provider_unavailable'
    ),
  );
});
Deno.test('browser preflight permits Supabase apikey header', async () => {
  const response = await createApi(env, {} as Database).request('/health', {
    method: 'OPTIONS',
    headers: { Origin: env.appOrigin, 'Access-Control-Request-Headers': 'apikey,authorization' },
  });
  assert(response.status === 204);
  assert(response.headers.get('access-control-allow-headers')?.includes('apikey'));
});
