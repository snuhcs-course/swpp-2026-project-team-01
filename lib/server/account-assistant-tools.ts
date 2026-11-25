import { z } from "zod";
import { channelOfTurn, matchHostRequests } from "./channel-selection";
import type { Database } from "./database";
import { HostReviewToolDeniedError, type HostReviewToolCall } from "./host-review-tools";
import { listHostRequests, readHostRequest } from "./host-requests";
import { listSentRequests } from "./host-sent-requests";
import { approveCommand, declineCommand, declinedDatesSchema } from "./bookings";
import { cancelBookingCommand } from "./booking-cancellation";
import { finishSampleCommand } from "./host-tutorial";
import { assertRevision, CommandError, runCommand, type CommandDefinition } from "./commands";
import { questionSchema } from "./host-assistant-context";
import { requestRef } from "./request-ref";
import { authorizeSetupTool } from "./setup-tools";
import type { RequestToolCall } from "./request-tools";

export const accountRequestInput = z.object({ ref: z.string().trim().min(1).max(120) }).strict();

export async function accountRequestCall(db: Database, call: HostReviewToolCall, ref: string, action?: "approve" | "decline" | "cancel"): Promise<HostReviewToolCall> {
  const actor = await authorizeSetupTool(db, call.auth, call.sessionId);
  if (!(await channelOfTurn(db, call.sessionId, actor.id))) throw new HostReviewToolDeniedError();
  const requests = await listHostRequests(db, actor.id, { limit: null });
  const matches = requests.filter(item => item.requestId === ref);
  let found = matches.length ? matches : matchHostRequests(requests, ref, { exactName: true });
  if (action === "approve" && found.length > 1) {
    const awaiting = found.filter(item => item.state === "awaiting_host_approval");
    if (awaiting.length === 1) found = awaiting;
  }
  if (found.length !== 1) throw new Error("Request unavailable or ambiguous. List requests and ask about this item alone; do not repeat completed actions.");
  return { ...call, requestId: found[0]!.requestId };
}

export async function accountSentCall(db: Database, call: RequestToolCall, ref: string): Promise<RequestToolCall> {
  const actor = await authorizeSetupTool(db, call.auth, call.sessionId);
  if (!(await channelOfTurn(db, call.sessionId, actor.id))) throw new HostReviewToolDeniedError();
  const matches = (await listSentRequests(db, actor.id, null)).filter(item => item.requestId === ref || requestRef(item.requestId) === ref.toUpperCase());
  if (matches.length !== 1) throw new Error("Sent request unavailable or ambiguous. Use a reference from list_host_requests.");
  return { ...call, requesterRequestId: matches[0]!.requestId };
}

export const accountDecisionItem = accountRequestInput.extend({
  action: z.enum(["approve", "decline", "cancel"]),
  version: z.number().int().positive().nullable(),
  expectedRevision: z.number().int().nonnegative(),
  option: z.number().int().min(1).max(3).optional(),
  excludedDates: declinedDatesSchema,
});
export const batchDecisionsInput = z.object({ items: z.array(accountDecisionItem).min(1).max(20) }).strict();

export function unqualifiedAnswer(message: string) {
  return /^(?:yes|yep|yeah|ok|okay|sure|네|예|응|좋아|좋아요|넵|ㅇㅇ|👍)[.!\s]*$/iu.test(message.replace(/^\[(?:iMessage|WhatsApp|Telegram)\]\s*/, "").trim());
}

export function pendingQuestionMatches(content: unknown, direction: "received" | "sent", ref: string, version: number | null, revision: number | null, action?: string) {
  const question = questionSchema.safeParse(content);
  return question.success && question.data.direction === direction && question.data.ref === ref &&
    question.data.version === version && question.data.expectedRevision === revision &&
    (action === undefined || question.data.decision === action);
}

