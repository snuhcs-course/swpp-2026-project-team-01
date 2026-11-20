import type { RequesterCandidate, RequesterEvaluation } from "./request";

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
  // When no time fits the requester's windows: the nearest open time before
  // and after them (nearest-open-times design 1). Like every candidate, they
  // carry no reason why the windows did not work.
  readonly nearest?: NearestOpenTimes;
};

export type NearestOpenTimes = {
  readonly before: RequesterCandidate | null;
  readonly after: RequesterCandidate | null;
};

// The authored requester messages for an evaluation without candidates (design
// decision 12: the no-match message asks for a wider window or other details
// and gives no rule or reason), in the request's language.
// The times shown at once: the first three of the evaluation's order. The
// times card shows them and **Find other times** shows the next three before
// it searches again; the assistant describes the same three (U11).
export const TIMES_SHOWN = 3;

export const NO_MATCH_MESSAGE = {
  en: "No time in your windows works yet. Try a wider window, other days or a shorter meeting.",
  ko: "말씀하신 시간대에서는 아직 맞는 시간이 없어요. 시간대를 넓히거나 다른 날짜, 더 짧은 미팅으로 다시 찾아보세요.",
} as const;

// The no-match message when the request names its own place, such as another
// area the guest asked for (guest-time-place-pairs design 5): like every
// requester message it gives no reason.
export function noMatchMessage(language: "en" | "ko", place: string | null) {
  if (!place) return NO_MATCH_MESSAGE[language];
  return language === "ko"
    ? `${place}에서는 아직 맞는 시간이 없어요. 다른 지역이나 다른 날짜, 또는 호스트가 안내한 장소로 다시 찾아보세요.`
    : `No time works at ${place} yet. Try another area, other days or one of the host's places.`;
}

// The no-match message when the nearest open times around the requester's
// windows are known: it offers them and, like every requester message, gives
// no reason.
export function nearestTimesMessage(language: "en" | "ko", place: string | null) {
  if (language === "ko") {
    return place
      ? `${place}에서는 말씀하신 시간대에 맞는 시간이 없어요. 그 앞뒤로 가장 가까운 가능한 시간은 다음과 같고, 다른 지역이나 호스트가 안내한 장소로 찾아볼 수도 있어요.`
      : "말씀하신 시간대에는 맞는 시간이 없어요. 그 앞뒤로 가장 가까운 가능한 시간은 다음과 같아요.";
  }
  return place
    ? `No time in your windows works at ${place}. The nearest open times before and after them are these, or try another area or one of the host's places.`
    : "No time in your windows works. The nearest open times before and after them are these.";
}

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
