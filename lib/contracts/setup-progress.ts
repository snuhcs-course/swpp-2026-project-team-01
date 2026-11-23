// The steps of host setup in a linked chat (setup-chat-guidance, issue #368):
// Calendar, then meeting hours, then where the host meets, then the open times
// with the booking link. Each step's question starts with its progress line
// ("2/4 · Meeting hours"), and the web setup names its cards for the same
// steps with the English names, so both surfaces read alike.

export type SetupProgressLanguage = "en" | "ko";

export const CHAT_SETUP_STEPS = ["calendar", "hours", "place", "openTimes"] as const;

export type ChatSetupStep = (typeof CHAT_SETUP_STEPS)[number];

export const SETUP_STEP_NAMES: Readonly<Record<SetupProgressLanguage, Readonly<Record<ChatSetupStep, string>>>> = {
  en: { calendar: "Calendar", hours: "Meeting hours", place: "Where you meet", openTimes: "Open times" },
  ko: { calendar: "캘린더", hours: "미팅 시간", place: "미팅 장소", openTimes: "열어둘 시간" },
};

// The one line that says what setup covers and how long it takes, sent once
// when setup starts in the chat.
export const SETUP_OVERVIEW: Readonly<Record<SetupProgressLanguage, string>> = {
  en: "Setup takes 4 quick steps here, about 2 minutes: calendar, meeting hours, where you meet, then your open times.",
  ko: "설정은 여기서 4단계, 2분쯤이면 끝나요: 캘린더, 미팅 시간, 미팅 장소, 그리고 열어둘 시간.",
};

// Where a question stands, as the first line of its message: "2/4 · Meeting hours".
export function setupStepLine(language: SetupProgressLanguage, step: ChatSetupStep) {
  return `${CHAT_SETUP_STEPS.indexOf(step) + 1}/${CHAT_SETUP_STEPS.length} · ${SETUP_STEP_NAMES[language][step]}`;
}

// A message that answers or asks one step, under its progress line.
export function withSetupStep(language: SetupProgressLanguage, step: ChatSetupStep, text: string) {
  return `${setupStepLine(language, step)}\n${text}`;
}
