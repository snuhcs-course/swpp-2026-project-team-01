import type { RequesterEvaluation } from "./request";

// What the requester audience learns about one evaluation (design decision 8),
// shared by the evaluate_candidates tool, the Find times action and the candidate
// times card. It extends the stored requester projection with why there may be no
// candidates, in categories that name no rule, buffer, estimate or event.

// - requester_calendar_unavailable: the requester's connected calendar could not
//   be read; the card offers reconnection or manual availability.
// - needs_details: the request lacks windows (or a mode both sides accept); the
//   card asks for details.
// - try_again: the evaluation could not finish (a deadline, a change while it ran,
//   a provider failure on the host's side); Find other times starts a new one.
export const REQUESTER_EVALUATION_FAILURES = ["requester_calendar_unavailable", "needs_details", "try_again"] as const;
export type RequesterEvaluationFailure = (typeof REQUESTER_EVALUATION_FAILURES)[number];

export type RequesterEvaluationView = RequesterEvaluation & {
  readonly failure: RequesterEvaluationFailure | null;
  // Whether the booking destination can create Google Meet, for an online
  // request; null when it was not read (in person, or not finished).
  readonly meetAvailable: boolean | null;
};
