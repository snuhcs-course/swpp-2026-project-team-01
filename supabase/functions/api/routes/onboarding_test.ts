import { createApi } from '../app.ts';
import type { Database } from '../../_shared/database.ts';
import type { Environment } from '../../_shared/env.ts';
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
