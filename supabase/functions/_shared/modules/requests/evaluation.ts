import type { Database } from '../../database.ts';
import type { Environment } from '../../env.ts';
import { DomainError } from '../../errors.ts';
import { createOAuth } from '../onboarding/oauth.ts';
import { createCalendarReader, createRoutes } from '../../providers/calendar.ts';
import { createGoogle } from '../../providers/google.ts';
import { deadlineFetcher, type Fetcher } from '../../providers/transport.ts';
import { type CandidateRanker, createCandidateRanker } from '../../providers/ranking.ts';
import { evaluateCandidates, evaluateSlot, type SchedulingInput } from '../scheduling/index.ts';
import { type ConfirmedBooking, withLocalBookings } from '../scheduling/local_bookings.ts';
import type {
  HostRules,
  MeetingDetails,
  RequestView,
  TimeWindow,
} from '../../../../../packages/contracts/index.ts';
export interface EvaluationSnapshot {
  requestId: string;
  hostId: string;
  revision: number;
  rulesVersion: number;
  rules: HostRules;
  details: MeetingDetails;
  requesterConnection: boolean;
  localBookings?: ConfirmedBooking[];
  privateSchedulingContext?: Pick<
    SchedulingInput,
    'physicalContext' | 'candidatePhysicalLocation' | 'manualTravelAllowances'
  >;
}
export function createEvaluator(
  env: Environment,
  db: Database,
  oauth?: ReturnType<typeof createOAuth>,
  calendars?: ReturnType<typeof createCalendarReader>,
  options: { evaluationMs?: number; fetcher?: Fetcher; rank?: CandidateRanker } = {},
) {
  const worker = () => ({ kind: 'worker' as const, id: crypto.randomUUID() });
  return {
    async context(
      requestId: string,
      expectedRevision?: number,
      override?: Partial<MeetingDetails>,
      deadlineAt = Date.now() + (options.evaluationMs ?? 18000),
    ): Promise<{ snapshot: EvaluationSnapshot; input: SchedulingInput }> {
      const snapshot = await db.command<EvaluationSnapshot>('evaluation_read', worker(), {
        requestId,
      });
      if (expectedRevision !== undefined && snapshot.revision !== expectedRevision) {
        throw new DomainError('stale_revision', 409);
      }
      const details = { ...snapshot.details, ...override };
      if (!details.windows.length) throw new DomainError('invalid_input');
      const starts = details.windows.map((window) => Date.parse(window.start));
      const ends = details.windows.map((window) => Date.parse(window.end));
      const lower = Math.min(...starts);
      const upper = Math.max(...ends);
      if (
        !Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower ||
        upper - lower > 31 * 86400000
      ) throw new DomainError('invalid_input');
      const start = new Date(lower - 86400000).toISOString();
      const end = new Date(upper + 86400000).toISOString();
      const fetcher = deadlineFetcher(deadlineAt, options.fetcher);
      const provider = oauth || createOAuth(env, db, createGoogle(env, fetcher));
      const reader = calendars || createCalendarReader(fetcher);
      const { connection, credential } = await provider.credential({ hostId: snapshot.hostId });
      if (!connection.conflictCalendarIds.length) throw new DomainError('reconnect_required', 409);
      const providerEvents = await reader.hostEvents(
        credential,
        connection.conflictCalendarIds,
        start,
        end,
        snapshot.rules.timezone,
      );
      const hostEvents = withLocalBookings(providerEvents, snapshot.localBookings || []);
      let requesterBusy: TimeWindow[] = [];
      if (snapshot.requesterConnection) {
        const requester = await provider.credential({ requestId });
        requesterBusy = await reader.requesterBusy(requester.credential, start, end);
      }
      return {
        snapshot,
        input: {
          rules: snapshot.rules,
          details,
          hostEvents,
          requesterBusy,
          ...snapshot.privateSchedulingContext,
          hostId: snapshot.hostId,
          rulesVersion: snapshot.rulesVersion,
          route: createRoutes(env, fetcher),
          limit: 24,
        },
      };
    },
    async evaluate(
      requestId: string,
      expectedRevision: number,
      idempotencyKey: string,
    ): Promise<RequestView> {
      const deadlineAt = Date.now() + (options.evaluationMs ?? 18000);
      const { snapshot, input } = await this.context(
        requestId,
        expectedRevision,
        undefined,
        deadlineAt,
      );
      const result = await evaluateCandidates(input);
      if (result.unresolved) result.privateDiagnostics.push({ code: 'evaluation_unresolved' });
      if (Date.now() >= deadlineAt) {
        result.unresolved = true;
        result.privateDiagnostics.push({ code: 'evaluation_unresolved' }, {
          code: 'evaluation_budget_exceeded',
        });
      }
      if (
        env.openaiKey && input.rules.preferences.trim() && result.candidates.length > 1 &&
        Date.now() < deadlineAt
      ) {
        const budget = await db.command<{ allowed: boolean }>('model_claim', worker(), {
          requestId,
          expectedRevision,
        });
        if (budget.allowed) {
          const rank = options.rank ||
            createCandidateRanker(env, deadlineFetcher(deadlineAt, options.fetcher));
          result.candidates = await rank(result.candidates, input.rules.preferences);
        }
      }
      return await db.command<RequestView>('candidates_save', worker(), {
        requestId,
        expectedRevision,
        rulesVersion: snapshot.rulesVersion,
        candidates: result.candidates,
        privateDiagnostics: result.privateDiagnostics,
        privateTravelChecks: result.privateTravelChecks,
        unresolved: result.unresolved,
        idempotencyKey,
      });
    },
    async validate(
      requestId: string,
      expectedRevision: number,
      slot: TimeWindow,
      override?: Partial<MeetingDetails>,
    ) {
      const { snapshot, input } = await this.context(requestId, expectedRevision, override);
      const result = await evaluateSlot(input, slot);
      if (!result.feasible || result.unresolved) throw new DomainError('not_feasible', 409);
      return {
        rulesVersion: snapshot.rulesVersion,
        requestRevision: snapshot.revision,
        start: slot.start,
        end: slot.end,
        mode: input.details.mode,
        location: input.details.location,
      };
    },
  };
}
