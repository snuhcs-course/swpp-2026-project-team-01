import type { SlotPreview } from "../contracts/slot-preview";
import { WEEKDAYS, type WeeklyWindow } from "../contracts/setup";
import { addDays, type BusyInterval, hostPreviewIntervals, localParts, startOfLocalDay } from "./feasibility";

type PreviewSettings = Pick<SlotPreview, "timezone" | "meetingMode" | "travelMode" | "place" | "durationMinutes" | "reviewRef"> & {
  readonly weeklyWindows: readonly WeeklyWindow[];
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
};

export function nextWeekRange(timezone: string, now: Date) {
  const today = localParts(now.getTime(), timezone).date;
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const weekStart = addDays(today, 7 - weekday);
  return { weekStart, start: new Date(startOfLocalDay(weekStart, timezone)), end: new Date(startOfLocalDay(addDays(weekStart, 7), timezone)) };
}

export function computeSlotPreview(settings: PreviewSettings, busy: readonly BusyInterval[], now: Date): SlotPreview {
  const { timezone } = settings;
  const range = nextWeekRange(timezone, now);
  const intervals = hostPreviewIntervals(settings, busy, range, settings.durationMinutes);
  const clock = (instant: number) => {
    const parts = localParts(instant, timezone);
    return `${String(Math.floor(parts.minute / 60)).padStart(2, "0")}:${String(parts.minute % 60).padStart(2, "0")}`;
  };
  const days = WEEKDAYS.map((weekday, index) => {
    const date = addDays(range.weekStart, index);
    const start = startOfLocalDay(date, timezone);
    const end = startOfLocalDay(addDays(date, 1), timezone);
    return { date, weekday, open: intervals.flatMap(interval => {
      const from = Math.max(start, interval.start);
      const until = Math.min(end, interval.end);
      return from < until ? [{ start: clock(from), end: until === end ? "24:00" : clock(until) }] : [];
    }) };
  });
  const open = days.flatMap(day => day.open);
  return {
    timezone, weekStart: range.weekStart, days,
    grid: { start: open.length ? open.reduce((a, b) => a < b.start ? a : b.start, "24:00") : "10:00",
      end: open.length ? open.reduce((a, b) => a > b.end ? a : b.end, "00:00") : "20:00" },
    place: settings.place, meetingMode: settings.meetingMode, travelMode: settings.travelMode,
    durationMinutes: settings.durationMinutes, reviewRef: settings.reviewRef,
  };
}
