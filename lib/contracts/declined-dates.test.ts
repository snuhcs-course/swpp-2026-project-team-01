import { describe, expect, it } from "vitest";
import { isCalendarDate, wholeDay, withDeclinedDates } from "./declined-dates";

// Other dates a host names when declining (decline-with-unavailable-dates, #58):
// whole local days in the host's zone, added once to the excluded times.

describe("isCalendarDate", () => {
  it("accepts only real YYYY-MM-DD dates", () => {
    expect(isCalendarDate("2026-12-03")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    for (const text of ["2026-02-29", "2026-13-01", "2026-12-3", "Dec 3", "2026-12-03T00:00", ""]) {
      expect(isCalendarDate(text)).toBe(false);
    }
  });
});

describe("wholeDay", () => {
  it("spans the local date in the host's zone", () => {
    expect(wholeDay("2026-12-03", "Asia/Seoul")).toEqual({ end: "2026-12-03T15:00:00.000Z", start: "2026-12-02T15:00:00.000Z" });
  });

  it("follows a clock change, so a day can be 23 hours", () => {
    expect(wholeDay("2026-03-08", "America/New_York")).toEqual({ end: "2026-03-09T04:00:00.000Z", start: "2026-03-08T05:00:00.000Z" });
  });

  it("starts at the first hour that exists when a clock change skips midnight", () => {
    const day = wholeDay("2026-09-06", "America/Santiago");
    expect(day).not.toBeNull();
    expect(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", minute: "2-digit", timeZone: "America/Santiago" }).format(new Date(day!.start))).toBe("01:00");
  });

  it("refuses a date that does not exist", () => {
    expect(wholeDay("2026-02-30", "Asia/Seoul")).toBeNull();
  });
});

describe("withDeclinedDates", () => {
  const now = Date.parse("2026-12-01T00:00:00Z");
  const declined = { end: "2026-12-02T02:00:00.000Z", start: "2026-12-02T01:00:00.000Z" };

  it("keeps the declined time and appends each named day once", () => {
    expect(withDeclinedDates([declined], ["2026-12-03", "2026-12-05", "2026-12-03"], "Asia/Seoul", now)).toEqual([
      declined,
      { end: "2026-12-03T15:00:00.000Z", start: "2026-12-02T15:00:00.000Z" },
      { end: "2026-12-05T15:00:00.000Z", start: "2026-12-04T15:00:00.000Z" },
    ]);
  });

  it("does not add a day already listed, a day that has ended or a malformed date", () => {
    const listed = { end: "2026-12-03T15:00:00.000Z", start: "2026-12-02T15:00:00.000Z" };
    expect(withDeclinedDates([listed], ["2026-12-03", "2026-11-20", "soon"], "Asia/Seoul", now)).toEqual([listed]);
    expect(withDeclinedDates(undefined, [], "Asia/Seoul", now)).toEqual([]);
  });
});
