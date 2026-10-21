import { describe, expect, it } from "vitest";
import { resolveLocalWindow } from "./local-windows";

const now = Date.parse("2026-10-21T00:00:00Z");

describe("local windows", () => {
  it("converts a local window with the offset of its own date", () => {
    expect(resolveLocalWindow({ date: "2026-10-31", end: "11:00", start: "10:00" }, "America/New_York", { now })).toEqual({
      ok: true,
      window: { end: "2026-10-31T15:00:00.000Z", start: "2026-10-31T14:00:00.000Z" },
    });
    expect(resolveLocalWindow({ date: "2026-11-02", end: "11:00", start: "10:00" }, "America/New_York", { now })).toEqual({
      ok: true,
      window: { end: "2026-11-02T16:00:00.000Z", start: "2026-11-02T15:00:00.000Z" },
    });
  });

  it("asks about a local time a clock change repeats or skips", () => {
    // 01:30 happens twice in New York on 1 November 2026, and 02:30 not at all on 14 March 2027.
    expect(resolveLocalWindow({ date: "2026-11-01", end: "03:00", start: "01:30" }, "America/New_York", { now })).toEqual({
      ok: false,
      problem: "ambiguous_local_time",
    });
    expect(resolveLocalWindow({ date: "2027-03-14", end: "04:00", start: "02:30" }, "America/New_York", { now })).toEqual({
      ok: false,
      problem: "ambiguous_local_time",
    });
  });

  it("ends a window that ends at or before its start on the next day", () => {
    expect(resolveLocalWindow({ date: "2026-11-05", end: "01:00", start: "22:00" }, "Asia/Seoul", { now })).toEqual({
      ok: true,
      window: { end: "2026-11-05T16:00:00.000Z", start: "2026-11-05T13:00:00.000Z" },
    });
  });

  it("refuses a past window, one shorter than the meeting and a date that does not exist", () => {
    expect(resolveLocalWindow({ date: "2026-10-01", end: "11:00", start: "10:00" }, "UTC", { now })).toMatchObject({ problem: "past_window" });
    expect(resolveLocalWindow({ date: "2026-11-01", end: "10:30", start: "10:00" }, "UTC", { durationMinutes: 45, now })).toMatchObject({
      problem: "too_short",
    });
    expect(resolveLocalWindow({ date: "2026-02-30", end: "10:30", start: "10:00" }, "UTC", { now })).toMatchObject({ problem: "invalid_date" });
  });
});
