import { type ClarificationCategory, isClarificationCategory, type RequestLanguage } from "./request";
import { AMBIGUOUS_LOCAL_TIME_QUESTION } from "./timezone";

// The authored clarification questions (design decision 12; meeting-requests:
// authored application extraction questions). Requester extraction names a
// category; the question the requester sees is always this application text, in
// the request's language, never model prose. No question asserts agreement,
// approval, selection or booking.

export { CLARIFICATION_CATEGORIES, type ClarificationCategory, isClarificationCategory } from "./request";

export const CLARIFICATION_QUESTIONS: Readonly<Record<ClarificationCategory, Readonly<Record<RequestLanguage, string>>>> = {
  missing_date: {
    en: "Which date or dates would work for you?",
    ko: "어느 날짜가 괜찮으신가요?",
  },
  missing_time: {
    en: "What time of day works for you on that date? Give a start and an end time.",
    ko: "그날 몇 시부터 몇 시까지 괜찮으신가요?",
  },
  missing_timezone: {
    en: "Which timezone are those times in?",
    ko: "말씀하신 시간은 어느 시간대 기준인가요?",
  },
  ambiguous_local_time: AMBIGUOUS_LOCAL_TIME_QUESTION,
  missing_duration: {
    en: "How long should the meeting be?",
    ko: "미팅은 얼마나 길게 잡을까요?",
  },
  missing_mode: {
    en: "Should the meeting be online or in person?",
    ko: "온라인으로 만날까요, 직접 만날까요?",
  },
  missing_location: {
    en: "Where would you like to meet?",
    ko: "어디에서 만나고 싶으신가요?",
  },
  unclear_location: {
    en: "Which place do you mean? An address or a venue name helps.",
    ko: "어느 장소를 말씀하시는 건가요? 주소나 장소 이름을 알려 주세요.",
  },
  missing_purpose: {
    en: "What would you like to talk about in the meeting?",
    ko: "미팅에서 어떤 이야기를 나누고 싶으신가요?",
  },
};

export function clarificationQuestion(category: ClarificationCategory, language: RequestLanguage) {
  return CLARIFICATION_QUESTIONS[category][language];
}

// Splits named categories into the authored ones and the rest, which reject the
// whole extraction before any domain write.
export function parseClarifications(values: readonly string[]) {
  const categories = [...new Set(values)];
  const unsupported = categories.filter((value) => !isClarificationCategory(value));
  return { categories: categories.filter(isClarificationCategory), unsupported };
}
