import type { BookingStatusView } from "./booking";
import type { LinkPlan, RequestState } from "./request";
import type { MeetingMode } from "./setup";

// The host's view of a request (host-review-and-booking design 3): the inbox
// item and the projection behind the request view in /app. It carries the host's
// own private context (the evaluation's basis, exclusions, unresolved trips, the
// weekly-limit hold and the exceptions), which the requester never sees, and no
// booking link.

export type HostRequestItem = {
  readonly requestId: string;
  readonly requesterName: string;
  readonly purpose: string | null;
  readonly state: RequestState;
  readonly proposalStart: string | null;
  readonly needsDecision: boolean;
  readonly updatedAt: string;
};

export type HostProposal = {
  readonly version: number;
  readonly start: string;
  readonly end: string;
  readonly durationMinutes: number;
  readonly mode: Exclude<MeetingMode, "either">;
  readonly location: string | null;
  readonly linkPlan: LinkPlan | null;
  readonly agreedAt: string | null;
};

export type HostSuggestion = {
  readonly id: string;
  readonly source: "assistant" | "host";
  readonly state: "pending" | "checking" | "shared" | "rejected" | "dismissed" | "superseded";
  readonly changes: {
    readonly start?: string;
    readonly durationMinutes?: number;
    readonly mode?: Exclude<MeetingMode, "either">;
    readonly location?: string;
    readonly linkPlan?: LinkPlan;
  };
  readonly rejectionReason: string | null;
  readonly proposalVersion: number | null;
};

export type HostCandidateLeg = {
  readonly direction: "inbound" | "outbound";
  readonly status: "fits" | "too_long" | "unresolved";
  readonly travelMinutes: number | null;
  readonly canAllow: boolean;
};

export type HostCandidate = {
  readonly id: string;
  readonly start: string;
  readonly end: string;
  readonly status: "offered" | "requester_unresolved" | "host_unresolved";
  readonly belowWeeklyLimit: boolean;
  readonly basis: readonly string[];
  readonly hostLegs: readonly HostCandidateLeg[];
};

export type HostEvaluationSummary = {
  readonly id: string;
  readonly state: "pending" | "completed" | "incomplete" | "failed";
  readonly failureCategory: string | null;
  readonly candidates: readonly HostCandidate[];
  readonly exclusions: readonly { readonly start: string; readonly end: string; readonly explanation: string }[];
  // Every offered candidate falls in a week at or above the weekly limit and no
  // waiver applies, so the requester is offered none (D8).
  readonly weeklyLimitHold: boolean;
};

export type HostRequestView = {
  readonly requestId: string;
  readonly state: RequestState;
  readonly revision: number;
  readonly expiresAt: string;
  readonly hostTimezone: string;
  readonly requester: {
    readonly name: string;
    readonly email: string;
    readonly emailConfirmed: boolean;
    readonly timezone: string;
    readonly language: "en" | "ko";
  };
  readonly details: {
    readonly purpose: string | null;
    readonly durationMinutes: number | null;
    readonly mode: MeetingMode | null;
    readonly location: string | null;
    readonly linkPlan: LinkPlan | null;
    readonly windows: readonly { readonly start: string; readonly end: string }[];
  };
  readonly proposal: HostProposal | null;
  readonly booking: BookingStatusView | null;
  readonly suggestion: HostSuggestion | null;
  readonly evaluation: HostEvaluationSummary | null;
  readonly weeklyLimitWaived: boolean;
  readonly weeklyLimit: number | null;
  readonly needsDecision: boolean;
  // The earlier request a revised request follows (guest-flow-completion
  // design 5), by its reference, and how that one ended.
  readonly revisedFrom: { readonly ref: string; readonly outcome: "declined" | "expired" } | null;
};

// The host commands of the request view, each a card action.
export const HOST_REQUEST_OPERATIONS = [
  "request.approve",
  "request.decline",
  "request.suggest_changes",
  "request.share_changes",
  "request.dismiss_changes",
  "request.allow_host_trip",
  "request.waive_weekly_limit",
  "request.host_evaluate",
  "booking.check",
] as const;
export type HostRequestOperation = (typeof HOST_REQUEST_OPERATIONS)[number];
