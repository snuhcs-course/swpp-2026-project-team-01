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

// The authored requester messages for an evaluation without candidates (design
// decision 12: the no-match message asks for a wider window or other details
// and gives no rule or reason), in the request's language.
export const NO_MATCH_MESSAGE = {
  en: "No time in your windows works yet. Try a wider window, other days or a shorter meeting.",
  ko: "말씀하신 시간대에서는 아직 맞는 시간이 없어요. 시간대를 넓히거나 다른 날짜, 더 짧은 미팅으로 다시 찾아보세요.",
} as const;

export const EVALUATION_FAILURE_MESSAGES: Readonly<Record<RequesterEvaluationFailure, { readonly en: string; readonly ko: string }>> = {
  needs_details: {
    en: "Add when you are free, and the meeting length and mode, to find times.",
    ko: "시간을 찾으려면 가능한 시간대와 미팅 길이, 방식을 알려 주세요.",
  },
  requester_calendar_unavailable: {
    en: "Your connected calendar could not be read. Reconnect it, or disconnect it and give your free times yourself.",
    ko: "연결한 캘린더를 읽지 못했어요. 다시 연결하거나, 연결을 해제하고 가능한 시간을 직접 알려 주세요.",
  },
  try_again: {
    en: "Finding times did not finish. Try Find other times again.",
    ko: "시간 찾기가 끝나지 않았어요. 다른 시간 찾기를 다시 눌러 주세요.",
  },
};
