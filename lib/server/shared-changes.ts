import { z } from "zod";
import { LINK_PLAN_KINDS } from "../contracts/request";
import { MEETING_MODES } from "../contracts/setup";
import { latestProposalOf, lockHostRequest } from "./bookings";
import { assertRevision, type CommandDefinition, CommandError } from "./commands";
import { publishEvaluation } from "./evaluation";
import { invalidateExceptions } from "./request-exceptions";

// Suggested changes to the shared details (host-review-and-booking design 4,
// D7). A suggestion comes from the host's editor (**Request changes**) or from
// the assistant's propose_shared_changes; a new one supersedes the pending one.
// **Share revised details** applies the detail changes as a new request
// revision, which leaves the old proposal stale for agreement and any approval
// naming it unusable, and publishes a host-audience evaluation of exactly the
// suggested interval; the evaluation job then writes the next proposal version
// and emails the requester, or rejects the suggestion with a host-private
// reason (shared-change-settle.ts). **Dismiss suggestions** changes nothing shared.

export const SUGGEST_CHANGES_OPERATION = "request.suggest_changes";
export const SHARE_CHANGES_OPERATION = "request.share_changes";
export const DISMISS_CHANGES_OPERATION = "request.dismiss_changes";

export const sharedChangesSchema = z
  .object({
    start: z.iso.datetime({ offset: true }).optional(),
    durationMinutes: z.number().int().min(15).max(480).multipleOf(5).optional(),
    mode: z.enum(MEETING_MODES).exclude(["either"]).optional(),
    location: z.string().trim().min(1).max(300).optional(),
    linkPlan: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal(LINK_PLAN_KINDS[0]) }).strict(),
        z.object({ kind: z.literal(LINK_PLAN_KINDS[1]), url: z.url({ protocol: /^https$/ }).max(500) }).strict(),
      ])
      .optional(),
  })
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, "Suggest at least one change.");

export type SharedChanges = z.infer<typeof sharedChangesSchema>;

export type SuggestResult = { readonly suggestionId: string };

const suggestInput = z.object({ changes: sharedChangesSchema }).strict();

export function suggestChangesCommand(source: "assistant" | "host"): CommandDefinition<z.infer<typeof suggestInput>, SuggestResult> {
  return {
    input: suggestInput,
    operation: SUGGEST_CHANGES_OPERATION,
    async run(tx, context) {
      const request = await lockHostRequest(tx, context.actor, context.resourceId);
      if (!request.open) throw new CommandError("request_closed");
      if (request.state === "booking") throw new CommandError("booking_pending");
      if (!["gathering", "negotiating", "awaiting_host_approval"].includes(request.state)) throw new CommandError("invalid_input");

      const base = await latestProposalOf(tx, request.id);
      await tx`
        update app.shared_change_drafts set state = 'superseded', resolved_at = now()
        where request_id = ${request.id} and state = 'pending'
      `;
      const [created] = await tx<{ id: string }[]>`
        insert into app.shared_change_drafts (request_id, source, base_revision, base_proposal_version, changes)
        values (${request.id}, ${source}, ${request.revision}, ${base?.version ?? null},
                ${tx.json(context.input.changes as Parameters<typeof tx.json>[0])})
        returning id
      `;

      return { suggestionId: created!.id };
    },
  };
}

const suggestionInput = z.object({ suggestionId: z.uuid() }).strict();

export type ShareResult = { readonly evaluationId: string; readonly revision: number };

export const shareChangesCommand: CommandDefinition<z.infer<typeof suggestionInput>, ShareResult> = {
  input: suggestionInput,
  operation: SHARE_CHANGES_OPERATION,
  async run(tx, context) {
    const request = await lockHostRequest(tx, context.actor, context.resourceId);
    if (!request.open) throw new CommandError("request_closed");
    if (request.state === "booking") throw new CommandError("booking_pending");
    assertRevision(request.revision, context.expectedRevision);
    if (request.state !== "negotiating" && request.state !== "awaiting_host_approval") throw new CommandError("invalid_input");

    const [suggestion] = await tx<{ changes: SharedChanges; id: string }[]>`
      select id, changes from app.shared_change_drafts
      where id = ${context.input.suggestionId} and request_id = ${request.id} and state = 'pending'
      for update
    `;
    if (!suggestion) throw new CommandError("stale_revision");

    const base = await latestProposalOf(tx, request.id);
    const changes = suggestion.changes;
    const duration = changes.durationMinutes ?? base?.details.durationMinutes ?? request.details.durationMinutes ?? null;
    const startAt = changes.start ? new Date(changes.start) : (base?.start_at ?? null);
    const mode = changes.mode ?? base?.details.mode ?? (request.details.mode === "either" ? null : request.details.mode) ?? null;

    if (!startAt || !duration || !mode) throw new CommandError("invalid_input");
    if (mode === "in_person" && !(changes.location ?? base?.details.location ?? request.details.location)) {
      throw new CommandError("invalid_input");
    }

    const [clock] = await tx<{ now: Date }[]>`select clock_timestamp() as now`;
    if (startAt.getTime() <= clock!.now.getTime()) throw new CommandError("invalid_input", { reason: "start_passed" });

    const details = {
      ...request.details,
      durationMinutes: duration,
      mode,
      ...(mode === "in_person"
        ? { linkPlan: null, location: changes.location ?? base?.details.location ?? request.details.location ?? null }
        : { linkPlan: changes.linkPlan ?? base?.details.linkPlan ?? request.details.linkPlan ?? null, location: null }),
    };

    await tx`
      update app.requests
      set details = ${tx.json(details as Parameters<typeof tx.json>[0])}, state = 'negotiating',
          revision = revision + 1, updated_at = now()
      where id = ${request.id}
    `;
    await invalidateExceptions(tx, request.id);
    await tx`update app.shared_change_drafts set state = 'checking' where id = ${suggestion.id}`;

    const end = new Date(startAt.getTime() + duration * 60_000);
    const { evaluationId } = await publishEvaluation(tx, {
      audience: "host",
      interval: { end: end.toISOString(), start: startAt.toISOString() },
      requestId: request.id,
      retryKey: `share:${suggestion.id}`,
      sharedChangeId: suggestion.id,
    });
    await tx`update app.shared_change_drafts set evaluation_id = ${evaluationId} where id = ${suggestion.id}`;

    return { evaluationId, revision: request.revision + 1 };
  },
};

export const dismissChangesCommand: CommandDefinition<z.infer<typeof suggestionInput>, { readonly dismissed: true }> = {
  input: suggestionInput,
  operation: DISMISS_CHANGES_OPERATION,
  async run(tx, context) {
    const request = await lockHostRequest(tx, context.actor, context.resourceId);
    const dismissed = await tx`
      update app.shared_change_drafts set state = 'dismissed', resolved_at = now()
      where id = ${context.input.suggestionId} and request_id = ${request.id} and state = 'pending'
    `;
    if (dismissed.count === 0) throw new CommandError("stale_revision");
    return { dismissed: true };
  },
};
