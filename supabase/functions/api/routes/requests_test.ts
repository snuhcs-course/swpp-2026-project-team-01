import { requestsRoutes } from './requests.ts';
import type { Database } from '../../_shared/database.ts';
import type { Environment } from '../../_shared/env.ts';
import { DomainError, errorResponse } from '../../_shared/errors.ts';
import type { RequestView } from '../../../../packages/contracts/index.ts';
const env: Environment = {
  supabaseUrl: 'https://example.supabase.co',
  serviceKey: 'secret',
  appOrigin: 'https://findmeatime.com',
  workerSecret: 'x'.repeat(32),
  encryptionKey: btoa('x'.repeat(32)),
  openaiKey: 'synthetic-openai-key',
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
function api(
  db: Database,
  evaluator?: Parameters<typeof requestsRoutes>[2],
  extract?: Parameters<typeof requestsRoutes>[3],
) {
  const app = requestsRoutes(env, db, evaluator, extract);
  app.onError((error) => errorResponse(error, 'test'));
  return app;
}
Deno.test('requester message returns inert review data without applying or agreeing', async () => {
  const operations: string[] = [];
  const request = {
    id,
    revision: 2,
    requesterAgreed: false,
    hostApproved: false,
    event: null,
    details: {
      requesterName: 'Requester',
      requesterEmail: 'requester@example.com',
      purpose: 'Initial purpose',
      durationMinutes: 30,
      timezone: 'Asia/Seoul',
      mode: 'online',
      location: '',
      windows: [{ start: '2030-06-01T09:00:00+09:00', end: '2030-06-01T10:00:00+09:00' }],
    },
  } as unknown as RequestView;
  const db = {
    command: (operation: string) => {
      operations.push(operation);
      if (operation === 'message_add') return Promise.resolve(request);
      if (operation === 'model_claim') return Promise.resolve({ allowed: true });
      if (operation === 'assistant_message_save') {
        return Promise.resolve({ ...request, revision: 3 });
      }
      throw new Error(`Unexpected operation ${operation}`);
    },
  } as unknown as Database;
  const extract = (() =>
    Promise.resolve({
      intent: 'details' as const,
      clarification: 'Review the requested change.',
      purpose: 'Discuss the research plan',
      mode: null,
      location: null,
      windows: [],
    })) as Parameters<typeof requestsRoutes>[3];
  const response = await api(db, undefined, extract).request(`/requests/${id}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expectedRevision: 1, text: 'Let us discuss the research plan' }),
  });
  const result = await response.json();
  assert(
    response.status === 200 && result.conversationReview.reviewedRevision === 3 &&
      result.conversationReview.patch.purpose === 'Discuss the research plan' &&
      result.requesterAgreed === false && result.hostApproved === false && result.event === null,
  );
  assert(
    JSON.stringify(operations) ===
      JSON.stringify(['message_add', 'model_claim', 'assistant_message_save']),
  );
});
Deno.test('conversation review requires request ownership and explicit confirmation', async () => {
  let called = false;
  const db = {
    command: () => {
      called = true;
      return Promise.resolve({});
    },
  } as unknown as Database;
  const unauthorized = await api(db).request(`/requests/${id}/conversation-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'review' },
    body: JSON.stringify({ expectedRevision: 3, reviewedRevision: 3, confirmed: true, patch: {} }),
  });
  const unconfirmed = await api(db).request(`/requests/${id}/conversation-review`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expectedRevision: 3,
      reviewedRevision: 3,
      confirmed: false,
      patch: { purpose: 'Changed purpose' },
    }),
  });
  assert(unauthorized.status === 401 && unconfirmed.status === 400 && !called);
});
Deno.test('stale conversation review cannot overwrite a newer request revision', async () => {
  const operations: string[] = [];
  const db = {
    command: (operation: string) => {
      operations.push(operation);
      return Promise.resolve(
        operation === 'mutation_replay' ? { found: false } : { revision: 4, details: {} },
      );
    },
  } as unknown as Database;
  const response = await api(db).request(`/requests/${id}/conversation-review`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expectedRevision: 3,
      reviewedRevision: 3,
      confirmed: true,
      patch: { purpose: 'Changed purpose' },
    }),
  });
  assert(
    response.status === 409 &&
      JSON.stringify(operations) === JSON.stringify(['mutation_replay', 'request_read']),
  );
});
Deno.test('confirmed conversation review applies only scheduling fields', async () => {
  let applied: Record<string, unknown> | undefined;
  const current = {
    revision: 3,
    details: {
      requesterName: 'Protected name',
      requesterEmail: 'protected@example.com',
      purpose: 'Initial purpose',
      durationMinutes: 30,
      timezone: 'Asia/Seoul',
      mode: 'online',
      location: '',
      windows: [{ start: '2030-06-01T09:00:00+09:00', end: '2030-06-01T10:00:00+09:00' }],
    },
  };
  const db = {
    command: (operation: string, actor: unknown, input: Record<string, unknown>) => {
      if (operation === 'mutation_replay') return Promise.resolve({ found: false });
      if (operation === 'request_read') {
        assert(JSON.stringify(actor).includes(id));
        return Promise.resolve(current);
      }
      if (operation === 'details_update') {
        applied = input;
        return Promise.resolve({ ...current, revision: 4, details: input.details });
      }
      throw new Error(`Unexpected operation ${operation}`);
    },
  } as unknown as Database;
  const response = await api(db).request(`/requests/${id}/conversation-review`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expectedRevision: 3,
      reviewedRevision: 3,
      confirmed: true,
      patch: {
        purpose: 'Discuss the research plan',
        requesterEmail: 'attacker@example.com',
      },
    }),
  });
  assert(response.status === 400 && applied === undefined);
  const allowed = await api(db).request(`/requests/${id}/conversation-review`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expectedRevision: 3,
      reviewedRevision: 3,
      confirmed: true,
      patch: { purpose: 'Discuss the research plan' },
    }),
  });
  const details = applied?.details as Record<string, unknown>;
  assert(
    allowed.status === 200 && details.requesterName === 'Protected name' &&
      details.requesterEmail === 'protected@example.com' && details.durationMinutes === 30 &&
      details.timezone === 'Asia/Seoul' && details.purpose === 'Discuss the research plan',
  );
});
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
Deno.test('review retry returns its stored result before checking a later revision', async () => {
  const operations: string[] = [];
  const db = {
    command: (operation: string) => {
      operations.push(operation);
      if (operation === 'mutation_replay') {
        return Promise.resolve({ found: true, result: { id, revision: 4 } });
      }
      throw new Error(`Unexpected operation ${operation}`);
    },
  } as unknown as Database;
  const response = await api(db).request(`/requests/${id}/conversation-review`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expectedRevision: 3,
      reviewedRevision: 3,
      confirmed: true,
      patch: { purpose: 'Discuss the research plan' },
    }),
  });
  assert(response.status === 200 && (await response.json()).revision === 4);
  assert(JSON.stringify(operations) === JSON.stringify(['mutation_replay']));
});
Deno.test('malformed review windows fail as input errors without applying details', async () => {
  for (
    const window of [null, [], {
      start: '2030-06-01T09:00:00Z',
      end: '2030-06-01T10:00:00Z',
      hidden: true,
    }, { start: '2030-02-30T09:00:00Z', end: '2030-02-30T10:00:00Z' }]
  ) {
    const db = {
      command: (operation: string) => {
        if (operation === 'mutation_replay') return Promise.resolve({ found: false });
        if (operation === 'request_read') {
          return Promise.resolve({ revision: 3, details: { durationMinutes: 30 } });
        }
        throw new Error('Invalid patch reached details_update');
      },
    } as unknown as Database;
    const response = await api(db).request(`/requests/${id}/conversation-review`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        expectedRevision: 3,
        reviewedRevision: 3,
        confirmed: true,
        patch: { windows: [window] },
      }),
    });
    assert(response.status === 400 && (await response.json()).error.code === 'invalid_input');
  }
});
Deno.test('a saved message retry recovers current state when model claim is stale', async () => {
  const operations: string[] = [];
  let extracted = false;
  const db = {
    command: (operation: string) => {
      operations.push(operation);
      if (operation === 'message_add') return Promise.resolve({ id, revision: 2 });
      if (operation === 'model_claim') {
        return Promise.reject(new DomainError('stale_revision', 409));
      }
      if (operation === 'request_read') return Promise.resolve({ id, revision: 4 });
      throw new Error(`Unexpected operation ${operation}`);
    },
  } as unknown as Database;
  const response = await api(db, undefined, () => {
    extracted = true;
    return Promise.resolve(null);
  }).request(`/requests/${id}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expectedRevision: 1, text: 'Use a different day' }),
  });
  assert(response.status === 200 && (await response.json()).revision === 4 && !extracted);
  assert(
    JSON.stringify(operations) === JSON.stringify(['message_add', 'model_claim', 'request_read']),
  );
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
Deno.test('recovery throttling remains neutral instead of identifying the stored contact', async () => {
  const db = {
    command: () => Promise.reject(new DomainError('rate_limited', 429)),
  } as unknown as Database;
  const response = await api(db).request(`/requests/${id}/recover`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: 'requester@example.com' }),
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
Deno.test('approval source is set only from verified host route and explicit current version', async () => {
  let captured: unknown;
  const db = {
    host: () => Promise.resolve({ kind: 'host', id: 'host', email: 'verified@example.com' }),
    command: (operation: string, actor: unknown, input: unknown) => {
      captured = { operation, actor, input };
      return Promise.resolve({ status: 'booking' });
    },
  } as unknown as Database;
  const response = await api(db).request(`/requests/${id}/approve`, {
    method: 'POST',
    headers: { ...headers, Authorization: 'Bearer verified-host' },
    body: JSON.stringify({
      expectedRevision: 5,
      proposalVersion: 2,
      confirmed: true,
      confirmationSource: 'agent',
      actor: { kind: 'operator' },
    }),
  });
  assert(
    response.status === 200 && JSON.stringify(captured).includes('authenticated_web') &&
      !JSON.stringify(captured).includes('operator') && !JSON.stringify(captured).includes('agent'),
  );
  captured = undefined;
  const missing = await api(db).request(`/requests/${id}/approve`, {
    method: 'POST',
    headers: { ...headers, Authorization: 'Bearer verified-host' },
    body: JSON.stringify({ expectedRevision: 5, proposalVersion: 2, confirmed: false }),
  });
  assert(missing.status === 400 && captured === undefined);
});
