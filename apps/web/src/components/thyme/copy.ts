// AI-generated with Claude Code (claude-opus-5-5), 2026-10-17
import type { Locale } from "@/contracts/profile";

// Every word the landing and host screens show, in English (the default) and Korean. What Thyme says in the
// chat is not here: the server writes it (server/services/host-chat.ts, llm/onboarding.ts).
// The choice lives in the `lang` cookie so server-rendered pages and the chat's server replies follow it.

export const LOCALE_COOKIE = "lang";
export const DEFAULT_LOCALE: Locale = "en";

/** The picked language as the browser holds it, for the calendar step, whose analysis becomes Thyme's first reply in the chat. */
export function browserLocale(): Locale {
  const value = new RegExp(`(?:^|; )${LOCALE_COOKIE}=(en|ko)(?:;|$)`).exec(document.cookie)?.[1];
  return value === "en" || value === "ko" ? value : DEFAULT_LOCALE;
}

export type ExampleRow = string | { name: string; rest: string };
export type ExampleThread = { tag?: string; stamp: string; alt: boolean; lines: { who: "thyme" | "me"; rows: ExampleRow[]; more?: boolean }[] };

const en = {
  language: "Language",
  copy: { idle: "Copy", done: "Copied", fallback: "Select the text" },
  landing: {
    signIn: "Sign in",
    headline: ["Send one link.", "Thyme finds the time.", "All you need is to chat."],
    lede: "Setting up a meeting is tiring, isn't it? Send anyone your link without showing your calendar. Thyme works out the time with them and texts you the plan. You just reply back.",
    google: "Continue with Google",
    calendar: "Connect my Google Calendar too",
    calendarNote: "Thyme reads when you're busy. Nothing is booked until you say OK.",
    agentOr: "Or start from the AI agent you already use",
    agentPrompt: "Let me use findmeatime.com/SKILL.md for my scheduling",
    agentLabel: "Prompt for your agent",
    agentNote: "Paste it into your agent. It walks you through the same setup.",
    guest: "Already asked someone for a time?",
    resume: "Resume your request",
    stepsTitle: "Three steps, then it runs in your messages.",
    steps: [
      ["Start with Google", "Sign in and connect your calendar in one step."],
      ["Link your phone", "Thyme texts you from then on."],
      ["Share your link", "Anyone can ask for a time. They need no account."],
    ],
    tagline: "Thoughtful scheduling. One meeting at a time.",
    legal: "Legal",
    privacy: "Privacy Policy",
    terms: "Terms of Service",
    rights: "All rights reserved.",
  },
  examples: {
    label: "Example conversations with Thyme",
    channel: "Text message",
    slide: (i: number, n: number) => `${i} of ${n}`,
    choose: "Choose an example",
    dot: (i: number, n: number) => `Example ${i} of ${n}`,
    threads: [
      {
        tag: "During setup", stamp: "Today 9:02 AM", alt: true,
        lines: [
          { who: "thyme", rows: ["I read the last 8 weeks of your calendar.", "• Meetings land Tue to Thu, 1 to 5 PM", "• Mornings stay clear", "• Fridays end by 3:00 PM"] },
          { who: "thyme", rows: ["I'll offer people those hours. OK?"] },
          { who: "me", rows: ["Perfect."] },
        ],
      },
      {
        tag: "During setup", stamp: "Today 9:04 AM", alt: true,
        lines: [
          { who: "thyme", rows: ["Your Wednesdays run back to back. 5 of the last 6 had no break after 2 PM."] },
          { who: "thyme", rows: ["Keep 15 minutes free between meetings?"] },
          { who: "me", rows: ["Yes please."] },
          { who: "thyme", rows: ["Done. Wednesdays get a breather."] },
        ],
      },
      {
        tag: "Anytime", stamp: "Yesterday 6:40 PM", alt: true,
        lines: [
          { who: "me", rows: ["By the way, who is Daniel Lee?"] },
          { who: "thyme", rows: ["Daniel is a partner at Lumen Ventures. You met for coffee on Sep 3 and had a call on Oct 1."] },
          { who: "me", rows: ["Find us a time next week."] },
          { who: "thyme", rows: ["Asking him now."] },
        ],
      },
      {
        stamp: "Today 8:30 AM", alt: false,
        lines: [
          { who: "thyme", rows: ["Two requests want Thu 3:00 PM.", { name: "Jisoo Kim", rest: ", investor → Thu 3:00 PM" }, { name: "Minho Park", rest: ", coffee → Fri 10:00 AM" }, "Investors come first. OK?"] },
          { who: "me", rows: ["Who's Minho again?"], more: true },
          { who: "thyme", rows: ["A PM at a robotics startup. You met at demo day in May. He wants hiring advice."], more: true },
          { who: "me", rows: ["OK, go ahead."] },
          { who: "thyme", rows: ["Jisoo is booked. I'll text you when Minho picks a time."] },
        ],
      },
    ] as ExampleThread[],
  },
  phone: {
    heading: "Where should Thyme text you?",
    lede: "Setup continues in your messages, on your phone or your computer. After this, you won't need this page.",
    label: "Mobile number",
    country: "Country code",
    help: "Hyphens are added for you.",
    errorKr: "Enter a mobile number like 10-1234-5678.",
    errorOther: "Check the number. It looks incomplete.",
    submit: "Text me",
    fine: "By tapping Text me, you agree to get texts from Thyme about your meetings. Message and data rates may apply. Reply STOP to stop anytime. iMessage only for now.",
    alt: "Don't use iMessage, or prefer not to give a number?",
    skip: "Set up here in web chat",
  },
  sent: {
    heading: "Thyme just texted you.",
    lede: "Reply to that message to finish setup. You can close this window. All you need is your phone.",
    sentTo: "Sent to",
    web: "Or continue on the web",
  },
  chat: {
    account: "Account",
    demo: "Demo account",
    google: "Signed in with Google",
    menu: { book: "Book a meeting", requests: "Requests", calendar: "My calendar", settings: "Settings", signOut: "Sign out" },
    windowSub: "Your scheduling assistant",
    heading: "Your conversation with Thyme",
    suggestions: "Suggested replies",
    say: "Message Thyme",
    sayElse: "Message Thyme to say something else",
    send: "Send",
    linkReady: "Your link is ready",
    recover: "Check result",
    conflict: "Settings changed elsewhere, so I loaded the latest. Please send it again.",
  },
};

