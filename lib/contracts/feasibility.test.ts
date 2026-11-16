import { describe, expect, it } from "vitest";
import { NO_MATCH_MESSAGE, noMatchMessage } from "./feasibility";

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
