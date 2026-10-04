import type { Actor, Database } from '../../database.ts';
import { createDurableBookingHandler } from './durable.ts';
import type { BookingAttempt } from './index.ts';

function assert(value: unknown): asserts value {
  if (!value) throw new Error('assertion failed');
}
const attempt: BookingAttempt = {
  attemptId: 'attempt',
  requestId: 'request',
  hostId: 'host',
  proposalVersion: 1,
  expectedRevision: 4,
  rulesVersion: 2,
  connectionId: 'connection',
  payloadFingerprint: 'server-canonical-digest',
  calendarId: 'calendar',
  eventId: 'abc123',
  phase: 'prepared',
  payload: {
    id: 'abc123',
    summary: 'Confirmed meeting',
    description: 'Shared purpose',
    location: 'Room A',
    start: { dateTime: '2026-10-12T09:00:00Z', timeZone: 'UTC' },
    end: { dateTime: '2026-10-12T09:30:00Z', timeZone: 'UTC' },
    attendees: [{ email: 'verified@example.com' }],
    extendedProperties: {
      private: { fmatRequestId: 'request', fmatAttemptId: 'attempt', fmatProposalVersion: '1' },
    },
  },
};
Deno.test('durable adapter uses claim actor fence and echoes SQL fingerprint without rehashing', async () => {
  const calls: { operation: string; actor: Actor; input: Record<string, unknown> }[] = [];
  const database: Database = {
    command: <T>(operation: string, actor: Actor, input: Record<string, unknown>): Promise<T> => {
      calls.push({ operation, actor, input });
      return Promise.resolve((operation === 'booking_load' ? attempt : { dispatched: true }) as T);
    },
    host: () => {
      throw new Error('host authentication is not a worker operation');
    },
  };
  const run = createDurableBookingHandler({
    database,
    revalidate: () =>
      Promise.resolve({
        allowed: true,
        guards: {
          attemptId: 'injected',
          expectedRevision: 99,
          jobId: 'wrong-job',
          connectionId: 'wrong-connection',
          feasibility: { valid: true, checkedAt: '2026-10-12T08:59:59Z' },
        },
      }),
    insert: () =>
      Promise.resolve({ kind: 'created', event: { ...attempt.payload, status: 'confirmed' } }),
    lookup: () => {
      throw new Error('successful insert needs no GET');
    },
  });
  await run({
    id: 'claimed-job',
    leaseToken: 'claimed-fence',
    payload: { requestId: 'request', workerId: 'injected' },
  }, { kind: 'worker', id: 'trusted-claim-actor' });
  assert(
    calls.map((c) => c.operation).join(',') ===
      'booking_load,booking_dispatch,booking_record_outcome',
  );
  assert(
    calls.every((c) =>
      c.actor.id === 'trusted-claim-actor' && c.input.jobId === 'claimed-job' &&
      c.input.leaseToken === 'claimed-fence'
    ),
  );
  assert(
    calls[1].input.attemptId === 'attempt' && calls[1].input.expectedRevision === 4 &&
      calls[1].input.connectionId === 'connection',
  );
  const evidence = calls[2].input.evidence as Record<string, unknown>;
  assert(
    calls[2].input.outcome === 'confirmed' &&
      evidence.payloadFingerprint === 'server-canonical-digest',
  );
  assert(evidence.calendarId === 'calendar' && evidence.eventId === 'abc123');
});
Deno.test('durable adapter refuses a job without a bound request before loading anything', async () => {
  const run = createDurableBookingHandler({
    database: {
      command: () => {
        throw new Error('must not load');
      },
      host: () => {
        throw new Error();
      },
    },
    revalidate: () => {
      throw new Error();
    },
    insert: () => {
      throw new Error();
    },
    lookup: () => {
      throw new Error();
    },
  });
  let code = '';
  try {
    await run({ id: 'job', leaseToken: 'fence', payload: {} }, { kind: 'worker', id: 'claim' });
  } catch (error) {
    code = (error as Error).message;
  }
  assert(code === 'invalid_booking_job');
});
