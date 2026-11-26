import { defineTool } from "eve/tools";
import { z } from "zod";
import { accountRequestCall, accountRequestInput, accountSentCall, assertSentAnswer, batchDecisionsInput, decideAccountRequests } from "../../lib/server/account-assistant-tools";
import { database } from "../../lib/server/database";
import { readRequestForHostTool, evaluateCandidatesForHostTool, proposeSharedChangesForTool, proposeSharedChangesToolInput, resolveChangesForTool, suggestionToolInput, askGuestForHostTool, hostQuestionToolInput, waiveWeeklyLimitForHostTool, allowHostTripForHostTool, readBookingStatusForHostTool, changeBookingForHostTool, finishSampleForTool, finishSampleToolInput } from "../../lib/server/host-review-tools";
import { allowHostTripInput } from "../../lib/server/request-exceptions";
import { readRequestForTool, draftRequestReviewForTool, draftRequestReviewToolInput, evaluateCandidatesForTool, chooseTimeForTool, chooseTimeToolInput, agreeToProposalForTool, agreeToolInput, applyRequestReviewForTool, changeAgreementForTool, withdrawRequestForTool, cancelBookingForTool, changeBookingForTool, useHostCalendarsForTool, useHostCalendarsToolInput, readBookingStatusForTool, resendBookingLinkForTool } from "../../lib/server/request-tools";
import { readSetupStateForTool, type SetupToolCall } from "../../lib/server/setup-tools";
import { setupDependenciesFromEnvironment } from "../../lib/server/setup";

type Context = { readonly callId: string; readonly session: { readonly id: string; readonly auth: { readonly current: SetupToolCall["auth"] } } };
function call(ctx: Context): SetupToolCall { return { auth: ctx.session.auth.current, sessionId: ctx.session.id, callId: ctx.callId }; }

const sentNames: Readonly<Record<string, string>> = {
  read_request: "get_sent_request", draft_request_review: "draft_sent_request", evaluate_candidates: "find_sent_times",
  choose_time: "choose_sent_time", agree_to_proposal: "agree_to_sent_proposal", apply_request_review: "apply_sent_review",
  change_agreement: "change_sent_agreement", withdraw_request: "withdraw_sent_request", cancel_booking: "cancel_sent_booking",
  change_booking: "change_sent_booking", use_host_calendars: "use_sent_host_calendars", read_booking_status: "check_sent_booking",
};
function sentResult(result: unknown): unknown {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return result;
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key,
    key === "calendarReply" ? "Use read_schedule for this account owner's own calendar. The receiving host's calendar and private rules remain hidden."
      : ["message", "next", "nextAction"].includes(key) && typeof value === "string"
        ? value.replace(/\b(read_request|draft_request_review|evaluate_candidates|choose_time|agree_to_proposal|apply_request_review|change_agreement|withdraw_request|cancel_booking|change_booking|use_host_calendars|read_booking_status)\b/g, name => sentNames[name] ?? name)
        : value,
  ]));
}

