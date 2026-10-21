import { describe, expect, it } from "vitest";
import { displayTime, offsetLabel, zoneLabel } from "./timezone";

// Date-specific offsets (design decision 15): each time carries the offset of
// its own date, on both sides of a daylight-saving change.
describe("date-specific offsets", () => {
  it("shows New York's offset before and after the November change", () => {
    expect(displayTime(new Date("2026-10-31T14:00:00Z"), "America/New_York")).toBe("Sat 31 Oct, 10:00 GMT-4");
    expect(displayTime(new Date("2026-11-02T15:00:00Z"), "America/New_York")).toBe("Mon 2 Nov, 10:00 GMT-5");
  });

  it("shows London's offset before and after the October change", () => {
    expect(offsetLabel(new Date("2026-10-24T12:00:00Z"), "Europe/London")).toBe("GMT+1");
    expect(offsetLabel(new Date("2026-10-26T12:00:00Z"), "Europe/London")).toBe("GMT");
  });

  it("keeps a zone without daylight saving and a half-hour offset steady", () => {
    expect(displayTime(new Date("2026-11-03T01:00:00Z"), "Asia/Seoul")).toBe("Tue 3 Nov, 10:00 GMT+9");
    expect(offsetLabel(new Date("2026-11-03T01:00:00Z"), "Asia/Kolkata")).toBe("GMT+5:30");
  });

  it("labels a zone with the offset at the given instant", () => {
    expect(zoneLabel("America/New_York", new Date("2026-07-01T12:00:00Z"))).toBe("America/New York (GMT-4)");
    expect(zoneLabel("America/New_York", new Date("2026-12-01T12:00:00Z"))).toBe("America/New York (GMT-5)");
  });
});
