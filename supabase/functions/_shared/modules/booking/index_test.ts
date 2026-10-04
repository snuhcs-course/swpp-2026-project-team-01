import {
  type BookingAttempt,
  type BookingDependencies,
  type BookingJob,
  type BookingOutcome,
  createBookingHandler,
  type InsertResult,
  type LookupResult,
  type ProviderEvent,
  verifiesEvent,
} from './index.ts';

function assert(value: unknown, message = 'assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`,
  );
}
function fixture() {
  const attempt: BookingAttempt = {
    attemptId: 'attempt-one',
    requestId: 'request-one',
    hostId: 'host-one',
    proposalVersion: 2,
    expectedRevision: 8,
    rulesVersion: 3,
    connectionId: 'connection-one',
    payloadFingerprint: 'sql-canonical-fingerprint',
    calendarId: 'selected-calendar',
    eventId: 'abc123abcdef',
    phase: 'prepared',
    payload: {
      id: 'abc123abcdef',
      summary: 'Meeting with Ada',
      description: 'Review the project',
      location: 'https://meet.example.com/room',
      start: { dateTime: '2026-10-12T09:00:00Z', timeZone: 'Asia/Seoul' },
      end: { dateTime: '2026-10-12T09:30:00Z', timeZone: 'Asia/Seoul' },
      attendees: [{ email: 'ada@example.com' }],
      extendedProperties: {
        private: {
          fmatRequestId: 'request-one',
          fmatAttemptId: 'attempt-one',
          fmatProposalVersion: '2',
        },
      },
    },
  };
  const job: BookingJob = {
    id: 'job-one',
    leaseToken: 'current-fence',
    payload: { requestId: attempt.requestId },
  };
  const records: BookingOutcome[] = [];
  let lease = job.leaseToken;
  let approvalCurrent = true;
  let reservation = true;
  let writes = 0;
  let reads = 0;
  let revalidations = 0;
  const event = (): ProviderEvent => ({
    ...structuredClone(attempt.payload),
    status: 'confirmed',
    htmlLink: 'https://www.google.com/calendar/event?eid=one',
  });
  const deps: BookingDependencies = {
    load: (j) => Promise.resolve(j.leaseToken === lease ? structuredClone(attempt) : null),
    revalidate: () => {
      revalidations++;
      return Promise.resolve(
        approvalCurrent
          ? { allowed: true, guards: { revision: 8, rulesVersion: 3 } }
          : { allowed: false, code: 'stale_approval' },
      );
    },
    dispatch: (j) => {
      if (
        j.leaseToken !== lease || !approvalCurrent || !reservation || attempt.phase !== 'prepared'
      ) return Promise.resolve(false);
      attempt.phase = 'dispatched';
      return Promise.resolve(true);
    },
    insert: () => {
      writes++;
      return Promise.resolve({ kind: 'created', event: event() });
    },
    lookup: () => {
      reads++;
      return Promise.resolve({ kind: 'found', event: event() });
    },
    record: (j, _a, outcome) => {
      if (j.leaseToken !== lease) throw new Error('lease_lost');
      records.push(outcome);
      attempt.phase = outcome.kind;
      if (
        outcome.kind === 'confirmed' || outcome.kind === 'noncreating' || outcome.kind === 'blocked'
      ) reservation = false;
      return Promise.resolve();
    },
  };
  return {
    attempt,
    job,
    deps,
    records,
    event,
    state: () => ({ reservation, writes, reads, revalidations }),
    withdraw: () => {
      approvalCurrent = false;
    },
    transfer: () => {
      lease = 'next-fence';
      return { ...job, leaseToken: lease };
    },
    insert: (fn: () => Promise<InsertResult>) => {
      deps.insert = async () => {
        writes++;
        return await fn();
      };
    },
    lookup: (result: LookupResult) => {
      deps.lookup = () => {
        reads++;
        return Promise.resolve(result);
      };
    },
  };
}

