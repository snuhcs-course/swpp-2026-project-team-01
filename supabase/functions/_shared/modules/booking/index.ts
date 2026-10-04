/** Persisted Google payload. It contains only approved shared meeting information. */
export interface EventPayload {
  id: string;
  summary: string;
  description: string;
  location: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees: { email: string }[];
  extendedProperties: {
    private: { fmatRequestId: string; fmatAttemptId: string; fmatProposalVersion: string };
  };
}

/** Never synthesize this snapshot in a queue adapter: the database freezes it before dispatch. */
export interface BookingAttempt {
  attemptId: string;
  requestId: string;
  hostId: string;
  proposalVersion: number;
  expectedRevision: number;
  rulesVersion: number;
  connectionId: string;
  connectionProviderSubject?: string;
  localBookings?: {
    payload: EventPayload;
    startsAt: string;
    endsAt: string;
    mode: 'online' | 'in_person';
    calendarId: string;
  }[];
  /** SQL canonical JSON digest; echo this exact value rather than hashing JavaScript serialization. */
  payloadFingerprint: string;
  calendarId: string;
  eventId: string;
  payload: EventPayload;
  phase:
    | 'prepared'
    | 'dispatched'
    | 'uncertain'
    | 'confirmed'
    | 'noncreating'
    | 'blocked'
    | 'conflict';
}
export interface BookingJob {
  id: string;
  leaseToken: string;
  payload: Record<string, unknown>;
}
export interface ProviderEvent {
  id?: string;
  status?: string;
  htmlLink?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  attendees?: { email?: string }[];
  extendedProperties?: { private?: Record<string, string> };
  recurrence?: unknown[];
}
export type InsertResult =
  | { kind: 'created'; event: ProviderEvent }
  | { kind: 'duplicate' }
  | { kind: 'rejected'; code: string }
  | { kind: 'uncertain'; code: string };
export type LookupResult =
  | { kind: 'found'; event: ProviderEvent }
  | { kind: 'not_found' }
  | { kind: 'credential_error' | 'unavailable'; code: string };
export type BookingOutcome =
  | { kind: 'confirmed'; eventId: string; url: string | null }
  | { kind: 'uncertain' | 'noncreating' | 'blocked' | 'conflict'; code: string };
export type Revalidation =
  | { allowed: true; guards: Record<string, unknown> }
  | { allowed: false; code: string };
export interface BookingDependencies {
  /** Loading and mutations must check the current job lease/fence, not just the attempt ID. */
  load(job: BookingJob): Promise<BookingAttempt | null>;
  /** Fresh grants, selected writable calendar, rules, decisions, host/requester busy and both trips. */
  revalidate(attempt: Readonly<BookingAttempt>): Promise<Revalidation>;
  /** Atomically checks guards, lease, reservation, lifecycle/approval and marks possible dispatch. */
  dispatch(
    job: BookingJob,
    attempt: Readonly<BookingAttempt>,
    guards: Record<string, unknown>,
  ): Promise<boolean>;
  /** Inserts this exact payload/destination with sendUpdates=all. Never generate another ID. */
  insert(attempt: Readonly<BookingAttempt>): Promise<InsertResult>;
  /** GET only the saved calendar/event, including during credential/lifecycle recovery. */
  lookup(attempt: Readonly<BookingAttempt>): Promise<LookupResult>;
  /** Fenced SQL: confirmation + reservation release + audience-safe outbox are one transaction. */
  record(
    job: BookingJob,
    attempt: Readonly<BookingAttempt>,
    outcome: BookingOutcome,
  ): Promise<void>;
}

function emails(attendees: { email?: string }[] | undefined): string[] | null {
  if (!attendees || attendees.some((a) => !a.email)) return null;
  const values = attendees.map((a) => a.email!.trim().toLowerCase()).sort();
  return new Set(values).size === values.length ? values : null;
}
function sameInstant(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const value = Date.parse(actual);
  return Number.isFinite(value) && value === Date.parse(expected);
}

