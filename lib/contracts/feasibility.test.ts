import { describe, expect, it } from "vitest";
import { NO_MATCH_MESSAGE, nearestTimesMessage, noMatchMessage } from "./feasibility";

describe("the no-match message", () => {
  it("keeps the window message when the request names no place", () => {
    expect(noMatchMessage("en", null)).toBe(NO_MATCH_MESSAGE.en);
    expect(noMatchMessage("ko", null)).toBe(NO_MATCH_MESSAGE.ko);
  });

  it("names the requested place and suggests other areas, days or the host's places, with no reason", () => {
    const message = noMatchMessage("en", "Hongdae");
    expect(message).toBe("No time works at Hongdae yet. Try another area, other days or one of the host's places.");
    expect(message).not.toMatch(/calendar|busy|travel|commitment/i);
    expect(noMatchMessage("ko", "홍대")).toContain("홍대에서는");
  });
});

describe("the nearest-times message", () => {
  it("offers the nearest times around the windows in the request's language, with no reason", () => {
    for (const language of ["en", "ko"] as const) {
      for (const place of [null, "Hongdae"]) {
        expect(nearestTimesMessage(language, place)).not.toMatch(/calendar|busy|travel|commitment|일정|이동|바쁘/i);
      }
    }
    expect(nearestTimesMessage("en", null)).toMatch(/nearest open times before and after/);
    expect(nearestTimesMessage("ko", "홍대")).toContain("홍대에서는");
  });
});
