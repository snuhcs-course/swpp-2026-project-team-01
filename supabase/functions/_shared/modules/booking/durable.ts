import type { Database } from '../../database.ts';
import {
  type BookingAttempt,
  type BookingDependencies,
  type BookingJob,
  createBookingHandler,
} from './index.ts';

export interface BookingWorkerActor {
  kind: 'worker';
  /** Captured from jobs_claim; never accepted from a queue payload. */
  id: string;
}
export interface DurableBookingDependencies {
  database: Database;
  revalidate: BookingDependencies['revalidate'];
  insert: BookingDependencies['insert'];
  lookup: BookingDependencies['lookup'];
}

/** SQL owns state transitions; this adapter echoes frozen identity and canonical fingerprints. */
export function createDurableBookingHandler(deps: DurableBookingDependencies) {
  return async (job: BookingJob, actor: BookingWorkerActor): Promise<void> => {
    if (actor.kind !== 'worker' || !actor.id || typeof job.payload.requestId !== 'string') {
      throw new Error('invalid_booking_job');
    }
    const fence = { jobId: job.id, leaseToken: job.leaseToken };
    const run = createBookingHandler({
      load: () =>
        deps.database.command<BookingAttempt | null>('booking_load', actor, {
          ...fence,
          requestId: job.payload.requestId,
        }),
      revalidate: deps.revalidate,
      dispatch: async (_job, attempt, guards) => {
        const result = await deps.database.command<{ dispatched: boolean }>(
          'booking_dispatch',
          actor,
          {
            ...guards,
            ...fence,
            attemptId: attempt.attemptId,
            expectedRevision: attempt.expectedRevision,
            rulesVersion: attempt.rulesVersion,
            connectionId: attempt.connectionId,
          },
        );
        return result.dispatched === true;
      },
      insert: deps.insert,
      lookup: deps.lookup,
      record: async (_job, attempt, outcome) => {
        await deps.database.command('booking_record_outcome', actor, {
          ...fence,
          attemptId: attempt.attemptId,
          outcome: outcome.kind,
          ...(outcome.kind === 'confirmed'
            ? {
              evidence: {
                calendarId: attempt.calendarId,
                eventId: attempt.eventId,
                eventUrl: outcome.url,
                payloadFingerprint: attempt.payloadFingerprint,
              },
            }
            : { reason: outcome.code }),
        });
      },
    });
    await run(job);
  };
}
