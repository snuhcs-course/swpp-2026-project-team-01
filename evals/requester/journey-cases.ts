// The simulated guest journey set (issue #155; documentation 13, "Simulated
// guest journeys"). Each case is a persona with a hidden goal that a simulator
// model plays against the real guest assistant, with the real guest tools on
// the local database and the fake Google Calendar. A case is graded on where
// the conversation ends: the request waits for the host's approval with an
// agreed proposal that fits the hidden goal, within the turn limit, and with a
// tone rubric. Cases are only ever appended, as in the other sets.

import type { Weekday } from "../story/fixtures";

export type JourneyGoal = {
  readonly purpose: string;
  readonly durationMinutes: number;
  readonly mode: "online" | "in_person";
  // For in person: one of the host's areas (GUEST_OFFER in story/fixtures.ts).
  readonly place?: string;
  // A day of next week in Asia/Seoul and the clock range a start may fall in.
  readonly day: Weekday;
  readonly from: string;
  readonly to: string;
};

export type JourneyCase = {
  readonly id: string;
  readonly persona: string;
  readonly style: "busy" | "vague" | "changes-mind" | "plain";
  readonly language: "ko" | "en";
  readonly goal: JourneyGoal;
  // What the guest says first and what they switch to; the goal above is the
  // final one.
  readonly changeOfMind?: string;
  // Guest messages before the conversation counts as failed.
  readonly turnLimit: number;
  readonly trials?: number;
};

export const DEFAULT_TURN_LIMIT = 12;

export const JOURNEY_CASES: readonly JourneyCase[] = [
  {
    id: "J-01",
    persona: "A busy engineering manager. Writes very short messages, no greetings, answers only what is asked, and gets impatient with long replies.",
    style: "busy",
    language: "en",
    goal: { day: "thu", durationMinutes: 30, from: "13:00", mode: "online", purpose: "Quick sync on the hiring pipeline", to: "15:00" },
    turnLimit: DEFAULT_TURN_LIMIT,
  },
  {
    id: "J-02",
    persona: "대학원생. 처음에는 '미팅하고 싶어요'처럼 막연하게 말하고, 질문을 받아야 목적·길이·방식·시간을 하나씩 알려 준다. 공손한 존댓말을 쓴다.",
    style: "vague",
    language: "ko",
    goal: { day: "tue", durationMinutes: 30, from: "14:00", mode: "online", purpose: "컴파일러 수업 질문", to: "17:00" },
    turnLimit: DEFAULT_TURN_LIMIT,
  },
  {
    id: "J-03",
    persona: "스타트업 대표. 친근하지만 일정이 자주 바뀐다. 처음 말한 시간에서 마음을 바꾼다.",
    style: "changes-mind",
    language: "ko",
    goal: { day: "fri", durationMinutes: 30, from: "13:00", mode: "online", purpose: "투자 관련 짧은 상담", to: "16:00" },
    changeOfMind:
      "처음에는 다음 주 수요일 오전(9시~12시)이 좋다고 말한다. 시간이 제안되면 그 시간은 이제 안 된다며 다음 주 금요일 오후(13시~16시)로 바꾸고 싶다고 말한다. 최종 목표는 금요일 오후다.",
    turnLimit: DEFAULT_TURN_LIMIT,
  },
  {
    id: "J-04",
    persona: "직장인. 직접 만나서 이야기하고 싶어 하고, 강남역 근처가 편하다. 짧고 분명하게 말한다.",
    style: "plain",
    language: "ko",
    goal: { day: "thu", durationMinutes: 30, from: "10:00", mode: "in_person", place: "강남역", purpose: "투자 상담", to: "12:00" },
    turnLimit: DEFAULT_TURN_LIMIT,
  },
  {
    id: "J-05",
    persona: "A friendly researcher visiting Seoul. Writes full sentences and asks one clarifying question about how the booking works before agreeing.",
    style: "plain",
    language: "en",
    goal: { day: "mon", durationMinutes: 60, from: "10:00", mode: "online", purpose: "Discuss a joint paper on program analysis", to: "12:00" },
    turnLimit: DEFAULT_TURN_LIMIT,
  },
  {
    id: "J-06",
    persona: "A busy founder who first asks for a time that does not work and then settles. Terse, sometimes mixes in a Korean word.",
    style: "changes-mind",
    language: "en",
    goal: { day: "wed", durationMinutes: 30, from: "15:00", mode: "online", purpose: "Partnership intro", to: "17:00" },
    changeOfMind: "First ask for next Saturday morning. When told it does not work or offered other times, settle for next Wednesday afternoon (15:00 to 17:00).",
    turnLimit: DEFAULT_TURN_LIMIT,
  },
];
