import type { Database } from '../../database.ts';
import type { Environment } from '../../env.ts';
import { DomainError } from '../../errors.ts';
import { type Connection, createOAuth } from '../onboarding/oauth.ts';
import { createEvaluator } from '../requests/evaluation.ts';
import { createCalendarReader } from '../../providers/calendar.ts';
import { createGoogle } from '../../providers/google.ts';
import { createBookingProvider } from '../../providers/booking.ts';
import { deadlineFetcher, type Fetcher } from '../../providers/transport.ts';
import { evaluateSlot } from '../scheduling/index.ts';
import { withLocalBookings } from '../scheduling/local_bookings.ts';
export { withLocalBookings } from '../scheduling/local_bookings.ts';
import { createDurableBookingHandler } from '../booking/durable.ts';
import type { BookingAttempt, BookingDependencies, Revalidation } from '../booking/index.ts';

export function createBookingRuntime(
  env: Environment,
  database: Database,
  options: {
    fetcher?: Fetcher;
    oauth?: ReturnType<typeof createOAuth>;
    calendars?: ReturnType<typeof createCalendarReader>;
  } = {},
) {
  const fetcher = options.fetcher || fetch;
  const oauthFor = (deadlineAt: number) =>
    options.oauth ||
    createOAuth(env, database, createGoogle(env, deadlineFetcher(deadlineAt, fetcher)));
  const matches = (connection: Connection, attempt: Readonly<BookingAttempt>) =>
    connection.connectionId === attempt.connectionId && !!attempt.connectionProviderSubject &&
    connection.providerSubject === attempt.connectionProviderSubject;
  const revalidate: BookingDependencies['revalidate'] = async (attempt): Promise<Revalidation> => {
    const deadlineAt = Date.now() + 18000;
    try {
      const oauth = oauthFor(deadlineAt);
      const host = await oauth.credential({ hostId: attempt.hostId });
      if (
        !matches(host.connection, attempt) ||
        host.connection.bookingCalendarId !== attempt.calendarId || !host.connection.updatedAt ||
        !Number.isFinite(Date.parse(host.connection.updatedAt))
      ) return { allowed: false, code: 'reconnect_required' };
      const providerCalendars = await oauth.google.calendars(host.credential);
      if (
        !providerCalendars.some((calendar) =>
          calendar.id === attempt.calendarId && ['writer', 'owner'].includes(calendar.accessRole)
        )
      ) return { allowed: false, code: 'calendar_permission' };
      const reader = options.calendars ||
        createCalendarReader(deadlineFetcher(deadlineAt, fetcher));
      const evaluator = createEvaluator(env, database, oauth, {
        ...reader,
        hostEvents: async (credential, calendars, start, end, timezone) => {
          const effectiveCalendars = [...new Set([...calendars, attempt.calendarId])];
          return withLocalBookings(
            await reader.hostEvents(
              credential,
              effectiveCalendars,
              start,
              end,
              timezone,
            ),
            (attempt.localBookings || []).filter((booking) =>
              effectiveCalendars.includes(booking.calendarId)
            ),
          );
        },
      }, { fetcher });
      const { snapshot, input } = await evaluator.context(
        attempt.requestId,
        attempt.expectedRevision,
        undefined,
        deadlineAt,
      );
      if (
        snapshot.hostId !== attempt.hostId || snapshot.rulesVersion !== attempt.rulesVersion ||
        input.details.location !== attempt.payload.location
      ) return { allowed: false, code: 'stale_revision' };
      const result = await evaluateSlot(input, {
        start: attempt.payload.start.dateTime,
        end: attempt.payload.end.dateTime,
      });
      if (!result.feasible || result.unresolved || Date.now() >= deadlineAt) {
        return { allowed: false, code: 'not_feasible' };
      }
      return {
        allowed: true,
        guards: {
          connectionUpdatedAt: host.connection.updatedAt,
          providerSubject: host.connection.providerSubject,
          feasibility: { valid: true, checkedAt: new Date().toISOString() },
        },
      };
    } catch (error) {
      return {
        allowed: false,
        code: error instanceof DomainError ? error.code : 'provider_unavailable',
      };
    }
  };
  const provider = createBookingProvider(async (attempt) => {
    const host = await oauthFor(Date.now() + 12000).credential({ hostId: attempt.hostId });
    if (!matches(host.connection, attempt)) throw new DomainError('reconnect_required', 409);
    return host.credential;
  }, fetcher);
  const handler = createDurableBookingHandler({
    database,
    revalidate,
    insert: provider.insert,
    lookup: provider.lookup,
  });
  return { handler, revalidate, provider };
}
