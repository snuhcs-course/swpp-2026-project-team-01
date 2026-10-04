import { requestsRoutes } from './requests.ts';
import type { Database } from '../../_shared/database.ts';
import type { Environment } from '../../_shared/env.ts';
import { DomainError, errorResponse } from '../../_shared/errors.ts';
const env: Environment = {
  supabaseUrl: 'https://example.supabase.co',
  serviceKey: 'secret',
  appOrigin: 'https://findmeatime.com',
  workerSecret: 'x'.repeat(32),
  encryptionKey: btoa('x'.repeat(32)),
  openaiModel: 'gpt-4o-mini-2024-07-18',
  externalSends: false,
};
const id = '00000000-0000-4000-8000-000000000001';
const headers = {
  'Content-Type': 'application/json',
  'Idempotency-Key': 'request-key',
  'X-Request-Token': 'synthetic-request-secret'.repeat(2),
};
function assert(value: unknown) {
  if (!value) throw new Error('Assertion failed');
}
function api(db: Database, evaluator?: Parameters<typeof requestsRoutes>[2]) {
  const app = requestsRoutes(env, db, evaluator);
  app.onError((error) => errorResponse(error, 'test'));
  return app;
}
Deno.test('request creation retry credentials ignore JSON object key order', async () => {
  const db = { command: () => Promise.resolve({ id }) } as unknown as Database;
  const app = api(db);
  const first = await app.request('/hosts/host/requests', {
    method: 'POST',
    headers,
    body: JSON.stringify({ purpose: 'Meet', location: 'Online' }),
  });
  const second = await app.request('/hosts/host/requests', {
    method: 'POST',
    headers,
    body: JSON.stringify({ location: 'Online', purpose: 'Meet' }),
  });
  const x = await first.json();
  const y = await second.json();
  assert(x.token === y.token && x.token.length === 43);
});
Deno.test('unauthorized guest cannot trigger provider evaluation', async () => {
  let evaluated = false;
  const db = {
    command: () => Promise.reject(new DomainError('not_found', 404)),
  } as unknown as Database;
  const evaluator = {
    evaluate: () => {
      evaluated = true;
      return Promise.resolve({});
    },
  } as unknown as Parameters<typeof requestsRoutes>[2];
  const result = await api(db, evaluator).request(`/requests/${id}/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expectedRevision: 1 }),
  });
  assert(result.status === 404 && !evaluated);
});
Deno.test('verification initiation never exposes plaintext code in response or SQL input', async () => {
  let captured: Record<string, unknown> = {};
  const db = {
    command: (_op: string, _actor: unknown, input: Record<string, unknown>) => {
      captured = input;
      return Promise.resolve({ id, revision: 2, contactVerified: false });
    },
  } as unknown as Database;
  const response = await api(db).request(`/requests/${id}/verification/start`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expectedRevision: 1 }),
  });
  const data = await response.json();
  assert(data.status === 'pending' && data.request.contactVerified === false);
  assert(
    !('code' in data) && typeof captured.encryptedCode === 'string' &&
      typeof captured.codeHash === 'string',
  );
});
Deno.test('recovery response is neutral for unavailable request and mismatched contact', async () => {
  const db = {
    command: () => Promise.reject(new DomainError('not_found', 404)),
  } as unknown as Database;
  const response = await api(db).request(`/requests/${id}/recover`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: 'wrong@example.com' }),
  });
  assert(response.status === 200 && (await response.json()).status === 'pending');
});
Deno.test('proposal retry returns cached result before any new provider call', async () => {
  let evaluated = false;
  const db = {
    command: () => Promise.resolve({ found: true, result: { id, revision: 2 } }),
  } as unknown as Database;
  const evaluator = {
    validate: () => {
      evaluated = true;
      throw new Error();
    },
  } as unknown as Parameters<typeof requestsRoutes>[2];
  const response = await api(db, evaluator).request(`/requests/${id}/proposal`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expectedRevision: 1,
      start: '2030-06-01T09:00:00Z',
      end: '2030-06-01T09:30:00Z',
    }),
  });
  assert(response.status === 200 && !evaluated && (await response.json()).revision === 2);
});
Deno.test('private preference exception cannot waive a newly discovered hard conflict', async () => {
  let saved = false;
  const db = {
    host: () => Promise.resolve({ kind: 'host', id: 'host' }),
    command: (operation: string) => {
      if (operation === 'mutation_replay') return Promise.resolve({ found: false });
      if (operation === 'request_read') {
        return Promise.resolve({
          proposal: { version: 1, start: '2030-06-01T09:00:00Z', end: '2030-06-01T09:30:00Z' },
        });
      }
      saved = true;
      return Promise.resolve({});
    },
  } as unknown as Database;
  const evaluator = {
    validate: () => Promise.reject(new DomainError('not_feasible', 409)),
  } as unknown as Parameters<typeof requestsRoutes>[2];
  const response = await api(db, evaluator).request(`/requests/${id}/preference-exception`, {
    method: 'POST',
    headers: { ...headers, Authorization: 'Bearer verified-host' },
    body: JSON.stringify({
      expectedRevision: 1,
      proposalVersion: 1,
      confirmed: true,
      reason: 'Explicit soft preference exception',
    }),
  });
  assert(response.status === 409 && !saved);
});
