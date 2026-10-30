import type { MeetingMode } from "./setup";

// The meeting request contract shared by the request domain, the requester
// tools, the /api/requests routes and the booking page cards. It mirrors
// app.requests, app.request_reviews, app.proposals, app.agreements and
// app.evaluations; the requester projections carry only what the requester
// audience may see (no rule, buffer, travel estimate or event detail).

// Every state app.requests admits. Phase 3 reaches draft, gathering,
// negotiating, awaiting_host_approval, withdrawn and expired; booking, booked
// and declined arrive with host approval. A draft (design decision 2, D13) is
// the guest's conversation before they give a name and email: invisible to the
// host, deleted 24 hours after creation unless the guest is identified.
export const REQUEST_STATES = [
  "draft",
  "gathering",
  "negotiating",
  "awaiting_host_approval",
  "booking",
  "booked",
  "declined",
  "withdrawn",
  "expired",
] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

// The states withdrawal and expiry can close. A draft is not among them: it is
// deleted, never closed.
export const ACTIONABLE_REQUEST_STATES = ["gathering", "negotiating", "awaiting_host_approval"] as const;
export type ActionableRequestState = (typeof ACTIONABLE_REQUEST_STATES)[number];

// The states that set closed_at.
export const CLOSED_REQUEST_STATES = ["booked", "declined", "withdrawn", "expired"] as const;
export type ClosedRequestState = (typeof CLOSED_REQUEST_STATES)[number];

export function isActionableRequestState(state: RequestState): state is ActionableRequestState {
  return (ACTIONABLE_REQUEST_STATES as readonly string[]).includes(state);
}

// Hosts never see a draft: every host projection, list and count filters it out.
export function isHostVisibleRequestState(state: RequestState) {
  return state !== "draft";
}

export function isClosedRequestState(state: RequestState): state is ClosedRequestState {
  return (CLOSED_REQUEST_STATES as readonly string[]).includes(state);
}

export const REQUEST_LANGUAGES = ["en", "ko"] as const;
export type RequestLanguage = (typeof REQUEST_LANGUAGES)[number];

// The requester's own travel mode for in-person requests: Google Routes DRIVE,
// TRANSIT and WALK. Unlike the host's, it has no per-trip choice.
export const REQUESTER_TRAVEL_MODES = ["driving", "transit", "walking"] as const;
export type RequesterTravelMode = (typeof REQUESTER_TRAVEL_MODES)[number];

// How an online meeting gets its link (design decision 11): a Meet conference
// created with the event, or an https: URL the requester supplied.
export const LINK_PLAN_KINDS = ["google_meet", "requester_link"] as const;
export type LinkPlanKind = (typeof LINK_PLAN_KINDS)[number];

export type LinkPlan = { readonly kind: "google_meet" } | { readonly kind: "requester_link"; readonly url: string };

// The authored clarification questions (design decision 12); app.request_reviews
// admits exactly these categories.
export const CLARIFICATION_CATEGORIES = [
  "missing_date",
  "missing_time",
  "missing_timezone",
  "ambiguous_local_time",
  "missing_duration",
  "missing_mode",
  "missing_location",
  "unclear_location",
  "missing_purpose",
] as const;
export type ClarificationCategory = (typeof CLARIFICATION_CATEGORIES)[number];

export function isClarificationCategory(value: string): value is ClarificationCategory {
  return (CLARIFICATION_CATEGORIES as readonly string[]).includes(value);
}

// One requested availability window, as ISO 8601 instants.
export type RequestWindow = {
  readonly start: string;
  readonly end: string;
};

// app.requests.details. Unknown values are null until the requester states them.
export type RequestDetails = {
  readonly purpose: string | null;
  readonly durationMinutes: number | null;
  readonly mode: MeetingMode | null;
  // The meeting place for an in-person request.
  readonly location: string | null;
  // The link plan for an online request.
  readonly linkPlan: LinkPlan | null;
  readonly windows: readonly RequestWindow[];
  // The requester's IANA zone, used to interpret local times in windows.
  readonly timezone: string;
  readonly language: RequestLanguage;
  readonly travelMode: RequesterTravelMode | null;
};

// The fields a review, the meeting details card or request.update_details may
// set. Each omitted key leaves the field unchanged. contactName and contactEmail
// are an explicit contact correction: an empty string is an explicit empty edit,
// kept exactly for protected review and refused when applied.
export type ReviewPatch = Partial<
  Pick<RequestDetails, "purpose" | "durationMinutes" | "mode" | "location" | "linkPlan" | "windows" | "travelMode">
> & {
  readonly contactName?: string;
  readonly contactEmail?: string;
};

// What the extraction declared (app.request_reviews.intent).
export const REVIEW_INTENTS = ["details", "availability", "question", "unknown"] as const;
export type ReviewIntent = (typeof REVIEW_INTENTS)[number];

export const REVIEW_STATES = ["pending", "applied", "superseded", "rejected"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const EVALUATION_STATES = ["pending", "completed", "incomplete", "failed"] as const;
export type EvaluationState = (typeof EVALUATION_STATES)[number];

// One candidate as the requester sees it: instants, display times, duration, mode
// and location plan only. unresolvedRequesterLeg marks a requester trip the
// service could not estimate, which the card offers a requester allowance for.
export type RequesterCandidate = {
  readonly id: string;
  readonly start: string;
  readonly end: string;
  readonly displayTimezone: string;
  readonly durationMinutes: number;
  readonly mode: Exclude<MeetingMode, "either">;
  readonly location: string | null;
  readonly linkPlan: LinkPlan | null;
  readonly unresolvedRequesterLeg: "inbound" | "outbound" | null;
};

// app.evaluations.requester_projection.
export type RequesterEvaluation = {
  readonly id: string;
  readonly state: EvaluationState;
  readonly candidates: readonly RequesterCandidate[];
};

// One immutable proposal version as the requester sees it.
export type RequesterProposal = {
  readonly version: number;
  readonly start: string;
  readonly end: string;
  readonly displayTimezones: readonly string[];
  readonly durationMinutes: number;
  readonly participants: readonly { readonly name: string; readonly role: "host" | "requester" }[];
  readonly mode: Exclude<MeetingMode, "either">;
  readonly location: string | null;
  readonly linkPlan: LinkPlan | null;
};

export type RequesterAgreement = {
  readonly proposalVersion: number;
  readonly agreedAt: string;
};

// The first line of a revised request's opening summary (guest-flow-completion
// design 5), which the guest thread shows as a quiet note.
export const REVISED_SUMMARY_PREFIX = "Earlier request summary, written by Find Me a Time";
