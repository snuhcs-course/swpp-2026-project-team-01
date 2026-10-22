import { randomUUID } from "node:crypto";
import type { ConfirmedSettings } from "../../../lib/contracts/setup";
import { BOOKING_JOB, type BookingDependencies, createBookingHandler } from "../../../lib/server/bookings";
import { type CommandDefinition, runCommand } from "../../../lib/server/commands";
import type { Database } from "../../../lib/server/database";
import { agreeCommand, chooseCandidateCommand, evaluateCommand, readCurrentEvaluation } from "../../../lib/server/request-proposals";
import { fakeGoogleConfig, runJob } from "./calendar-host";
import type { FakeEvent, FakeGoogle } from "./fake-google";
import { testNotices } from "./requests";
import {
  asRequester,
  calendarKey,
  evaluationDeps,
  revisionOf,
  runEvaluation,
  type SchedulingRequest,
  seedSchedulingRequest,
} from "./scheduling";

// Requests that await the host's approval, written the way the requester's
// commands leave them (evaluated, a candidate chosen, the proposal agreed), and
// helpers to act as the host and to run one booking job through the real
// handler against the fake Google.

export type AgreedRequest = SchedulingRequest & {
  readonly start: string;
  readonly end: string;
};

export async function agreedRequest(
  db: Database,
  google: FakeGoogle,
  options: {
    readonly details?: Record<string, unknown>;
    readonly events?: FakeEvent[];
    readonly settings?: Partial<ConfirmedSettings>;
    readonly candidateIndex?: number;
  } = {},
): Promise<AgreedRequest> {
  const request = await seedSchedulingRequest(db, google, options);
  const evaluated = await asRequester(db, request.requestId, evaluateCommand, {});
  if (!evaluated.ok) throw new Error(`evaluate failed: ${evaluated.error.category}`);
  await runEvaluation(db, evaluationDeps(db, google), evaluated.result.evaluationId);

  const view = await readCurrentEvaluation(db, request.requestId);
  const candidate = view?.candidates[options.candidateIndex ?? 0];
  if (!view || !candidate) throw new Error("no candidate");

  const revision = await revisionOf(db, request.requestId);
  const chosen = await asRequester(
    db,
    request.requestId,
    chooseCandidateCommand,
    { candidateId: candidate.id, evaluationId: view.id },
    { expectedRevision: revision },
  );
  if (!chosen.ok || chosen.result.outcome !== "proposed") throw new Error("choose failed");

  const agreed = await asRequester(db, request.requestId, agreeCommand, { version: chosen.result.version }, { expectedRevision: revision });
  if (!agreed.ok) throw new Error(`agree failed: ${agreed.error.category}`);

  return { ...request, end: candidate.end, start: candidate.start };
}

export function asHost<Input, Result>(
  db: Database,
  hostAccountId: string,
  requestId: string,
  command: CommandDefinition<Input, Result>,
  input: unknown,
  options: { readonly expectedRevision?: number | null; readonly retryKey?: string } = {},
) {
  return runCommand({ authenticate: async () => ({ id: hostAccountId, kind: "host_account" }), db }, command, {
    expectedRevision: options.expectedRevision ?? null,
    input,
    resourceId: requestId,
    retryKey: options.retryKey ?? randomUUID(),
  });
}

export function bookingDeps(db: Database, google: FakeGoogle, overrides: Partial<BookingDependencies> = {}): BookingDependencies {
  return {
    calendar: fakeGoogleConfig(google),
    db,
    evaluation: evaluationDeps(db, google),
    notices: testNotices,
    tokenKeys: [calendarKey],
    ...overrides,
  };
}

export async function bookingJobs(db: Database, bookingId: string) {
  return db<{ attempts: number; id: string; state: string }[]>`
    select id, state, attempts from app.jobs where kind = ${BOOKING_JOB} and payload ->> 'bookingId' = ${bookingId}
    order by created_at
  `;
}

// Runs the booking's pending job once through the real handler.
export async function runBooking(db: Database, deps: BookingDependencies, bookingId: string) {
  const job = (await bookingJobs(db, bookingId)).find((entry) => entry.state === "pending");
  if (!job) throw new Error("no pending booking job");
  return runJob(db, job.id, createBookingHandler(() => deps));
}

export async function bookingOf(db: Database, bookingId: string) {
  const [row] = await db<
    { attempts: number; event_id: string; evidence: Record<string, unknown> | null; failure_category: string | null; state: string }[]
  >`
    select state, failure_category, event_id, evidence, attempts from app.bookings where id = ${bookingId}
  `;
  return row!;
}

export async function requestState(db: Database, requestId: string) {
  const [row] = await db<{ revision: number; state: string }[]>`select state, revision from app.requests where id = ${requestId}`;
  return row!;
}

export async function deliveriesOf(db: Database, requestId: string) {
  return db<{ attachments: { content: string; filename: string; type: string }[]; kind: string; parameters: Record<string, unknown>; recipients: string[]; reply_to: string | null; sender: string }[]>`
    select kind, recipients, reply_to, sender, attachments, parameters from app.email_deliveries
    where request_id = ${requestId} and kind <> 'request_creation'
    order by created_at
  `;
}
