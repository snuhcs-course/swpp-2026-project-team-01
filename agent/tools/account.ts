import { defineTool } from "eve/tools";
import { z } from "zod";
import { accountRequestCall, accountRequestInput, accountSentCall, assertSentAnswer, batchDecisionsInput, decideAccountRequests } from "../../lib/server/account-assistant-tools";
import { database } from "../../lib/server/database";
import { readRequestForHostTool, evaluateCandidatesForHostTool, proposeSharedChangesForTool, proposeSharedChangesToolInput, resolveChangesForTool, suggestionToolInput, askGuestForHostTool, hostQuestionToolInput, waiveWeeklyLimitForHostTool, allowHostTripForHostTool, readBookingStatusForHostTool, changeBookingForHostTool, finishSampleForTool, finishSampleToolInput } from "../../lib/server/host-review-tools";
import { allowHostTripInput } from "../../lib/server/request-exceptions";
import { readRequestForTool, draftRequestReviewForTool, draftRequestReviewToolInput, evaluateCandidatesForTool, chooseTimeForTool, chooseTimeToolInput, agreeToProposalForTool, agreeToolInput, applyRequestReviewForTool, changeAgreementForTool, withdrawRequestForTool, cancelBookingForTool, changeBookingForTool, useHostCalendarsForTool, useHostCalendarsToolInput, readBookingStatusForTool, resendBookingLinkForTool } from "../../lib/server/request-tools";
import { changeSettingsToolInput, draftSettingsForTool, readSetupStateForTool, type SetupToolCall } from "../../lib/server/setup-tools";
import { setupDependenciesFromEnvironment } from "../../lib/server/setup";

// Imported by the account resolver only; this module's default exports no
// standalone tools, keeping every other audience's registry unchanged.
import { defineDynamic } from "eve/tools";
export default defineDynamic({ events: { "session.started": () => null } });

type Context = { readonly callId: string; readonly session: { readonly id: string; readonly auth: { readonly current: SetupToolCall["auth"] } } };
function call(ctx: Context): SetupToolCall { return { auth: ctx.session.auth.current, sessionId: ctx.session.id, callId: ctx.callId }; }

