import { describe, expect, it } from "vitest";
import { readyForTimes } from "./request-lifecycle";

describe("readyForTimes", () => {
  // #241: Apply these details finds times exactly when this holds, on the web
  // and through the assistant.
  it("holds for an identified request with a length and a form, with or without windows", () => {
    expect(readyForTimes("gathering", { durationMinutes: 30, mode: "online" })).toBe(true);
    expect(readyForTimes("negotiating", { durationMinutes: 45, mode: "in_person", purpose: "Lunch" })).toBe(true);
  });

  it("waits for identification and for the length and the form", () => {
    expect(readyForTimes("draft", { durationMinutes: 30, mode: "online" })).toBe(false);
    expect(readyForTimes("gathering", { mode: "online" })).toBe(false);
    expect(readyForTimes("gathering", { durationMinutes: 30 })).toBe(false);
  });
});
