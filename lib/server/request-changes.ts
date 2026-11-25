import { z } from "zod";
import { proposalTimes, type RequesterProposal } from "../contracts/request";
import { assertRevision, CommandError, type CommandDefinition } from "./commands";
import { enqueueButtonRetirement, enqueueHostNotice } from "./imessage-notices";
import { readChangeBaseline, restoreSchedulingDetails } from "./request-change-baseline";
import { lockOpenRequest } from "./request-guard";
import { dropChange, standingBookingOf } from "./request-lifecycle";

export const CANCEL_CHANGES_OPERATION = "request.cancel_changes";
export type CancelChangesResult = { readonly state: "awaiting_host_approval" | "booked"; readonly revision: number; readonly version?: number };

export const cancelChangesCommand: CommandDefinition<Record<string, never>, CancelChangesResult> = {
  operation: CANCEL_CHANGES_OPERATION,
  input: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
  async run(tx, context) {
    if (context.actor.kind !== "requester_request" || context.actor.id !== context.resourceId) throw new CommandError("forbidden");
    const request = await lockOpenRequest(tx, context.resourceId);
    assertRevision(request.revision, context.expectedRevision);
    if (request.state !== "gathering" && request.state !== "negotiating") throw new CommandError("stale_revision");
    const baseline = await readChangeBaseline(tx, request.id);
    if (!baseline) throw new CommandError("stale_revision");

    const [original] = await tx<{
      id: string; evaluation_id: string; candidate_id: string; start_at: Date; end_at: Date;
      details: Omit<RequesterProposal, "version">; now: Date;
    }[]>`
      select p.id, p.evaluation_id, p.candidate_id, p.start_at, p.end_at, p.details, clock_timestamp() as now
      from app.proposals p join app.agreements a on a.proposal_id = p.id
      where p.id = ${baseline.proposalId} and p.request_id = ${request.id}
    `;
    if (!original) throw new CommandError("stale_revision");
    if (proposalTimes(original.details).some((time) => Date.parse(time.start) <= original.now.getTime())) {
      throw new CommandError("invalid_input", { reason: "start_passed" });
    }
    const details = restoreSchedulingDetails(request.details, baseline.details);
    const standing = await standingBookingOf(tx, request.id);

    if (baseline.state === "booked") {
      if (!standing) throw new CommandError("stale_revision");
      await tx`update app.requests set details = ${tx.json(details as Parameters<typeof tx.json>[0])} where id = ${request.id}`;
      await dropChange(tx, request.id, "withdrawn");
      return { revision: request.revision + 1, state: "booked" };
    }
    const expiresAt = new Date(baseline.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= original.now) throw new CommandError("request_closed");

    // New immutable versions preserve the old consent and reject old approvals;
    // never rewind the request revision or mutate proposal history.
    const [next] = await tx<{ version: number }[]>`
      select coalesce(max(version), 0) + 1 as version from app.proposals where request_id = ${request.id}
    `;
    const [proposal] = await tx<{ id: string }[]>`
      insert into app.proposals (request_id, version, evaluation_id, candidate_id, start_at, end_at, details)
      values (${request.id}, ${next!.version}, ${original.evaluation_id}, ${original.candidate_id},
              ${original.start_at}, ${original.end_at}, ${tx.json(original.details as Parameters<typeof tx.json>[0])})
      returning id
    `;
    await tx`
      insert into app.agreements (proposal_id, request_revision, retry_key)
      values (${proposal!.id}, ${request.revision}, ${context.retryKey})
    `;
    await tx`
      update app.requests set state = 'awaiting_host_approval', details = ${tx.json(details as Parameters<typeof tx.json>[0])},
          expires_at = ${expiresAt}, revision = revision + 1, updated_at = now()
      where id = ${request.id}
    `;
    await tx`
      update app.request_reviews set state = 'superseded', resolved_at = now()
      where request_id = ${request.id} and state = 'pending'
    `;
    await enqueueButtonRetirement(tx, request.id);
    await enqueueHostNotice(tx, request.id, { kind: "awaiting_approval", version: next!.version });
    return { revision: request.revision + 1, state: "awaiting_host_approval", version: next!.version };
  },
};