/** A duplicate-ID response and a matching ID alone cannot prove that this request was booked. */
export function verifiesEvent(attempt: BookingAttempt, event: ProviderEvent): boolean {
  const expected = attempt.payload;
  const association = event.extendedProperties?.private;
  const actualEmails = emails(event.attendees);
  const expectedEmails = emails(expected.attendees);
  return event.id === attempt.eventId && event.id === expected.id &&
    (event.status === 'confirmed' || event.status === 'tentative') &&
    !event.recurrence?.length &&
    association?.fmatRequestId === attempt.requestId &&
    association?.fmatAttemptId === attempt.attemptId &&
    association?.fmatProposalVersion === String(attempt.proposalVersion) &&
    event.summary === expected.summary && event.description === expected.description &&
    event.location === expected.location &&
    sameInstant(event.start?.dateTime, expected.start.dateTime) &&
    sameInstant(event.end?.dateTime, expected.end.dateTime) &&
    event.start?.timeZone === expected.start.timeZone &&
    event.end?.timeZone === expected.end.timeZone &&
    actualEmails !== null && expectedEmails !== null &&
    JSON.stringify(actualEmails) === JSON.stringify(expectedEmails);
}

function validAttempt(attempt: BookingAttempt): boolean {
  const payload = attempt.payload;
  return /^[0-9a-v]{5,1024}$/.test(attempt.eventId) && !!attempt.calendarId &&
    Number.isInteger(attempt.proposalVersion) && attempt.proposalVersion > 0 &&
    payload.id === attempt.eventId &&
    payload.extendedProperties.private.fmatRequestId === attempt.requestId &&
    payload.extendedProperties.private.fmatAttemptId === attempt.attemptId &&
    payload.extendedProperties.private.fmatProposalVersion === String(attempt.proposalVersion) &&
    Number.isFinite(Date.parse(payload.start.dateTime)) &&
    Date.parse(payload.end.dateTime) > Date.parse(payload.start.dateTime) &&
    payload.attendees.length > 0 && emails(payload.attendees) !== null;
}

/** One bounded provider step. SQL owns durable follow-up jobs and operational escalation. */
export function createBookingHandler(deps: BookingDependencies) {
  const observe = async (job: BookingJob, attempt: BookingAttempt): Promise<void> => {
    let found: LookupResult;
    try {
      found = await deps.lookup(attempt);
    } catch {
      found = { kind: 'unavailable', code: 'lookup_unavailable' };
    }
    const outcome: BookingOutcome = found.kind === 'found'
      ? verifiesEvent(attempt, found.event)
        ? { kind: 'confirmed', eventId: attempt.eventId, url: safeEventUrl(found.event.htmlLink) }
        : { kind: 'conflict', code: 'provider_event_mismatch' }
      : {
        kind: 'uncertain',
        code: found.kind === 'not_found' ? 'event_not_observed' : found.code,
      };
    // A persistence failure must propagate: saved `dispatched` remains a reconciliation obligation.
    await deps.record(job, attempt, outcome);
  };
  return async (job: BookingJob): Promise<void> => {
    const loaded = await deps.load(job);
    if (!loaded || ['confirmed', 'noncreating', 'blocked', 'conflict'].includes(loaded.phase)) {
      return;
    }
    // Adapter callbacks cannot mutate the durable snapshot between revalidation and insertion.
    const attempt = deepFreeze(structuredClone(loaded));
    if (!validAttempt(attempt)) throw new Error('invalid_frozen_booking');
    if (attempt.phase === 'dispatched' || attempt.phase === 'uncertain') {
      // New rules, withdrawal or expired leases cannot erase an external side effect.
      await observe(job, attempt);
      return;
    }
    const checked = await deps.revalidate(attempt);
    if (!checked.allowed) {
      await deps.record(job, attempt, { kind: 'blocked', code: checked.code });
      return;
    }
    // If this commit succeeds but its response is lost, no call occurs here; a redelivery GETs only.
    if (!await deps.dispatch(job, attempt, checked.guards)) return;
    let inserted: InsertResult;
    try {
      inserted = await deps.insert(attempt);
    } catch {
      inserted = { kind: 'uncertain', code: 'insert_response_lost' };
    }
    if (inserted.kind === 'created') {
      await deps.record(
        job,
        attempt,
        verifiesEvent(attempt, inserted.event)
          ? {
            kind: 'confirmed',
            eventId: attempt.eventId,
            url: safeEventUrl(inserted.event.htmlLink),
          }
          : { kind: 'conflict', code: 'provider_event_mismatch' },
      );
    } else if (inserted.kind === 'rejected') {
      await deps.record(job, attempt, { kind: 'noncreating', code: inserted.code });
    } else if (inserted.kind === 'duplicate') {
      await observe(job, attempt);
    } else {
      await deps.record(job, attempt, { kind: 'uncertain', code: inserted.code });
    }
  };
}

function safeEventUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.google.com' && !url.username &&
        !url.password
      ? value
      : null;
  } catch {
    return null;
  }
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
