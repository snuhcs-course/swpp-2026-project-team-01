import { createApi } from '../app.ts';
import type { Database } from '../../_shared/database.ts';
import type { Environment } from '../../_shared/env.ts';
import { hashToken } from '../../_shared/security.ts';
const env: Environment = {
  supabaseUrl: 'https://test.supabase.co',
  appOrigin: 'https://findmeatime.com',
  serviceKey: 'secret',
  workerSecret: 'x'.repeat(32),
  externalSends: false,
  openaiModel: 'gpt-4o-mini-2024-07-18',
};
function assert(value: unknown) {
  if (!value) throw new Error('Assertion failed');
}
Deno.test('public waitlist normalizes email and never accepts actor claims', async () => {
  let captured: unknown;
  const db = {
    command: (operation: string, actor: unknown, input: unknown) => {
      captured = { operation, actor, input };
      return Promise.resolve({ status: 'pending' });
    },
  } as unknown as Database;
  const response = await createApi(env, db).request('/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'waitlist-key' },
    body: JSON.stringify({ email: 'Requester@Example.com', actor: { kind: 'operator' } }),
  });
  assert(response.status === 200);
  assert(JSON.stringify(captured).includes('requester@example.com'));
  assert(!JSON.stringify(captured).includes('operator'));
});
Deno.test('host setup requires verified auth before any command executes', async () => {
  let called = false;
  const db = {
    command: () => {
      called = true;
      return Promise.resolve({});
    },
  } as unknown as Database;
  const response = await createApi(env, db).request('/host/setup');
  assert(response.status === 401 && !called);
});
Deno.test('invitation plaintext is hashed before service command', async () => {
  const token = 'private-invitation-token-'.repeat(3);
  let captured: unknown;
  const db = {
    host: () => Promise.resolve({ kind: 'host', id: 'host-id', email: 'verified@example.com' }),
    command: (_operation: string, _actor: unknown, input: unknown) => {
      captured = input;
      return Promise.resolve({ admitted: true });
    },
  } as unknown as Database;
  const response = await createApi(env, db).request('/host/invitations/redeem', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer verified-jwt',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'invite-key',
    },
    body: JSON.stringify({ token }),
  });
  assert(response.status === 200 && !JSON.stringify(captured).includes(token));
  assert(JSON.stringify(captured).includes('tokenHash'));
});
Deno.test('short invitation code is canonicalized before hashing', async () => {
  let captured: Record<string, unknown> | undefined;
  const db = {
    host: () => Promise.resolve({ kind: 'host', id: 'host-id', email: 'verified@example.com' }),
    command: (_operation: string, _actor: unknown, input: Record<string, unknown>) => {
      captured = input;
      return Promise.resolve({ admitted: true });
    },
  } as unknown as Database;
  const response = await createApi(env, db).request('/host/invitations/redeem', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer verified-jwt',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'invite-code-key',
    },
    body: JSON.stringify({ code: 'oI23 4567 89ab cdef' }),
  });
  assert(response.status === 200);
  assert(captured?.tokenHash === await hashToken('0123-4567-89AB-CDEF'));
});
Deno.test('malformed short invitation code is rejected before redemption', async () => {
  let called = false;
  const db = {
    host: () => Promise.resolve({ kind: 'host', id: 'host-id', email: 'verified@example.com' }),
    command: () => { called = true; return Promise.resolve({ admitted: true }); },
  } as unknown as Database;
  const response = await createApi(env, db).request('/host/invitations/redeem', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer verified-jwt',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'bad-invite-code-key',
    },
    body: JSON.stringify({ code: '1234' }),
  });
  assert(response.status === 400 && !called);
});
Deno.test('calendar destination permissions come from provider rather than caller input', async () => {
  const { onboardingRoutes } = await import('./onboarding.ts');
  let captured: unknown;
  const db = {
    host: () => Promise.resolve({ kind: 'host', id: 'host-id' }),
    command: (_op: string, _actor: unknown, input: unknown) => {
      captured = input;
      return Promise.resolve({});
    },
  } as unknown as Database;
  const oauth = {
    credential: () => Promise.resolve({ credential: {} }),
    google: { calendars: () => Promise.resolve([{ id: 'readonly', accessRole: 'reader' }]) },
  } as unknown as Parameters<typeof onboardingRoutes>[2];
  const response = await onboardingRoutes(env, db, oauth).request('/host/calendar-settings', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer session',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'settings-key',
    },
    body: JSON.stringify({
      conflictCalendarIds: ['readonly'],
      bookingCalendarId: 'readonly',
      verifiedCalendars: [{ id: 'readonly', accessRole: 'owner' }],
    }),
  });
  assert(response.status === 200);
  assert(
    JSON.stringify(captured).includes('reader') && !JSON.stringify(captured).includes('owner'),
  );
});
Deno.test('setup transcript is host-authenticated and body host claims are ignored', async () => {
  let called = false;
  const db = {
    command: () => {
      called = true;
      return Promise.resolve({});
    },
  } as unknown as Database;
  const response = await createApi(env, db).request('/host/setup/conversation');
  assert(response.status === 401 && !called);
});
Deno.test('bridge requires dedicated secret before reading provider inputs', async () => {
  let called = false;
  const db = {
    command: () => {
      called = true;
      return Promise.resolve({});
    },
  } as unknown as Database;
  const enabled = {
    ...env,
    photonBridgeEnabled: true,
    photonBridgeSecret: 'bridge-secret-'.repeat(4),
  };
  for (const authorization of ['Bearer ordinary-web-jwt', 'Bearer ' + env.workerSecret]) {
    const response = await createApi(enabled, db).request('/internal/setup/imessage/resume', {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert(response.status === 401 && !called);
  }
});
Deno.test('bridge cursor maps safe persisted sequence and exact private message rejects forged groups', async () => {
  const calls: { op: string; input: Record<string, unknown> }[] = [];
  const db = {
    command: (op: string, _actor: unknown, input: Record<string, unknown>) => {
      calls.push({ op, input });
      return Promise.resolve({ lastSequence: '42' });
    },
  } as unknown as Database;
  const enabled = {
    ...env,
    photonBridgeEnabled: true,
    photonBridgeSecret: 'bridge-secret-'.repeat(4),
  };
  const headers = {
    Authorization: 'Bearer ' + enabled.photonBridgeSecret,
    'Content-Type': 'application/json',
  };
  const resume = await createApi(enabled, db).request('/internal/setup/imessage/resume', {
    method: 'POST',
    headers,
    body: '{}',
  });
  assert(
    resume.status === 200 && (await resume.json()).lastSequence === 42 &&
      calls[0].input.provider === 'imessage',
  );
  const rejected = await createApi(enabled, db).request('/internal/setup/imessage/inbound', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sender: '+821012345678',
      conversationId: 'any;+;group',
      service: 'iMessage',
      providerMessageId: 'fixture',
      body: 'Hello',
      createdAt: '2030-01-01T00:00:00Z',
    }),
  });
  assert(rejected.status === 400 && calls.length === 1);
});
Deno.test('link proof is hashed and browser challenge retry is stable', async () => {
  const captures: Record<string, unknown>[] = [];
  const db = {
    host: () => Promise.resolve({ kind: 'host', id: 'verified-host' }),
    command: (_op: string, _actor: unknown, input: Record<string, unknown>) => {
      captures.push(input);
      return Promise.resolve({
        challengeId: '11111111-1111-4111-8111-111111111111',
        expiresAt: '2030-01-01',
      });
    },
  } as unknown as Database;
  const enabled = {
    ...env,
    photonBridgeEnabled: true,
    photonBridgeSecret: 'bridge-secret-'.repeat(4),
  };
  const headers = {
    Authorization: 'Bearer host-session',
    'Content-Type': 'application/json',
    'Idempotency-Key': 'stable-challenge',
  };
  const request = () =>
    createApi(enabled, db).request('/host/imessage/link/start', {
      method: 'POST',
      headers,
      body: '{}',
    });
  const one = await (await request()).json();
  const two = await (await request()).json();
  assert(one.challengeSecret === two.challengeSecret && one.browserProof === two.browserProof);
  assert(
    !JSON.stringify(captures).includes(one.challengeSecret) &&
      !JSON.stringify(captures).includes(one.browserProof),
  );
});
Deno.test('permanent invalid linking challenge is rejected without blocking bridge replay', async () => {
  const { DomainError } = await import('../../_shared/errors.ts');
  const db = {
    command: (op: string) => {
      assert(op === 'setup_link_challenge_claim');
      return Promise.reject(new DomainError('challenge_invalid'));
    },
  } as unknown as Database;
  const enabled = {
    ...env,
    photonBridgeEnabled: true,
    photonBridgeSecret: 'bridge-secret-'.repeat(4),
  };
  const response = await createApi(enabled, db).request('/internal/setup/imessage/inbound', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + enabled.photonBridgeSecret,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sequence: 1,
      providerMessageId: 'fixture',
      conversationId: 'any;-;+821012345678',
      sender: '+821012345678',
      service: 'iMessage',
      body: 'LINK 11111111-1111-4111-8111-111111111111 ' + 'x'.repeat(64),
      createdAt: '2030-01-01T00:00:00Z',
    }),
  });
  assert(response.status === 200 && (await response.json()).disposition === 'rejected');
});
Deno.test('outbound authorization requires active scoped authority and maps persisted fenced intent', async () => {
  const { DomainError } = await import('../../_shared/errors.ts');
  const enabled = {
    ...env,
    photonBridgeEnabled: true,
    photonBridgeSecret: 'bridge-secret-'.repeat(4),
  };
  const request = (db: Database) =>
    createApi(enabled, db).request('/internal/setup/imessage/outbound/authorize', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + enabled.photonBridgeSecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ intentId: '11111111-1111-4111-8111-111111111111', hostId: 'forged' }),
    });
  const active = {
    command: (_op: string, _actor: unknown, input: Record<string, unknown>) => {
      assert(!('hostId' in input));
      return Promise.resolve({
        action: 'reconcile',
        conversationId: 'private',
        clientMessageId: 'stable',
      });
    },
  } as unknown as Database;
  const allowed = await (await request(active)).json();
  assert(allowed.authorized === true && allowed.clientMessageId === 'stable');
  const revoked = {
    command: () => Promise.reject(new DomainError('link_not_found')),
  } as unknown as Database;
  assert((await (await request(revoked)).json()).authorized === false);
});
Deno.test('processed inbound recovers original confirmation reply after crash before outbox', async () => {
  const calls: string[] = [];
  let reply = '';
  const original = {
    revision: 3,
    turns: [{ text: 'Settings confirmed.' }],
    review: { revision: 1, status: 'confirmed' },
    draft: null,
  };
  const db = {
    command: (op: string, _actor: unknown, input: Record<string, unknown>) => {
      calls.push(op);
      if (op === 'setup_channel_authorize') {
        return Promise.resolve({
          conversationId: 'owned-conversation',
        });
      }
      if (op === 'setup_provider_inbound_record') {
        return Promise.resolve({
          inboundId: '11111111-1111-4111-8111-111111111111',
          duplicate: true,
          processed: true,
          existingOutbound: false,
          result: original,
        });
      }
      if (op === 'setup_conversation_read') {
        return Promise.resolve({
          revision: 9,
          turns: [{ text: 'Newer unrelated draft' }],
          review: { revision: 2, status: 'pending' },
          draft: null,
        });
      }
      if (op === 'setup_provider_outbound_prepare') {
        reply = String(input.text);
        return Promise.resolve({});
      }
      throw new Error('Unexpected remutation: ' + op);
    },
  } as unknown as Database;
  const enabled = {
    ...env,
    photonBridgeEnabled: true,
    photonBridgeSecret: 'bridge-secret-'.repeat(4),
  };
  const response = await createApi(enabled, db).request('/internal/setup/imessage/inbound', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + enabled.photonBridgeSecret,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sequence: 1,
      providerMessageId: 'fixture-confirm',
      conversationId: 'any;-;+821012345678',
      sender: '+821012345678',
      service: 'iMessage',
      body: 'CONFIRM 1',
      createdAt: '2030-01-01T00:00:00Z',
    }),
  });
  assert(
    response.status === 200 && reply.includes('Settings confirmed.') &&
      !reply.includes('Newer unrelated draft') && !calls.includes('setup_review_confirm') &&
      !calls.includes('setup_turn_append'),
  );
});
