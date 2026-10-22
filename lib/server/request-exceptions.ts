import { z } from "zod";
import { lockHostRequest } from "./bookings";
import { type CommandDefinition, CommandError } from "./commands";
import type { Transaction } from "./database";
import { publishEvaluation, type StoredCandidate } from "./evaluation";

// The host's private rule and travel review (host-review-and-booking design 8;
// meeting-feasibility: host exception and allowance controls). The host can
// allow minutes for one unresolved host trip of one candidate, waive the weekly
// meeting limit for one request, and evaluate again with the host audience.
// Nothing here can bypass busy time, the host's hours or a trip that does not
// fit, and nothing here is shown to the requester.

export const ALLOW_HOST_TRIP_OPERATION = "request.allow_host_trip";
export const WAIVE_WEEKLY_LIMIT_OPERATION = "request.waive_weekly_limit";
export const HOST_EVALUATE_OPERATION = "request.host_evaluate";

// A waiver is bound to the details it was granted for: any change of details
// voids it. A newer settings revision no longer matches it either.
export async function invalidateExceptions(tx: Transaction, requestId: string) {
  await tx`
    update app.request_exceptions set invalidated_at = now()
    where request_id = ${requestId} and invalidated_at is null
  `;
}

export async function weeklyLimitWaiver(tx: Transaction, requestId: string) {
  const [row] = await tx<{ found: boolean }[]>`
    select true as found from app.request_exceptions e
    join app.requests r on r.id = e.request_id
    join app.host_settings s on s.host_account_id = r.host_account_id
    where e.request_id = ${requestId} and e.kind = 'weekly_limit' and e.invalidated_at is null
      and e.settings_revision = s.revision
  `;
  return Boolean(row);
}

// A host-audience evaluation of the request; reusePending false when the
// caller changed what it reads (a new allowance or waiver).
async function publish(tx: Transaction, requestId: string, retryKey: string, reusePending: boolean) {
  const { evaluationId } = await publishEvaluation(tx, { audience: "host", requestId, retryKey, reusePending });
  return { evaluationId };
}

function assertReviewable(request: { readonly state: string; readonly open: boolean }) {
  if (!request.open) throw new CommandError("request_closed");
  if (request.state === "booking") throw new CommandError("booking_pending");
  if (!["gathering", "negotiating", "awaiting_host_approval"].includes(request.state)) throw new CommandError("invalid_input");
}

export type EvaluateResult = { readonly evaluationId: string };

// request.host_evaluate (**Find times** in the rule and travel review).
export function hostEvaluateCommand(): CommandDefinition<Record<string, never>, EvaluateResult> {
  return {
    input: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
    operation: HOST_EVALUATE_OPERATION,
    async run(tx, context) {
      const request = await lockHostRequest(tx, context.actor, context.resourceId);
      assertReviewable(request);
      return publish(tx, request.id, context.retryKey, true);
    },
  };
}

// request.waive_weekly_limit (**Allow this request beyond my weekly limit**).
export function waiveWeeklyLimitCommand(): CommandDefinition<Record<string, never>, EvaluateResult> {
  return {
    input: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
    operation: WAIVE_WEEKLY_LIMIT_OPERATION,
    async run(tx, context) {
      const request = await lockHostRequest(tx, context.actor, context.resourceId);
      assertReviewable(request);

      await tx`
        insert into app.request_exceptions (request_id, host_account_id, kind, settings_revision)
        select ${request.id}, ${request.host_account_id}, 'weekly_limit', s.revision
        from app.host_settings s where s.host_account_id = ${request.host_account_id}
        on conflict (request_id, kind) where invalidated_at is null do update set settings_revision = excluded.settings_revision
      `;

      return publish(tx, request.id, `waive:${context.retryKey}`, false);
    },
  };
}

const allowInput = z
  .object({
    evaluationId: z.uuid(),
    candidateId: z.string().min(1).max(64),
    direction: z.enum(["inbound", "outbound"]),
    minutes: z.number().int().min(5).max(240).multipleOf(5),
  })
  .strict();

// request.allow_host_trip (**Allow N minutes for this trip**): the host's own
// allowance for one unresolved host leg of one candidate of the request's
// latest evaluation, then a new evaluation that reads it. A leg whose endpoint
// is unknown cannot take one, because an allowance names both endpoints.
export function allowHostTripCommand(): CommandDefinition<z.infer<typeof allowInput>, EvaluateResult> {
  return {
    input: allowInput,
    operation: ALLOW_HOST_TRIP_OPERATION,
    async run(tx, context) {
      const request = await lockHostRequest(tx, context.actor, context.resourceId);
      assertReviewable(request);

      const [evaluation] = await tx<{ candidates: StoredCandidate[] | null; latest: boolean }[]>`
        select e.candidates,
               e.id = (select id from app.evaluations where request_id = e.request_id order by created_at desc limit 1) as latest
        from app.evaluations e
        where e.id = ${context.input.evaluationId} and e.request_id = ${request.id}
      `;

      if (!evaluation) throw new CommandError("forbidden");
      if (!evaluation.latest) throw new CommandError("stale_revision");

      const candidate = evaluation.candidates?.find(
        (entry): entry is Extract<StoredCandidate, { legs: unknown }> => entry.status !== "excluded" && "id" in entry && entry.id === context.input.candidateId,
      );
      const leg = candidate?.legs.find(
        (entry) => entry.party === "host" && entry.status === "unresolved" && entry.direction === context.input.direction,
      );

      if (!candidate || !leg?.originKey || !leg.destinationKey || !leg.mode) throw new CommandError("invalid_input");

      await tx`
        insert into app.travel_allowances
          (request_id, party, candidate_start, candidate_end, direction, origin_hash, destination_hash, mode, minutes, confirmed_by)
        values (${request.id}, 'host', ${candidate.start}, ${candidate.end}, ${leg.direction}, ${leg.originKey},
                ${leg.destinationKey}, ${leg.mode}, ${context.input.minutes}, 'host')
        on conflict (request_id, party, candidate_start, candidate_end, direction, origin_hash, destination_hash, mode)
          where invalidated_at is null
        do update set minutes = excluded.minutes, confirmed_at = now()
      `;

      return publish(tx, request.id, `allow-host:${context.retryKey}`, false);
    },
  };
}