export function accountTools() {
  return {
    read_request: defineTool({
      inputSchema: accountRequestInput,
      description: "Read any received request by ref, including its current revision/version and private host review. Reuse this read for the rest of the turn unless state changes; proposalFeasibility answers why the current time works. No conversation switching.",
      execute: async (input, ctx) => {
        const { ref } = input;
        const target = await accountRequestCall(database(), call(ctx), ref);
        return readRequestForHostTool(database(), target);
      },
    }),
    evaluate_candidates: defineTool({
      inputSchema: accountRequestInput,
      description: "Find new feasible times for the received ref without sharing, deciding or booking. For why the current proposal works, use read_request.proposalFeasibility first; evaluate only if its basis is absent.",
      execute: async (input, ctx) => {
        const { ref } = input;
        const target = await accountRequestCall(database(), call(ctx), ref);
        return evaluateCandidatesForHostTool(database(), target);
      },
    }),
    decide_requests: defineTool({ inputSchema: batchDecisionsInput, description: "Apply every clear approve/decline/cancel decision in one call, with a ref, current version and expectedRevision per item. A decline can include other excludedDates the host explicitly named; never record a reason. Report each outcome separately; clarify only ambiguous items. Never treat approval as confirmed booking. For an unqualified yes use only the pending ledger question, never a notice or latest request.", execute: (input, ctx) => decideAccountRequests(database(), call(ctx), input) }),
    propose_shared_changes: defineTool({
      inputSchema: proposeSharedChangesToolInput.extend(accountRequestInput.shape),
      description: "Draft exactly the changes the host requested for this received ref; sharing is a separate action.",
      execute: async (input, ctx) => {
        const { ref, ...args } = input;
        const target = await accountRequestCall(database(), call(ctx), ref);
        return proposeSharedChangesForTool(database(), target, args);
      },
    }),
    share_changes: defineTool({
      inputSchema: suggestionToolInput.extend(accountRequestInput.shape),
      description: "Submit this ref's current suggestion for checking only when the host asks to share it; not sent until checks pass.",
      execute: async (input, ctx) => {
        const { ref, ...args } = input;
        const target = await accountRequestCall(database(), call(ctx), ref);
        return resolveChangesForTool(database(), target, "share", args);
      },
    }),
    dismiss_changes: defineTool({
      inputSchema: suggestionToolInput.extend(accountRequestInput.shape),
      description: "Dismiss this ref's current suggestion when the host asks.",
      execute: async (input, ctx) => {
        const { ref, ...args } = input;
        const target = await accountRequestCall(database(), call(ctx), ref);
        return resolveChangesForTool(database(), target, "dismiss", args);
      },
    }),
    ask_guest: defineTool({
      inputSchema: hostQuestionToolInput.extend(accountRequestInput.shape),
      description: "Ask the guest of this received ref the host's own short question, only on explicit instruction.",
      execute: async (input, ctx) => {
        const { ref, ...args } = input;
        const target = await accountRequestCall(database(), call(ctx), ref);
        return askGuestForHostTool(database(), target, args);
      },
    }),
    waive_weekly_limit: defineTool({
      inputSchema: accountRequestInput,
      description: "Waive only this ref's weekly limit when the host explicitly allows it; never busy time or general policy.",
      execute: async (input, ctx) => {
        const { ref } = input;
        const target = await accountRequestCall(database(), call(ctx), ref);
        return waiveWeeklyLimitForHostTool(database(), target);
      },
    }),
    allow_host_trip: defineTool({
      inputSchema: allowHostTripInput.extend(accountRequestInput.shape),
      description: "Record explicitly allowed travel minutes for this ref's current trip/evaluation; never waive busy time.",
      execute: async (input, ctx) => {
        const { ref, ...args } = input;
        const target = await accountRequestCall(database(), call(ctx), ref);
        return allowHostTripForHostTool(database(), target, args);
      },
    }),
    read_booking_status: defineTool({
      inputSchema: accountRequestInput,
      description: "Read this received ref's booking outcome; booked means confirmed only.",
      execute: async (input, ctx) => {
        const { ref } = input;
        const target = await accountRequestCall(database(), call(ctx), ref);
        return readBookingStatusForHostTool(database(), target);
      },
    }),
    change_booking: defineTool({
      inputSchema: accountRequestInput,
      description: "Reopen this received ref's booked meeting for changes only at the host's request.",
      execute: async (input, ctx) => {
        const { ref } = input;
        const target = await accountRequestCall(database(), call(ctx), ref);
        return changeBookingForHostTool(database(), target);
      },
    }),
    finish_sample_tutorial: defineTool({
      inputSchema: finishSampleToolInput.extend(accountRequestInput.shape),
      description: "Finish only the sample ref's tutorial after its action or an explicit request to end it.",
      execute: async (input, ctx) => {
        const { ref, ...args } = input;
        const target = await accountRequestCall(database(), call(ctx), ref);
        return finishSampleForTool(database(), target, args);
      },
    }),
    read_settings: defineTool({ inputSchema: z.object({}), description: "Read account settings and draftRevision at any point.", execute: (_input, ctx) => readSetupStateForTool(setupDependenciesFromEnvironment(), call(ctx)) }),
    get_sent_request: defineTool({
      inputSchema: accountRequestInput,
      description: "Read a sent request by ref through its requester projection only. The account owner's own calendar is read_schedule; never return the receiving host's private data.",
      execute: async (input, ctx) => {
        const { ref } = input;
        const target = await accountSentCall(database(), call(ctx), ref);
        return sentResult(await readRequestForTool(database(), target));
      },
    }),
    draft_sent_request: defineTool({
      inputSchema: draftRequestReviewToolInput.extend(accountRequestInput.shape),
      description: "Apply the account owner's stated details to this sent request only. Global settings use draft_settings.",
      execute: async (input, ctx) => {
        const { ref, ...args } = input;
        const target = await accountSentCall(database(), call(ctx), ref);
        await assertSentAnswer(database(), target, "details");
        return sentResult(await draftRequestReviewForTool(database(), target, args));
      },
    }),
    find_sent_times: defineTool({
      inputSchema: accountRequestInput,
      description: "Find times for this sent ref through the requester projection.",
      execute: async (input, ctx) => {
        const { ref } = input;
        const target = await accountSentCall(database(), call(ctx), ref);
        await assertSentAnswer(database(), target, "details");
        return sentResult(await evaluateCandidatesForTool(database(), target));
      },
    }),
    choose_sent_time: defineTool({
      inputSchema: chooseTimeToolInput.extend(accountRequestInput.shape),
      description: "Choose a candidate the account owner named for this sent ref; it does not agree or book.",
      execute: async (input, ctx) => {
        const { ref, ...args } = input;
        const target = await accountSentCall(database(), call(ctx), ref);
        await assertSentAnswer(database(), target, "choose");
        return sentResult(await chooseTimeForTool(database(), target, args));
      },
    }),
    agree_to_sent_proposal: defineTool({
      inputSchema: agreeToolInput.extend(accountRequestInput.shape),
      description: "Agree to this sent ref's exact current proposal only on the account owner's explicit acceptance; the other host must approve.",
      execute: async (input, ctx) => {
        const { ref, ...args } = input;
        const target = await accountSentCall(database(), call(ctx), ref);
        await assertSentAnswer(database(), target, "agree");
        return sentResult(await agreeToProposalForTool(database(), target, args));
      },
    }),
    apply_sent_review: defineTool({
      inputSchema: accountRequestInput,
      description: "Apply this sent ref's pending detail review after the account owner confirms it.",
      execute: async (input, ctx) => {
        const { ref } = input;
        const target = await accountSentCall(database(), call(ctx), ref);
        await assertSentAnswer(database(), target, "details");
        return sentResult(await applyRequestReviewForTool(database(), target));
      },
    }),
    change_sent_agreement: defineTool({
      inputSchema: accountRequestInput,
      description: "Reopen this sent ref's agreement while awaiting the other host; booked meetings use change_sent_booking.",
      execute: async (input, ctx) => {
        const { ref } = input;
        const target = await accountSentCall(database(), call(ctx), ref);
        await assertSentAnswer(database(), target, "details");
        return sentResult(await changeAgreementForTool(database(), target));
      },
    }),
    withdraw_sent_request: defineTool({
      inputSchema: accountRequestInput,
      description: "Withdraw this sent request only when the account owner confirms withdrawal.",
      execute: async (input, ctx) => {
        const { ref } = input;
        const target = await accountSentCall(database(), call(ctx), ref);
        await assertSentAnswer(database(), target, "withdraw");
        return sentResult(await withdrawRequestForTool(database(), target));
      },
    }),
    cancel_sent_booking: defineTool({
      inputSchema: accountRequestInput,
      description: "Cancel this sent meeting before it starts, only after explicit cancellation and confirmation.",
      execute: async (input, ctx) => {
        const { ref } = input;
        const target = await accountSentCall(database(), call(ctx), ref);
        await assertSentAnswer(database(), target, "cancel");
        return sentResult(await cancelBookingForTool(database(), target));
      },
    }),
    change_sent_booking: defineTool({
      inputSchema: accountRequestInput,
      description: "Reopen this sent meeting for an agreed change; it stays booked until a replacement is approved.",
      execute: async (input, ctx) => {
        const { ref } = input;
        const target = await accountSentCall(database(), call(ctx), ref);
        await assertSentAnswer(database(), target, "change");
        return sentResult(await changeBookingForTool(database(), target));
      },
    }),
    use_sent_host_calendars: defineTool({
      inputSchema: z.intersection(useHostCalendarsToolInput, accountRequestInput),
      description: "Use all or none of the account owner's host calendars for this sent ref only, retaining the existing card/choice checks. Never change general calendar roles.",
      execute: async (input, ctx) => {
        const { ref, ...args } = input;
        const target = await accountSentCall(database(), call(ctx), ref);
        await assertSentAnswer(database(), target, "details");
        return sentResult(await useHostCalendarsForTool(database(), target, args));
      },
    }),
    resend_sent_booking_link: defineTool({
      inputSchema: accountRequestInput,
      description: "Email this sent ref's private link again to the account's confirmed contact address only, under the existing resend limits. Never reveal the link or send to another address.",
      execute: async (input, ctx) => {
        const { ref } = input;
        const target = await accountSentCall(database(), call(ctx), ref);
        await assertSentAnswer(database(), target, "details");
        return sentResult(await resendBookingLinkForTool(database(), target));
      },
    }),
    check_sent_booking: defineTool({
      inputSchema: accountRequestInput,
      description: "Read this sent ref's requester-visible booking status.",
      execute: async (input, ctx) => {
        const { ref } = input;
        const target = await accountSentCall(database(), call(ctx), ref);
        return sentResult(await readBookingStatusForTool(database(), target));
      },
    }),
  };
}
