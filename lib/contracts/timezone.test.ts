import { describe, expect, it } from "vitest";
import { currentTime, displayTime, instantFromLocal, offsetLabel, weekOf, zoneLabel } from "./timezone";

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

describe("instantFromLocal", () => {
  it("reads a local time in the zone", () => {
    expect(instantFromLocal("2026-11-02", "10:00", "Asia/Seoul")).toBe("2026-11-02T01:00:00.000Z");
  });

  it("returns null for a skipped time and the earlier instant for a repeated one", () => {
    expect(instantFromLocal("2026-03-08", "02:30", "America/New_York")).toBeNull();
    expect(instantFromLocal("2026-11-01", "01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
  });
});

// The host's current date and weeks (issues #273, #300): Monday to Sunday in the
// host's zone, so tomorrow can be this week and not next week.
describe("currentTime and weekOf", () => {
  const now = new Date("2026-11-19T05:05:00Z"); // Thu 19 Nov 2026, 14:05 in Seoul

  it("gives the date with its year and weekday, and this and next week", () => {
    expect(currentTime("Asia/Seoul", now)).toEqual({
      now: "2026-11-19 (Thursday) 14:05 GMT+9",
      thisWeek: "2026-11-16 to 2026-11-22",
      nextWeek: "2026-11-23 to 2026-11-29",
    });
  });

  it("counts tomorrow and Sunday as this week and the next Monday as next week", () => {
    expect(weekOf(new Date("2026-11-20T01:00:00Z"), "Asia/Seoul", now)).toBe("this_week");
    expect(weekOf(new Date("2026-11-22T14:00:00Z"), "Asia/Seoul", now)).toBe("this_week");
    expect(weekOf(new Date("2026-11-22T15:00:00Z"), "Asia/Seoul", now)).toBe("next_week");
    expect(weekOf(new Date("2026-11-30T01:00:00Z"), "Asia/Seoul", now)).toBe("later");
    expect(weekOf(new Date("2026-11-13T01:00:00Z"), "Asia/Seoul", now)).toBe("earlier");
  });

  it("works the week out in the host's zone, not UTC", () => {
    // Sun 22 Nov 23:30 in Seoul is still Sunday there but Sunday 14:30 UTC.
    expect(weekOf(new Date("2026-11-22T14:30:00Z"), "Asia/Seoul", now)).toBe("this_week");
    // Mon 23 Nov 00:30 in Seoul is next week there although it is Sunday in UTC.
    expect(weekOf(new Date("2026-11-22T15:30:00Z"), "Asia/Seoul", now)).toBe("next_week");
  });
});
