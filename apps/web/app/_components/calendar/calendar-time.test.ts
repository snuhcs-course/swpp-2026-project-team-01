import { describe, expect, it } from "vitest";
import { clockRange, dayIn, daysRange, minutesIn, overlaps, pickedInstant, placement, visibleHours, weekOf, weekTitle } from "./calendar-time";

const SEOUL = "Asia/Seoul";
// 2026-12-01 10:00–10:30 in Seoul.
const slot = { end: "2026-12-01T01:30:00.000Z", start: "2026-12-01T01:00:00.000Z" };

describe("calendar time helpers", () => {
  it("reads local days and minutes in the grid's zone", () => {
    expect(dayIn(slot.start, SEOUL)).toBe("2026-12-01");
    expect(dayIn(slot.start, "America/Los_Angeles")).toBe("2026-11-30");
    expect(minutesIn(slot.start, SEOUL)).toBe(600);
    expect(clockRange(slot, SEOUL)).toBe("10:00–10:30");
  });

  it("builds Monday-first weeks and their titles", () => {
    expect(weekOf("2026-12-03")).toEqual(["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"]);
    expect(weekOf("2026-11-30")[0]).toBe("2026-11-30");
    expect(weekOf("2026-12-06")[0]).toBe("2026-11-30");
    expect(weekTitle(weekOf("2026-12-03"))).toBe("30 Nov – 6 Dec 2026");
    expect(weekTitle(weekOf("2026-12-09"))).toBe("7 – 13 Dec 2026");
  });

  it("widens the hours to cover every marked time on the shown days", () => {
    const days = weekOf("2026-12-01");
    expect(visibleHours([slot], days, SEOUL)).toEqual([8, 19]);
    const early = { end: "2026-11-30T22:00:00.000Z", start: "2026-11-30T21:15:00.000Z" }; // 06:15–07:00 on 1 Dec
    const late = { end: "2026-12-02T12:30:00.000Z", start: "2026-12-02T11:00:00.000Z" }; // 20:00–21:30 on 2 Dec
    expect(visibleHours([early, late], days, SEOUL)).toEqual([6, 22]);
    expect(visibleHours([late], ["2026-12-01"], SEOUL)).toEqual([8, 19]);
  });

  it("places a span in its day's column and cuts it at the drawn hours", () => {
    expect(placement(slot, "2026-12-01", SEOUL, [8, 19])).toEqual({ height: 30, top: 120 });
    expect(placement(slot, "2026-12-02", SEOUL, [8, 19])).toBeNull();
    const overnight = { end: "2026-12-01T16:00:00.000Z", start: "2026-12-01T13:00:00.000Z" }; // 22:00–01:00
    expect(placement(overnight, "2026-12-01", SEOUL, [8, 24])).toEqual({ height: 120, top: 840 });
    expect(placement(overnight, "2026-12-02", SEOUL, [0, 19])).toEqual({ height: 60, top: 0 });
    expect(placement({ end: slot.end, start: "2026-11-30T23:00:00.000Z" }, "2026-12-01", SEOUL, [9, 19])).toEqual({ height: 90, top: 0 });
  });

  it("turns a pointer offset into a quarter-hour instant", () => {
    expect(pickedInstant("2026-12-01", 127, [8, 19], SEOUL)).toBe("2026-12-01T01:00:00.000Z");
    expect(pickedInstant("2026-12-01", 9999, [8, 19], SEOUL)).toBe("2026-12-01T09:45:00.000Z");
  });

  it("tells overlapping spans and the range a week loads", () => {
    expect(overlaps(slot, { end: "2026-12-01T02:00:00.000Z", start: "2026-12-01T01:15:00.000Z" })).toBe(true);
    expect(overlaps(slot, { end: "2026-12-01T02:00:00.000Z", start: slot.end })).toBe(false);
    expect(daysRange(weekOf("2026-12-01"))).toEqual({ from: "2026-11-29T00:00:00.000Z", to: "2026-12-08T00:00:00.000Z" });
  });
});