Deno.test('booking requires final fresh prerequisites and confirms exactly the frozen event', async () => {
  const f = fixture();
  await createBookingHandler(f.deps)(f.job);
  equal(f.state(), { reservation: false, writes: 1, reads: 0, revalidations: 1 });
  equal(f.records[0].kind, 'confirmed');
});
Deno.test('lost successful insert response retains reservation and reconciles the same event', async () => {
  const f = fixture();
  f.insert(() => {
    throw new Error('connection lost after Google committed');
  });
  const run = createBookingHandler(f.deps);
  await run(f.job);
  equal(f.attempt.phase, 'uncertain');
  assert(f.state().reservation);
  await run(f.job);
  equal(f.attempt.phase, 'confirmed');
  equal(f.state().writes, 1);
  equal(f.state().reads, 1);
});
Deno.test('immediate not-found never retries insert or releases uncertain reservation', async () => {
  const f = fixture();
  f.insert(() => Promise.resolve({ kind: 'uncertain', code: 'deadline' }));
  f.lookup({ kind: 'not_found' });
  const run = createBookingHandler(f.deps);
  await run(f.job);
  for (let i = 0; i < 3; i++) await run(f.job);
  equal(f.state().writes, 1);
  equal(f.attempt.phase, 'uncertain');
  assert(f.state().reservation);
});
Deno.test('duplicate jobs cannot dispatch the same persisted attempt twice', async () => {
  const f = fixture();
  const run = createBookingHandler(f.deps);
  await Promise.all([run(f.job), run(f.job)]);
  equal(f.state().writes, 1);
  await run(f.job);
  equal(f.state().writes, 1);
});
Deno.test('duplicate Google ID is evidence only after association and immutable content verify', async () => {
  const f = fixture();
  f.insert(() => Promise.resolve({ kind: 'duplicate' }));
  f.lookup({
    kind: 'found',
    event: { ...f.event(), extendedProperties: { private: { fmatRequestId: 'another-request' } } },
  });
  await createBookingHandler(f.deps)(f.job);
  equal(f.records[0], { kind: 'conflict', code: 'provider_event_mismatch' });
  assert(f.state().reservation);
});
Deno.test('process termination before dispatch causes no write and can be reclaimed safely', async () => {
  const f = fixture();
  const original = f.deps.revalidate;
  f.deps.revalidate = () => {
    throw new Error('terminated');
  };
  try {
    await createBookingHandler(f.deps)(f.job);
  } catch { /* process boundary */ }
  equal(f.state().writes, 0);
  f.deps.revalidate = original;
  await createBookingHandler(f.deps)(f.transfer());
  equal(f.state().writes, 1);
});
Deno.test('lost dispatch response creates no second write and is conservatively reconciled', async () => {
  const f = fixture();
  const dispatch = f.deps.dispatch;
  f.deps.dispatch = async (...args) => {
    await dispatch(...args);
    throw new Error('commit response lost');
  };
  try {
    await createBookingHandler(f.deps)(f.job);
  } catch { /* worker exits */ }
  f.lookup({ kind: 'not_found' });
  await createBookingHandler(f.deps)(f.transfer());
  equal(f.state().writes, 0);
  equal(f.attempt.phase, 'uncertain');
  assert(f.state().reservation);
});
Deno.test('termination after provider success but before result persistence remains recoverable', async () => {
  const f = fixture();
  const record = f.deps.record;
  f.deps.record = () => {
    throw new Error('terminated before commit');
  };
  try {
    await createBookingHandler(f.deps)(f.job);
  } catch { /* worker exits */ }
  equal(f.attempt.phase, 'dispatched');
  f.deps.record = record;
  await createBookingHandler(f.deps)(f.transfer());
  equal(f.attempt.phase, 'confirmed');
  equal(f.state().writes, 1);
});
Deno.test('lease changes during insert fence old completion without freeing reservation', async () => {
  const f = fixture();
  let next = f.job;
  f.insert(() => {
    next = f.transfer();
    return Promise.resolve({ kind: 'created', event: f.event() });
  });
  try {
    await createBookingHandler(f.deps)(f.job);
  } catch { /* old owner cannot commit */ }
  equal(f.attempt.phase, 'dispatched');
  assert(f.state().reservation);
  await createBookingHandler(f.deps)(next);
  equal(f.state().writes, 1);
  equal(f.attempt.phase, 'confirmed');
});
Deno.test('changed rules availability or grants before dispatch blocks creation', async () => {
  for (
    const code of [
      'rules_changed',
      'requester_busy',
      'reconnect_required',
      'booking_calendar_not_writable',
      'route_unavailable',
    ]
  ) {
    const f = fixture();
    f.deps.revalidate = () => Promise.resolve({ allowed: false, code });
    await createBookingHandler(f.deps)(f.job);
    equal(f.state().writes, 0);
    equal(f.records[0], { kind: 'blocked', code });
  }
});
Deno.test('withdrawal between fresh read and atomic dispatch prevents any provider call', async () => {
  const f = fixture();
  f.deps.revalidate = () => {
    f.withdraw();
    return Promise.resolve({ allowed: true, guards: {} });
  };
  await createBookingHandler(f.deps)(f.job);
  equal(f.state().writes, 0);
});
Deno.test('withdrawal after possible dispatch cannot erase the matching provider event', async () => {
  const f = fixture();
  f.insert(() => {
    f.withdraw();
    return Promise.resolve({ kind: 'uncertain', code: 'deadline' });
  });
  const run = createBookingHandler(f.deps);
  await run(f.job);
  await run(f.job);
  equal(f.attempt.phase, 'confirmed');
  equal(f.state().writes, 1);
  equal(f.state().revalidations, 1);
});
Deno.test('revoked recovery credentials leave uncertain reservation pending', async () => {
  const f = fixture();
  f.attempt.phase = 'uncertain';
  f.lookup({ kind: 'credential_error', code: 'reconnect_required' });
  await createBookingHandler(f.deps)(f.job);
  equal(f.records[0], { kind: 'uncertain', code: 'reconnect_required' });
  assert(f.state().reservation);
  equal(f.state().writes, 0);
});
Deno.test('definitive provider rejection is distinct from network uncertainty', async () => {
  const f = fixture();
  f.insert(() => Promise.resolve({ kind: 'rejected', code: 'permission_denied' }));
  await createBookingHandler(f.deps)(f.job);
  equal(f.attempt.phase, 'noncreating');
  assert(!f.state().reservation);
});
Deno.test('provider evidence rejects cancelled changed-time or injected-recipient events', () => {
  const f = fixture();
  assert(verifiesEvent(f.attempt, f.event()));
  for (
    const change of [
      { status: 'cancelled' },
      { id: 'another-event' },
      { summary: 'another meeting' },
      { start: { dateTime: '2026-10-12T09:15:00Z', timeZone: 'Asia/Seoul' } },
      { attendees: [{ email: 'ada@example.com' }, { email: 'intruder@example.com' }] },
      { recurrence: ['RRULE:FREQ=DAILY'] },
    ]
  ) assert(!verifiesEvent(f.attempt, { ...f.event(), ...change }));
});
Deno.test('notification is never executed by booking and missing URL is not fabricated', async () => {
  const f = fixture();
  f.insert(() =>
    Promise.resolve({
      kind: 'created',
      event: { ...f.event(), htmlLink: 'javascript:alert(1)' },
    })
  );
  await createBookingHandler(f.deps)(f.job);
  equal(f.records[0], { kind: 'confirmed', eventId: f.attempt.eventId, url: null });
});
