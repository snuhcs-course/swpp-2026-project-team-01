import type { ClarificationCategory, RequestDetails, RequestState, ReviewIntent } from "./request";

// What GET /api/requests/{bookingId}/state returns to the requester's booking
// page, and what its cards read (Lane D's review, details, candidate, proposal
// and status cards build on the same view). It is the requester projection:
// their own details and contact, connection state and status; nothing from the
// host's settings, calendar or private discussion.

export type RequesterReviewView = {
  readonly id: string;
  readonly baseRevision: number;
  readonly intent: ReviewIntent;
  // RequestDetails keys the review would set; null for question and unknown.
  readonly patch: Partial<RequestDetails> | null;
  readonly clarifications: readonly ClarificationCategory[];
};

export type RequesterConfirmationView = {
  readonly confirmed: boolean;
  readonly delivery: "queued" | "sent" | "rejected" | "uncertain" | "suppressed" | null;
  readonly retryAt: string | null;
};

export type RequesterConnectionView = {
  readonly identity: boolean;
  readonly calendar: boolean;
  readonly calendarIds: readonly string[];
  readonly canUseGoogleEmail: boolean;
};

export type RequesterConversationView = {
  readonly generation: number | null;
  readonly state: "none" | "active" | "failed";
  readonly pendingInputs: number;
};

export type OpenRequesterView = {
  readonly open: true;
  readonly request: {
    readonly state: RequestState;
    readonly revision: number;
    readonly expiresAt: string;
    readonly details: Partial<RequestDetails>;
  };
  readonly host: { readonly displayName: string; readonly handle: string | null };
  readonly contact: { readonly name: string; readonly email: string; readonly confirmed: boolean };
  readonly confirmation: RequesterConfirmationView | null;
  readonly connection: RequesterConnectionView;
  readonly pendingReview: RequesterReviewView | null;
  readonly conversation: RequesterConversationView;
  // Whether the request began as a public-page intake whose transcript the page shows.
  readonly hasIntakeTranscript: boolean;
};

// A closed request with an unexpired link: only its final status (and, from
// Phase 4, the confirmed receipt).
export type ClosedRequesterView = {
  readonly open: false;
  readonly request: { readonly state: RequestState };
  readonly host: { readonly displayName: string; readonly handle: string | null };
};

export type RequesterView = OpenRequesterView | ClosedRequesterView;

// The commands the booking page posts to /api/requests/{bookingId}/commands, as
// { operation, input, expectedRevision, retryKey }. Lane D adds its operations
// (request.apply_review, request.dismiss_review, request.update_details,
// request.evaluate, request.choose_candidate, request.agree, ...) to the same
// registry in lib/server/requester-routes.ts.
export const REQUESTER_OPERATIONS = [
  "request.withdraw",
  "contact.resend_confirmation",
  "contact.use_google_email",
  "calendar.disconnect",
  "calendar.select",
] as const;
export type RequesterOperation = (typeof REQUESTER_OPERATIONS)[number];
