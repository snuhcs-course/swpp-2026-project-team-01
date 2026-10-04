import { createBookingRuntime, withLocalBookings } from './index.ts';
import type { BookingAttempt } from '../booking/index.ts';
import type { Database } from '../../database.ts';
import type { Environment } from '../../env.ts';
import type { EvaluationSnapshot } from '../requests/evaluation.ts';
import type { Connection, createOAuth } from '../onboarding/oauth.ts';
import type { createCalendarReader } from '../../providers/calendar.ts';
const slot = { start: '2030-06-01T09:00:00Z', end: '2030-06-01T09:30:00Z' };
function fixture() {
  const attempt: BookingAttempt = {
    attemptId: 'attempt',
    requestId: 'request',
    hostId: 'host',
    proposalVersion: 1,
    expectedRevision: 5,
    rulesVersion: 2,
    connectionId: 'connection',
    connectionProviderSubject: 'provider-subject',
    payloadFingerprint: 'sql-only-fingerprint',
    calendarId: 'booking',
    eventId: 'fmat01234',
    phase: 'prepared',
    localBookings: [],
    payload: {
      id: 'fmat01234',
      summary: 'Public meeting',
      description: 'Public purpose',
      location: 'Host video link',
      start: { dateTime: slot.start, timeZone: 'UTC' },
      end: { dateTime: slot.end, timeZone: 'UTC' },
      attendees: [{ email: 'verified@example.com' }],
      extendedProperties: {
        private: { fmatRequestId: 'request', fmatAttemptId: 'attempt', fmatProposalVersion: '1' },
      },
    },
  };
  const snapshot: EvaluationSnapshot = {
    requestId: 'request',
    hostId: 'host',
    revision: 5,
    rulesVersion: 2,
    requesterConnection: false,
    rules: {
      timezone: 'UTC',
      durationMinutes: 30,
      availability: [{ days: [6], start: '09:00', end: '17:00' }],
      focusBlocks: [],
      bufferMinutes: 0,
      travelMode: 'WALK',
      preferences: '',
    },
    details: {
      requesterName: 'Requester',
      requesterEmail: 'verified@example.com',
      purpose: 'Talk',
      durationMinutes: 30,
      timezone: 'UTC',
      windows: [slot],
      mode: 'online',
      location: attempt.payload.location,
    },
  };
  const connection: Connection = {
    connectionId: 'connection',
    providerSubject: 'provider-subject',
    updatedAt: '2030-01-01T00:00:00Z',
    conflictCalendarIds: ['work'],
    bookingCalendarId: 'booking',
    encryptedCredential: 'synthetic',
    scopes: [],
  };
  let accessRole = 'writer';
  let requested: string[] = [];
  let busy = false;
  let writes = 0;
  const db = {
    command: (operation: string) => {
      if (operation !== 'evaluation_read') {
        writes++;
        throw new Error('Unexpected SQL mutation');
      }
      return Promise.resolve(snapshot);
    },
  } as unknown as Database;
  const oauth = {
    credential: () => Promise.resolve({ connection, credential: { accessToken: 'synthetic' } }),
    google: { calendars: () => Promise.resolve([{ id: 'booking', accessRole }]) },
  } as unknown as ReturnType<typeof createOAuth>;
  const calendars = {
    hostEvents: (_credential: unknown, ids: string[]) => {
      requested = ids;
      return Promise.resolve(busy ? [{ ...slot, mode: 'online' as const }] : []);
    },
    requesterBusy: () => Promise.resolve([slot]),
  } as ReturnType<typeof createCalendarReader>;
  const runtime = createBookingRuntime({} as Environment, db, {
    oauth,
    calendars,
    fetcher: () => {
      throw new Error('Unexpected external call');
    },
  });
  return {
    attempt,
    snapshot,
    connection,
    runtime,
    setRole: (role: string) => accessRole = role,
    setBusy: () => busy = true,
    requested: () => requested,
    writes: () => writes,
  };
}
Deno.test('booking fresh context includes exact destination union and returns credential fence', async () => {
  const f = fixture();
  const result = await f.runtime.revalidate(f.attempt);
  if (
    !result.allowed || result.guards.connectionUpdatedAt !== f.connection.updatedAt ||
    result.guards.providerSubject !== f.connection.providerSubject ||
    !f.requested().includes('work') || !f.requested().includes('booking') || f.writes()
  ) throw new Error('Booking guard/destination union lost');
});
Deno.test('destination-only conflict and changed requester busy stop booking before dispatch', async () => {
  const host = fixture();
  host.setBusy();
  if ((await host.runtime.revalidate(host.attempt)).allowed || host.writes()) {
    throw new Error('Booking destination conflict ignored');
  }
  const requester = fixture();
  requester.snapshot.requesterConnection = true;
  if ((await requester.runtime.revalidate(requester.attempt)).allowed || requester.writes()) {
    throw new Error('Requester busy change ignored');
  }
});
Deno.test('calendar permissions/account connection/rules changes fail fresh booking guards', async () => {
  for (
    const mutate of [
      (f: ReturnType<typeof fixture>) => f.setRole('reader'),
      (f: ReturnType<typeof fixture>) => f.connection.providerSubject = 'different-account',
      (f: ReturnType<typeof fixture>) => f.connection.bookingCalendarId = 'different-calendar',
      (f: ReturnType<typeof fixture>) => f.snapshot.rulesVersion++,
    ]
  ) {
    const f = fixture();
    mutate(f);
    if ((await f.runtime.revalidate(f.attempt)).allowed || f.writes()) {
      throw new Error('Changed prerequisite permitted dispatch');
    }
  }
});
Deno.test('confirmed local booking blocks during provider read lag and preserves virtual mode', async () => {
  const f = fixture();
  f.attempt.localBookings = [{
    payload: { ...f.attempt.payload, id: 'previous012' },
    startsAt: slot.start,
    endsAt: slot.end,
    mode: 'online',
    calendarId: 'booking',
  }];
  if ((await f.runtime.revalidate(f.attempt)).allowed) {
    throw new Error('Local confirmed interval absent from busy');
  }
  const merged = withLocalBookings([{
    id: 'booking:previous012',
    ...slot,
    mode: 'in_person',
    location: 'Video URL',
    physicalLocation: 'Video URL',
  }], f.attempt.localBookings);
  if (
    merged.length !== 1 || merged[0].mode !== 'online' || merged[0].physicalLocation ||
    merged[0].location
  ) throw new Error('Virtual link became physical whereabouts');
});
Deno.test('local receipts follow current conflict selections plus frozen destination', async () => {
  for (const calendarId of ['unselected-old-calendar', 'work', 'booking']) {
    const f = fixture();
    f.attempt.localBookings = [{
      payload: { ...f.attempt.payload, id: 'previous012' },
      startsAt: slot.start,
      endsAt: slot.end,
      mode: 'online',
      calendarId,
    }];
    const result = await f.runtime.revalidate(f.attempt);
    if (result.allowed !== (calendarId === 'unselected-old-calendar') || f.writes()) {
      throw new Error(`Receipt scope disagrees with effective Calendar union: ${calendarId}`);
    }
  }
});
Deno.test('changed physical travel context cannot silently become a feasible booking', async () => {
  const f = fixture();
  f.snapshot.details.mode = 'in_person';
  f.snapshot.privateSchedulingContext = {
    physicalContext: [{ at: '2030-06-01T08:00:00Z', location: 'Unresolved previous address' }],
  };
  if ((await f.runtime.revalidate(f.attempt)).allowed || f.writes()) {
    throw new Error('Unknown trip waived');
  }
});