export type Copy = typeof en;

const ko: Copy = {
  language: "언어",
  copy: { idle: "복사", done: "복사했어요", fallback: "직접 선택해 복사하세요" },
  landing: {
    signIn: "로그인",
    headline: ["링크 하나만 보내세요.", "시간은 Thyme이 찾아요.", "당신은 대화만 하면 돼요."],
    lede: "미팅 시간 잡기, 번거롭죠? 캘린더를 보여 주지 않고도 누구에게나 링크를 보내세요. Thyme이 상대와 시간을 맞추고 계획을 문자로 알려 드려요. 답장만 하면 돼요.",
    google: "Google로 계속하기",
    calendar: "Google Calendar도 함께 연결",
    calendarNote: "Thyme은 바쁜 시간만 읽어요. 확인하기 전에는 아무것도 예약하지 않아요.",
    agentOr: "또는 이미 쓰는 AI 에이전트에서 시작하기",
    agentPrompt: "내 일정 조율에 findmeatime.com/SKILL.md를 써 줘",
    agentLabel: "에이전트에 넣을 프롬프트",
    agentNote: "에이전트에 붙여 넣으면 같은 설정을 안내해요.",
    guest: "이미 누군가에게 시간을 요청했나요?",
    resume: "요청 이어서 하기",
    stepsTitle: "세 단계면, 나머지는 메시지로 진행돼요.",
    steps: [
      ["Google로 시작", "로그인하고 캘린더까지 한 번에 연결해요."],
      ["휴대폰 연결", "그다음부터 Thyme이 문자로 연락해요."],
      ["링크 공유", "누구나 시간을 요청할 수 있어요. 계정이 없어도 돼요."],
    ],
    tagline: "신중한 일정 조율. 한 번에 한 미팅씩.",
    legal: "법적 고지",
    privacy: "개인정보 처리방침",
    terms: "이용약관",
    rights: "모든 권리 보유.",
  },
  examples: {
    label: "Thyme과의 대화 예시",
    channel: "문자 메시지",
    slide: (i: number, n: number) => `${n}개 중 ${i}번째`,
    choose: "예시 고르기",
    dot: (i: number, n: number) => `예시 ${i} / ${n}`,
    threads: [
      {
        tag: "설정 중", stamp: "오늘 오전 9:02", alt: true,
        lines: [
          { who: "thyme", rows: ["지난 8주 캘린더를 읽었어요.", "• 미팅은 화–목 오후 1–5시에 몰려 있어요", "• 오전은 비어 있어요", "• 금요일은 오후 3시 전에 끝나요"] },
          { who: "thyme", rows: ["사람들에게 이 시간대를 제안할게요. 괜찮을까요?"] },
          { who: "me", rows: ["좋아요."] },
        ],
      },
      {
        tag: "설정 중", stamp: "오늘 오전 9:04", alt: true,
        lines: [
          { who: "thyme", rows: ["수요일은 미팅이 연달아 있어요. 최근 6번 중 5번은 오후 2시 이후 쉬는 시간이 없었어요."] },
          { who: "thyme", rows: ["미팅 사이에 15분을 비워 둘까요?"] },
          { who: "me", rows: ["네, 그렇게 해 주세요."] },
          { who: "thyme", rows: ["완료했어요. 수요일에 숨 돌릴 틈이 생겼어요."] },
        ],
      },
      {
        tag: "언제든", stamp: "어제 오후 6:40", alt: true,
        lines: [
          { who: "me", rows: ["그런데 Daniel Lee가 누구였지?"] },
          { who: "thyme", rows: ["Lumen Ventures 파트너예요. 9월 3일에 커피를 마셨고 10월 1일에 통화했어요."] },
          { who: "me", rows: ["다음 주에 시간 잡아 줘."] },
          { who: "thyme", rows: ["지금 물어볼게요."] },
        ],
      },
      {
        stamp: "오늘 오전 8:30", alt: false,
        lines: [
          { who: "thyme", rows: ["두 요청이 목요일 오후 3시를 원해요.", { name: "김지수", rest: ", 투자자 → 목 오후 3:00" }, { name: "박민호", rest: ", 커피챗 → 금 오전 10:00" }, "투자자를 먼저 잡을게요. 괜찮을까요?"] },
          { who: "me", rows: ["민호가 누구였지?"], more: true },
          { who: "thyme", rows: ["로봇 스타트업 PM이에요. 5월 데모데이에서 만났고, 채용 조언을 원해요."], more: true },
          { who: "me", rows: ["좋아, 진행해."] },
          { who: "thyme", rows: ["지수 님 일정은 확정했어요. 민호 님이 시간을 고르면 문자로 알려 드릴게요."] },
        ],
      },
    ],
  },
  phone: {
    heading: "Thyme이 어디로 문자를 보낼까요?",
    lede: "설정은 휴대폰이나 컴퓨터의 메시지에서 이어져요. 이 다음부터는 이 페이지가 필요 없어요.",
    label: "휴대폰 번호",
    country: "국가 번호",
    help: "하이픈은 자동으로 들어가요.",
    errorKr: "10-1234-5678 같은 휴대폰 번호를 입력해 주세요.",
    errorOther: "번호를 확인해 주세요. 덜 입력된 것 같아요.",
    submit: "문자 받기",
    fine: "문자 받기를 누르면 미팅에 관한 Thyme의 문자를 받는 데 동의하게 돼요. 메시지·데이터 요금이 부과될 수 있어요. 언제든 STOP으로 답하면 멈춰요. 지금은 iMessage만 지원해요.",
    alt: "iMessage를 쓰지 않거나 번호를 알려 주고 싶지 않나요?",
    skip: "여기서 웹 채팅으로 설정하기",
  },
  sent: {
    heading: "Thyme이 문자를 보냈어요.",
    lede: "그 메시지에 답장하면 설정이 끝나요. 이 창은 닫아도 돼요. 휴대폰만 있으면 돼요.",
    sentTo: "받는 번호",
    web: "또는 웹에서 계속하기",
  },
  chat: {
    account: "계정",
    demo: "데모 계정",
    google: "Google로 로그인됨",
    menu: { book: "미팅 예약", requests: "요청함", calendar: "내 캘린더", settings: "설정", signOut: "로그아웃" },
    windowSub: "일정 비서",
    heading: "Thyme과의 대화",
    suggestions: "추천 답장",
    say: "Thyme에게 메시지",
    sayElse: "다른 말을 하려면 입력하세요",
    send: "보내기",
    linkReady: "링크가 준비됐어요",
    recover: "결과 확인",
    conflict: "다른 화면에서 설정이 바뀌어 최신 내용을 불러왔어요. 다시 보내 주세요.",
  },
};

export const COPY: Record<Locale, Copy> = { en, ko };
