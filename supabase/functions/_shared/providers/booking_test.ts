import { createBookingProvider } from './booking.ts';
import type { BookingAttempt } from '../modules/booking/index.ts';
const attempt: BookingAttempt = {
  attemptId: 'attempt',
  requestId: 'request',
  hostId: 'host',
  proposalVersion: 2,
  expectedRevision: 7,
  rulesVersion: 3,
  connectionId: 'connection',
  payloadFingerprint: 'sql-fingerprint',
  calendarId: 'work@example.com',
  eventId: 'fmat01234',
  phase: 'prepared',
  payload: {
    id: 'fmat01234',
    summary: 'Approved meeting',
    description: 'Approved public purpose',
    location: 'Host supplied link',
    start: { dateTime: '2030-06-01T09:00:00Z', timeZone: 'UTC' },
    end: { dateTime: '2030-06-01T09:30:00Z', timeZone: 'UTC' },
    attendees: [{ email: 'verified@example.com' }],
    extendedProperties: {
      private: { fmatRequestId: 'request', fmatAttemptId: 'attempt', fmatProposalVersion: '2' },
    },
  },
};
const credential = () =>
  Promise.resolve({
    accessToken: 'synthetic',
    refreshToken: 'synthetic',
    expiresAt: '2099-01-01T00:00:00Z',
    scope: 'events',
  });
Deno.test('Google booking insert sends exact frozen payload/ID/destination and attendee updates', async () => {
  let url = '';
  let body = '';
  let method = '';
  const fetcher = ((input: string, init: RequestInit) => {
    url = String(input);
    body = String(init.body);
    method = init.method || '';
    return Promise.resolve(Response.json({ ...attempt.payload, status: 'confirmed' }));
  }) as typeof fetch;
  const result = await createBookingProvider(credential, fetcher).insert(attempt);
  const parsed = new URL(url);
  if (
    result.kind !== 'created' || method !== 'POST' ||
    parsed.pathname !== '/calendar/v3/calendars/work%40example.com/events' ||
    parsed.searchParams.get('sendUpdates') !== 'all' || body !== JSON.stringify(attempt.payload) ||
    body.includes('createRequest')
  ) throw new Error('Frozen Google write changed');
});
Deno.test('Google insert response loss/rate limit remains uncertain and duplicate ID triggers lookup', async () => {
  const lost = (() => Promise.reject(new Error('response lost'))) as typeof fetch;
  if ((await createBookingProvider(credential, lost).insert(attempt)).kind !== 'uncertain') {
    throw new Error('Lost write classified noncreating');
  }
  const limited = (() => Promise.resolve(new Response('{}', { status: 429 }))) as typeof fetch;
  if ((await createBookingProvider(credential, limited).insert(attempt)).kind !== 'uncertain') {
    throw new Error('Transient write classified noncreating');
  }
  const duplicate = (() => Promise.resolve(new Response('{}', { status: 409 }))) as typeof fetch;
  if ((await createBookingProvider(credential, duplicate).insert(attempt)).kind !== 'duplicate') {
    throw new Error('Duplicate not reconciled');
  }
});
Deno.test('Google GET observes only persisted event and never treats absence as a new insert', async () => {
  let url = '';
  let method = '';
  const fetcher = ((input: string, init: RequestInit) => {
    url = String(input);
    method = init.method || 'GET';
    return Promise.resolve(new Response('{}', { status: 404 }));
  }) as typeof fetch;
  const result = await createBookingProvider(credential, fetcher).lookup(attempt);
  if (
    result.kind !== 'not_found' || method !== 'GET' ||
    new URL(url).pathname !== '/calendar/v3/calendars/work%40example.com/events/fmat01234'
  ) throw new Error('Recovery changed identity or created event');
});
Deno.test('revoked credential causes no Google write and GET recovery remains credential-limited', async () => {
  let calls = 0;
  const fetcher = (() => {
    calls++;
    throw new Error('unexpected fetch');
  }) as typeof fetch;
  const provider = createBookingProvider(() => Promise.reject(new Error('revoked')), fetcher);
  if (
    (await provider.insert(attempt)).kind !== 'rejected' ||
    (await provider.lookup(attempt)).kind !== 'credential_error' || calls
  ) throw new Error('Revoked credential reached Google');
});
