import { describe, expect, it } from "vitest";
import type { HoursSuggestion, SlotPreview } from "../contracts/slot-preview";
import { CHANNEL_REPLIES } from "./channel-texts";

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

// The onboarding texts take the hours suggestion and the slot preview.
const SAMPLE_ARGS = new Map<unknown, unknown[]>(
  (["en", "ko"] as const).flatMap((language) => [
    [CHANNEL_REPLIES[language].onboarding.hoursQuestion, [HOURS]],
    [CHANNEL_REPLIES[language].onboarding.slotCaption, [PREVIEW]],
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