export async function assertSentAnswer(db: Database, call: RequestToolCall, action: string) {
  const actor = await authorizeSetupTool(db, call.auth, call.sessionId);
  const { linkedMessagingTurn } = await import("./channel-selection");
  const turn = await linkedMessagingTurn(db, call.sessionId, actor.id);
  if (!turn) throw new HostReviewToolDeniedError();
  if (!unqualifiedAnswer(turn.message)) return;
  const [state] = await db<{ revision: number; version: number | null }[]>`
    select r.revision, (select max(p.version) from app.proposals p where p.request_id = r.id) as version
    from app.requests r where r.id = ${call.requesterRequestId!}
  `;
  const questions = await db<{ content: unknown }[]>`select content from app.host_assistant_context
    where host_account_id = ${actor.id} and kind = 'question' and entry_key = 'latest' and confirmed
      and forgotten_at is null and (expires_at is null or expires_at > now())`;
  if (!state || questions.length !== 1 || !pendingQuestionMatches(questions[0]!.content, "sent", requestRef(call.requesterRequestId!), state.version, state.revision, action)) {
    throw new Error("The pending question is absent, stale or for another target. Ask one clarification; nothing changed.");
  }
}

function decisionCommand(call: HostReviewToolCall): CommandDefinition<z.infer<typeof accountDecisionItem>, unknown> {
  return {
    operation: "account.decide_request",
    input: accountDecisionItem,
    async run(tx, context) {
      const actor = await authorizeSetupTool(tx, call.auth, call.sessionId);
      const { linkedMessagingTurn } = await import("./channel-selection");
      const turn = await linkedMessagingTurn(tx, call.sessionId, actor.id);
      if (!turn || actor.id !== context.actor.id) throw new CommandError("forbidden");
      const view = await readHostRequest(tx, actor.id, context.resourceId);
      if (!view) throw new CommandError("forbidden");
      if (unqualifiedAnswer(turn.message)) {
        const questions = await tx<{ content: unknown }[]>`
          select content from app.host_assistant_context where host_account_id = ${actor.id}
            and kind = 'question' and entry_key = 'latest' and confirmed and forgotten_at is null
            and (expires_at is null or expires_at > now()) for update
        `;
        if (questions.length !== 1 || !pendingQuestionMatches(questions[0]!.content, "received", requestRef(view.requestId), context.input.version, context.expectedRevision, context.input.action)) {
          throw new CommandError("invalid_input");
        }
      }
      assertRevision(view.revision, context.expectedRevision);
      if ((view.proposal?.version ?? null) !== context.input.version) throw new CommandError("stale_revision");
      // Delegate to the exact domain command used by web and MCP. The outer
      // command stores each item's original fingerprint/outcome for retries.
      const result = view.sample
        ? await finishSampleCommand.run(tx, { ...context, input: { action: context.input.action === "cancel" ? "end" : context.input.action } })
        : context.input.action === "approve"
          ? context.input.version === null
            ? (() => { throw new CommandError("invalid_input"); })()
            : await approveCommand.run(tx, { ...context, input: { version: context.input.version, ...(context.input.option === undefined ? {} : { option: context.input.option }) } })
          : context.input.action === "decline"
            ? await declineCommand().run(tx, { ...context, input: { excludedDates: context.input.excludedDates } })
            : await cancelBookingCommand().run(tx, { ...context, input: {} });
      await tx`update app.host_assistant_context set content = '{}'::jsonb, confirmed = false,
        forgotten_at = now(), revision = revision + 1, updated_at = now()
        where host_account_id = ${actor.id} and kind = 'question' and confirmed
          and content ->> 'ref' = ${requestRef(view.requestId)}`;
      return result;
    },
  };
}

export async function decideAccountRequests(db: Database, call: HostReviewToolCall, input: z.infer<typeof batchDecisionsInput>) {
  const actor = await authorizeSetupTool(db, call.auth, call.sessionId);
  const results: { ref: string; action: string; result: unknown }[] = [];
  for (const [index, item] of input.items.entries()) {
    try {
      const target = await accountRequestCall(db, call, item.ref, item.action);
      const outcome = await runCommand({ db, authenticate: async () => actor }, decisionCommand(call), {
        resourceId: target.requestId!, expectedRevision: item.expectedRevision,
        retryKey: `tool:${call.callId}:${index}`, input: item,
      });
      results.push({ ref: item.ref, action: item.action, result: outcome });
    } catch {
      results.push({ ref: item.ref, action: item.action, result: { problem: "Unavailable, ambiguous or failed item. Clarify only it; other results stand." } });
    }
  }
  return { results, note: "An approved item is not confirmed booked; read_booking_status reports confirmation." };
}