function received<T extends { ref: string }>(schema: z.ZodType<T>, description: string, run: (target: Awaited<ReturnType<typeof accountRequestCall>>, input: Omit<T, "ref">) => Promise<unknown>) {
  return defineTool({ inputSchema: schema, description, execute: async (input, ctx) => { const { ref, ...args } = input; return run(await accountRequestCall(database(), call(ctx), ref), args); } });
}
function sent<T extends { ref: string }>(schema: z.ZodType<T>, description: string, run: (target: Awaited<ReturnType<typeof accountSentCall>>, input: Omit<T, "ref">) => Promise<unknown>, action: "read" | "agree" | "cancel" | "change" | "withdraw" | "choose" | "details" = "details") {
  return defineTool({ inputSchema: schema, description, execute: async (input, ctx) => { const { ref, ...args } = input; const target = await accountSentCall(database(), call(ctx), ref); if (action !== "read") await assertSentAnswer(database(), target, action); return sentResult(await run(target, args)); } });
}

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
    read_request: received(accountRequestInput, "Read any received request by ref, including its current revision/version and private host review. No conversation switching.", target => readRequestForHostTool(database(), target)),
    evaluate_candidates: received(accountRequestInput, "Find feasible times for the received ref without sharing, deciding or booking.", target => evaluateCandidatesForHostTool(database(), target)),
    decide_requests: defineTool({ inputSchema: batchDecisionsInput, description: "Apply every clear approve/decline/cancel decision in one call, with a ref, current version and expectedRevision per item. A decline can include other excludedDates the host explicitly named; never record a reason. Report each outcome separately; clarify only ambiguous items. Never treat approval as confirmed booking. For an unqualified yes use only the pending ledger question, never a notice or latest request.", execute: (input, ctx) => decideAccountRequests(database(), call(ctx), input) }),
    propose_shared_changes: received(proposeSharedChangesToolInput.extend(accountRequestInput.shape), "Draft exactly the changes the host requested for this received ref; sharing is a separate action.", (target, input) => proposeSharedChangesForTool(database(), target, input)),
    share_changes: received(suggestionToolInput.extend(accountRequestInput.shape), "Submit this ref's current suggestion for checking only when the host asks to share it; not sent until checks pass.", (target, input) => resolveChangesForTool(database(), target, "share", input)),
    dismiss_changes: received(suggestionToolInput.extend(accountRequestInput.shape), "Dismiss this ref's current suggestion when the host asks.", (target, input) => resolveChangesForTool(database(), target, "dismiss", input)),
    ask_guest: received(hostQuestionToolInput.extend(accountRequestInput.shape), "Ask the guest of this received ref the host's own short question, only on explicit instruction.", (target, input) => askGuestForHostTool(database(), target, input)),
    waive_weekly_limit: received(accountRequestInput, "Waive only this ref's weekly limit when the host explicitly allows it; never busy time or general policy.", target => waiveWeeklyLimitForHostTool(database(), target)),
    allow_host_trip: received(allowHostTripInput.extend(accountRequestInput.shape), "Record explicitly allowed travel minutes for this ref's current trip/evaluation; never waive busy time.", (target, input) => allowHostTripForHostTool(database(), target, input)),
    read_booking_status: received(accountRequestInput, "Read this received ref's booking outcome; booked means confirmed only.", target => readBookingStatusForHostTool(database(), target)),
    change_booking: received(accountRequestInput, "Reopen this received ref's booked meeting for changes only at the host's request.", target => changeBookingForHostTool(database(), target)),
    finish_sample_tutorial: received(finishSampleToolInput.extend(accountRequestInput.shape), "Finish only the sample ref's tutorial after its action or an explicit request to end it.", (target, input) => finishSampleForTool(database(), target, input)),
    read_settings: defineTool({ inputSchema: z.object({}), description: "Read account settings and draftRevision at any point.", execute: (_input, ctx) => readSetupStateForTool(setupDependenciesFromEnvironment(), call(ctx)) }),
    change_settings: defineTool({ inputSchema: changeSettingsToolInput, description: "Change general settings only from the host's own stated words. Saves at once once ready; report saved only when savedChange is saved. A request-specific place/time goes to propose_shared_changes.", execute: (input, ctx) => draftSettingsForTool(setupDependenciesFromEnvironment(), call(ctx), input) }),
    get_sent_request: sent(accountRequestInput, "Read a sent request by ref through its requester projection only. The account owner's own calendar is read_schedule; never return the receiving host's private data.", target => readRequestForTool(database(), target), "read"),
    draft_sent_request: sent(draftRequestReviewToolInput.extend(accountRequestInput.shape), "Apply the account owner's stated details to this sent request only. Global settings use change_settings.", (target, input) => draftRequestReviewForTool(database(), target, input)),
    find_sent_times: sent(accountRequestInput, "Find times for this sent ref through the requester projection.", target => evaluateCandidatesForTool(database(), target)),
    choose_sent_time: sent(chooseTimeToolInput.extend(accountRequestInput.shape), "Choose a candidate the account owner named for this sent ref; it does not agree or book.", (target, input) => chooseTimeForTool(database(), target, input), "choose"),
    agree_to_sent_proposal: sent(agreeToolInput.extend(accountRequestInput.shape), "Agree to this sent ref's exact current proposal only on the account owner's explicit acceptance; the other host must approve.", (target, input) => agreeToProposalForTool(database(), target, input), "agree"),
    apply_sent_review: sent(accountRequestInput, "Apply this sent ref's pending detail review after the account owner confirms it.", target => applyRequestReviewForTool(database(), target)),
    change_sent_agreement: sent(accountRequestInput, "Reopen this sent ref's agreement while awaiting the other host; booked meetings use change_sent_booking.", target => changeAgreementForTool(database(), target)),
    withdraw_sent_request: sent(accountRequestInput, "Withdraw this sent request only when the account owner confirms withdrawal.", target => withdrawRequestForTool(database(), target), "withdraw"),
    cancel_sent_booking: sent(accountRequestInput, "Cancel this sent meeting before it starts, only after explicit cancellation and confirmation.", target => cancelBookingForTool(database(), target), "cancel"),
    change_sent_booking: sent(accountRequestInput, "Reopen this sent meeting for an agreed change; it stays booked until a replacement is approved.", target => changeBookingForTool(database(), target), "change"),
    use_sent_host_calendars: sent(z.intersection(useHostCalendarsToolInput, accountRequestInput), "Use all or none of the account owner's host calendars for this sent ref only, retaining the existing card/choice checks. Never change general calendar roles.", (target, input) => useHostCalendarsForTool(database(), target, input)),
    resend_sent_booking_link: sent(accountRequestInput, "Email this sent ref's private link again to the account's confirmed contact address only, under the existing resend limits. Never reveal the link or send to another address.", target => resendBookingLinkForTool(database(), target)),
    check_sent_booking: sent(accountRequestInput, "Read this sent ref's requester-visible booking status.", target => readBookingStatusForTool(database(), target), "read"),
  };
}
