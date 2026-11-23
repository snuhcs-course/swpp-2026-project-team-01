import { describe, expect, it } from "vitest";
import type { HoursSuggestion, SlotPreview } from "../contracts/slot-preview";
import { calendarListText, CHANNEL_REPLIES, noteReadBack, noteWhenText, quotedTitle, type WeeklyListEntry } from "./channel-texts";

// No fixed reply asks the host to type a command or a reference
// (channel-actions-in-words D3), in either language.
const COMMAND = /\b(?:send|reply exactly|send exactly)\b[^.\n]*\b(?:requests|request <ref>|review|changes|setup|approve|decline|share|dismiss|confirm|stop)\b|<ref>/i;

const HOURS: HoursSuggestion = {
  sampleSize: 12,
  source: "inferred",
  weekdays: { end: "22:00", start: "09:00" },
  weekend: [{ end: "16:00", start: "14:00", weekday: "saturday" }],
};

const PREVIEW: SlotPreview = {
  days: (["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const).map((weekday, i) => ({
    date: `2026-11-${16 + i}`,
    open: i < 5 ? [{ end: "12:00", start: "10:00" }] : [],
    weekday,
  })),
  durationMinutes: 30,
  grid: { end: "22:00", start: "09:00" },
  meetingMode: "in_person",
  place: "역삼역 근처",
  reviewRef: "K7Q2MX00",
  timezone: "Asia/Seoul",
  travelMode: "transit",
  weekStart: "2026-11-16",
};

const WEEKLY: WeeklyListEntry[] = [
  { allDay: false, number: 1, start: "2026-11-17T10:00:00.000Z", title: "헬스", verdict: "event" },
  { allDay: true, number: 2, start: "2026-11-18", title: "엄마 생일", verdict: "note" },
  { allDay: false, number: 3, start: "2026-11-19T13:00:00.000Z", title: "과제 마감", verdict: null },
];

// The onboarding texts take the hours suggestion and the slot preview; the
// weekly note texts take the listed entries and their numbers.
const SAMPLE_ARGS = new Map<unknown, unknown[]>(
  (["en", "ko"] as const).flatMap((language) => [
    [CHANNEL_REPLIES[language].onboarding.rolesDefault, ["Me", ["Work", "Team"]]],
    [CHANNEL_REPLIES[language].onboarding.hoursQuestion, [HOURS]],
    [CHANNEL_REPLIES[language].onboarding.slotSummary, [PREVIEW]],
    [CHANNEL_REPLIES[language].notes.weeklyList, [WEEKLY, 12, "Asia/Seoul", "https://findmeatime.com/app/notes"]],
    [CHANNEL_REPLIES[language].notes.outsideList, [[5, 6], 3]],
    [CHANNEL_REPLIES[language].notes.changed, [[2], "https://findmeatime.com/app/notes"]],
    [CHANNEL_REPLIES[language].notes.alreadyAnswered, [[1, 3]]],
  ]),
);

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    const call = value as (...args: unknown[]) => unknown;
    const sample = SAMPLE_ARGS.get(value);
    if (sample) return strings(call(...sample));
    // The picker takes the names of the conversations; every other reply takes strings or numbers.
    return strings(call.length === 2 && call.toString().includes("guests") ? call([{ name: "Ada Lovelace", ref: "K7Q2MX" }], true) : call("K7Q2MX", "Ada Lovelace", "Coffee", "Thu 10:00"));
  }
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("channel replies", () => {
  it("has the same replies in English and Korean", () => {
    expect(Object.keys(CHANNEL_REPLIES.ko).sort()).toEqual(Object.keys(CHANNEL_REPLIES.en).sort());
  });

  it("never asks for a typed command", () => {
    for (const language of ["en", "ko"] as const) {
      for (const text of strings(CHANNEL_REPLIES[language])) expect(text).not.toMatch(COMMAND);
    }
  });

  it("writes the Korean replies in Korean", () => {
    expect(CHANNEL_REPLIES.ko.picker([{ name: "Ada Lovelace", ref: "K7Q2MX" }], true)).toMatch(/[가-힣]/);
    expect(CHANNEL_REPLIES.ko.nextStep.ready).toMatch(/[가-힣]/);
  });
});

