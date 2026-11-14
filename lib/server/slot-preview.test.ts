import { expect, it } from "vitest";
import { computeSlotPreview } from "./slot-preview";
import { STARTER_DEFAULTS } from "../contracts/setup";

it("shows all next week's ranges, removing busy time with buffers and short gaps", () => {
  const preview = computeSlotPreview({
    timezone: "Asia/Seoul", weeklyWindows: STARTER_DEFAULTS.weeklyWindows,
    durationMinutes: 30, bufferBeforeMinutes: 10, bufferAfterMinutes: 10,
    meetingMode: "online", travelMode: null, place: null, reviewRef: "ABCD1234",
  }, [{ start: Date.parse("2026-11-16T03:00:00Z"), end: Date.parse("2026-11-16T04:00:00Z"),
    allDay: false, meeting: false, endpoint: { kind: "unknown", reason: "no_location" } }], new Date("2026-11-09T12:00:00Z"));
  expect(preview.weekStart).toBe("2026-11-16");
  expect(preview.days).toHaveLength(7);
  expect(preview.days[0]?.open).toEqual([{ start: "10:00", end: "11:45" }, { start: "13:15", end: "20:00" }]);
  expect(preview.days[4]?.open).toEqual([{ start: "10:00", end: "20:00" }]);
  expect(preview.days[5]?.open).toEqual([]);
});

it("uses the host's Monday, even when UTC is still Sunday, and excludes all-day busy time", () => {
  const preview = computeSlotPreview({ timezone: "Asia/Seoul", weeklyWindows: STARTER_DEFAULTS.weeklyWindows,
    durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, meetingMode: "online", travelMode: null, place: null, reviewRef: "ABCD1234",
  }, [{ start: Date.parse("2026-11-22T15:00:00Z"), end: Date.parse("2026-11-23T15:00:00Z"), allDay: true, meeting: false, endpoint: { kind: "unknown", reason: "no_location" } }], new Date("2026-11-15T16:00:00Z"));
  expect(preview.weekStart).toBe("2026-11-23");
  expect(preview.days[0]?.open).toEqual([]);
});

it("splits overnight availability at midnight and leaves gaps shorter than the meeting closed", () => {
  const settings = { timezone: "UTC", weeklyWindows: [{ weekday: "monday" as const, start: "22:00", end: "02:00" }],
    durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, meetingMode: "online" as const, travelMode: null, place: null, reviewRef: "ABCD1234" };
  const preview = computeSlotPreview(settings, [], new Date("2026-11-09T12:00:00Z"));
  expect(preview.days.slice(0, 2).map(day => day.open)).toEqual([[{ start: "22:00", end: "24:00" }], [{ start: "00:00", end: "02:00" }]]);
  expect(computeSlotPreview({ ...settings, weeklyWindows: [{ weekday: "monday", start: "10:00", end: "10:45" }] }, [], new Date("2026-11-09T12:00:00Z")).days[0]?.open).toEqual([]);
});

it("uses feasibility's rule that an ambiguous DST boundary has no open window", () => {
  const preview = computeSlotPreview({ timezone: "America/New_York", weeklyWindows: [{ weekday: "sunday", start: "01:30", end: "02:30" }],
    durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, meetingMode: "online", travelMode: null, place: null, reviewRef: "ABCD1234",
  }, [], new Date("2026-10-25T12:00:00Z"));
  expect(preview.weekStart).toBe("2026-10-26");
  expect(preview.days[6]?.open).toEqual([]);
});
