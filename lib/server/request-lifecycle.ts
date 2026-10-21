import { z } from "zod";
import {
  isActionableRequestState,
  type RequestDetails,
  type RequestState,
  type RequestWindow,
} from "../contracts/request";
import { assertRevision, type CommandDefinition, CommandError } from "./commands";
import { supersedeConfirmations } from "./contact-confirmation";
import type { Transaction } from "./database";
import { type JobHandler, publishJob } from "./jobs";
import { lockOpenRequest } from "./request-guard";
import { revokeRequestGrants } from "./requester-grants";

// The request lifecycle (design decision 4; meeting-requests: persisted
// lifecycle and closure guards).
//
//   gathering -> negotiating     a completed evaluation with at least one
//                                candidate while required details are complete
//   negotiating -> gathering     an applied review that changes details, or an
//                                evaluation that needs clarification (Lane D)
//   negotiating -> awaiting_host_approval   request.agree (Lane D)
//   any actionable -> withdrawn  request.withdraw with the expected revision
//   any actionable -> expired    the request_expiry job
//
// Closure, in the closing transaction, deletes the requester's grants (their
// revocation at Google follows as a job), supersedes every live confirmation
// link and every pending review. A closed request never reopens: commands
// reject it with request_closed (request-guard.ts), and replay of a saved
// command returns its saved outcome without running it again.

export const REQUEST_LIFETIME_DAYS = 7;
export const REQUEST_EXPIRY_JOB = "request_expiry";
export const EXPIRY_BATCH = 200;

// The earlier of creation plus seven days and the end of the latest requested
// window. Lane D recomputes it with this whenever windows are applied.
export function requestExpiresAt(createdAt: Date, windows: readonly RequestWindow[] = []) {
  const lifetime = createdAt.getTime() + REQUEST_LIFETIME_DAYS * 86_400_000;
  const latestEnd = Math.max(...windows.map((window) => Date.parse(window.end)).filter(Number.isFinite), -Infinity);
  return new Date(Number.isFinite(latestEnd) ? Math.min(lifetime, latestEnd) : lifetime);
}

export type ClosingState = "withdrawn" | "expired";

// Closes a request locked by the caller. Returns false when it was already
// closed or not actionable (a booking in flight is left to Phase 4's guard).
export async function closeRequest(tx: Transaction, requestId: string, state: ClosingState) {
  const closed = await tx`
    update app.requests
    set state = ${state}, closed_at = now(), revision = revision + 1, updated_at = now()
    where id = ${requestId} and state in ('gathering', 'negotiating', 'awaiting_host_approval')
  `;

  if (closed.count === 0) return false;

  await revokeRequestGrants(tx, requestId);
  await supersedeConfirmations(tx, requestId);
  await tx`
    update app.request_reviews set state = 'superseded', resolved_at = now()
    where request_id = ${requestId} and state = 'pending'
  `;
  return true;
}

export type WithdrawResult = { readonly state: "withdrawn"; readonly revision: number };

// request.withdraw (**Withdraw request**): from any actionable state, at the
// expected revision. A closed or expired request is rejected with
// request_closed; an exact retry after commit returns the saved result.
export const withdrawRequestCommand: CommandDefinition<Record<string, never>, WithdrawResult> = {
  input: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
  operation: "request.withdraw",
  async run(tx, context) {
    if (context.actor.kind !== "requester_request" || context.actor.id !== context.resourceId) {
      throw new CommandError("forbidden");
    }

    const request = await lockOpenRequest(tx, context.actor.id);
    assertRevision(request.revision, context.expectedRevision);

    if (!isActionableRequestState(request.state)) throw new CommandError("request_closed");

    await closeRequest(tx, request.id, "withdrawn");
    return { revision: request.revision + 1, state: "withdrawn" };
  },
};

// The request_expiry job, published every 5 minutes by app.publish_request_expiry
// when a request is due: closes up to 200 due requests, skipping rows another
// transaction holds (a command finishing on one closes or rejects it itself),
// and publishes a follow-up job while a full batch suggests more are due.
export function createRequestExpiryHandler(): JobHandler {
  return async (tx, job) => {
    const due = await tx<{ id: string }[]>`
      select id from app.requests
      where state in ('gathering', 'negotiating', 'awaiting_host_approval') and expires_at <= now()
      order by expires_at
      limit ${EXPIRY_BATCH}
      for update skip locked
    `;

    for (const request of due) await closeRequest(tx, request.id, "expired");

    if (due.length === EXPIRY_BATCH) {
      await publishJob(tx, { dedupeKey: `continue:${job.id}`, kind: REQUEST_EXPIRY_JOB });
    }

    return { expired: due.length };
  };
}

// Whether the details the evaluation needs are present: a duration, a mode and
// at least one window.
export function detailsComplete(details: Partial<RequestDetails>) {
  return Boolean(details.durationMinutes && details.mode && (details.windows?.length ?? 0) > 0);
}

// gathering -> negotiating, run by the evaluation job in its publishing
// transaction, under the request lock it already holds and after its revision
// check: a completed evaluation with candidates moves a gathering request whose
// details are complete. The state change does not advance the revision, so the
// evaluation that caused it stays the request's current one.
export async function markNegotiating(tx: Transaction, requestId: string, candidates: number) {
  if (candidates < 1) return false;

  const [request] = await tx<{ details: Partial<RequestDetails>; state: RequestState }[]>`
    select state, details from app.requests where id = ${requestId}
  `;

  if (request?.state !== "gathering" || !detailsComplete(request.details)) return false;

  await tx`
    update app.requests set state = 'negotiating', updated_at = now()
    where id = ${requestId} and state = 'gathering'
  `;
  return true;
}