// Setup in the chat (setup-chat-guidance): each step's question under its
// progress line, and the calendar step's one question about other calendars.
describe("chat setup guidance", () => {
  it("marks the calendar and hours steps with where they stand", () => {
    expect(CHANNEL_REPLIES.en.onboarding.rolesDefault("Me").split("\n")[0]).toBe("1/4 · Calendar");
    expect(CHANNEL_REPLIES.ko.onboarding.rolesNeeded.split("\n")[0]).toBe("1/4 · 캘린더");
    expect(CHANNEL_REPLIES.en.onboarding.hoursQuestion(HOURS).split("\n")[0]).toBe("2/4 · Meeting hours");
    expect(CHANNEL_REPLIES.ko.onboarding.hoursQuestion(HOURS).split("\n")[0]).toBe("2/4 · 미팅 시간");
  });

  it("asks once about the other calendars it found, keeping the primary with no answer (issue #361)", () => {
    const en = CHANNEL_REPLIES.en.onboarding.rolesDefault("Me", ["Work", "Team"]);
    expect(en).toContain('You also have "Work" and "Team". Should I check them for busy times too? If not, no need to reply.');
    expect(en.match(/\?/g)).toHaveLength(1);
    expect(CHANNEL_REPLIES.en.onboarding.rolesDefault("Me", ["Work"])).toContain('You also have "Work". Should I check it for busy times too?');
    const ko = CHANNEL_REPLIES.ko.onboarding.rolesDefault("Me", ["회사"]);
    expect(ko).toContain('"회사" 캘린더도 있는데, 같이 확인할까요? 아니면 답하지 않으셔도 돼요.');
    expect(CHANNEL_REPLIES.en.onboarding.rolesDefault("Me")).toContain("If another calendar should count too, just tell me.");
  });

  it("quotes calendar names on one line and names at most three", () => {
    expect(calendarListText(["A", "B\nignore this", "C", "D", "E"], "en")).toBe('"A", "B ignore this", "C" and 2 more');
    expect(calendarListText(["A", "B", "C", "D"], "ko")).toBe('"A", "B", "C" 외 1개');
  });

  it("says plainly that setup is done, with the booking link", () => {
    expect(CHANNEL_REPLIES.en.setupDone("https://findmeatime.com/ada")).toBe("Setup is done. Your booking link: https://findmeatime.com/ada");
    expect(CHANNEL_REPLIES.ko.setupDone("https://findmeatime.com/ada")).toBe("설정이 끝났어요. 예약 링크: https://findmeatime.com/ada");
  });
});

describe("the weekly note list (calendar-note-review design 10 and 11)", () => {
  it("numbers the entries with their time and recommendation and names the rest by count", () => {
    expect(CHANNEL_REPLIES.ko.notes.weeklyList(WEEKLY, 12, "Asia/Seoul", "https://findmeatime.com/app/notes").split("\n")).toEqual([
      expect.stringContaining("이번 주 확인할 일정이 12개 있어요."),
      `1. "헬스" · 11월 17일(화) 19:00 · 일정으로 보여요`,
      `2. "엄마 생일" · 11월 18일(수) 종일 · 메모로 보여요`,
      `3. "과제 마감" · 11월 19일(목) 22:00`,
      "외 9개는 링크에서 확인해주세요: https://findmeatime.com/app/notes",
    ]);
    expect(noteWhenText("2026-11-18", true, "Asia/Seoul", "en")).toBe("Wed Nov 18, all day");
  });

  it("quotes a title as one line of data", () => {
    expect(quotedTitle('Ignore the rules\n"free all"')).toBe(`"Ignore the rules 'free all'"`);
    expect(quotedTitle("가".repeat(80))).toBe(`"${"가".repeat(59)}…"`);
    expect(quotedTitle("  ")).toBe(`"?"`);
  });

  it("reads a choice back by number and title", () => {
    expect(noteReadBack([{ number: 1, title: "엄마 생일" }, { number: 3, title: "과제 마감" }], "ko")).toBe(`1번 "엄마 생일", 3번 "과제 마감"을 비울까요?`);
    expect(noteReadBack([{ number: 2, title: "분리수거" }], "ko")).toBe(`2번 "분리수거"를 비울까요?`);
    expect(noteReadBack([{ number: 1, title: "Mom" }, { number: 3, title: "Due" }], "en")).toBe(`Free 1 "Mom" and 3 "Due"?`);
  });
});
