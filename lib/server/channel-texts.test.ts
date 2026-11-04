import { describe, expect, it } from "vitest";
import { CHANNEL_REPLIES } from "./channel-texts";

// No fixed reply asks the host to type a command or a reference
// (channel-actions-in-words D3), in either language.
const COMMAND = /\b(?:send|reply exactly|send exactly)\b[^.\n]*\b(?:requests|request <ref>|review|changes|setup|approve|decline|share|dismiss|confirm|stop)\b|<ref>/i;

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    const call = value as (...args: unknown[]) => unknown;
    // The picker takes the names of the conversations; every other reply takes strings or numbers.
    return strings(call.length === 2 && call.toString().includes("guests") ? call(["Ada Lovelace"], true) : call("K7Q2MX", "Ada Lovelace", "Coffee", "Thu 10:00"));
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
    expect(CHANNEL_REPLIES.ko.picker(["Ada Lovelace"], true)).toMatch(/[가-힣]/);
    expect(CHANNEL_REPLIES.ko.nextStep.ready).toMatch(/[가-힣]/);
  });
});
