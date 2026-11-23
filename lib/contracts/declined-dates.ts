import type { RequestWindow } from "./request";
import { addDays, instantFromLocal } from "./timezone";

// Other dates a host names as no longer working when declining
// (decline-with-unavailable-dates, #58; guest-flow-completion U17). Each is a
// whole local day in the host's zone and joins the closed request's
// excludedTimes, which its revised request leaves out of every search. Only
// the dates are kept, never a reason.

export const MAX_DECLINED_DATES = 14;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Whether the text is a real calendar date written YYYY-MM-DD.
export function isCalendarDate(text: string) {
  if (!DATE.test(text)) return false;
  const day = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === text;
}

// The first instant of a local date: midnight, or the first whole hour after
// it when a clock change skips midnight in that zone.
function dayStart(date: string, timeZone: string) {
  for (const clock of ["00:00", "01:00", "02:00"]) {
    const instant = instantFromLocal(date, clock, timeZone);
    if (instant) return instant;
  }
  return null;
}

// The local date as an interval from its first instant to the next date's.
export function wholeDay(date: string, timeZone: string): RequestWindow | null {
  if (!isCalendarDate(date)) return null;
  const start = dayStart(date, timeZone);
  const end = dayStart(addDays(date, 1), timeZone);
  return start && end ? { end, start } : null;
}

// The excluded times with the named dates added as whole days in the host's
// zone: a day already listed is not added again, and a day that has already
// ended is left out.
export function withDeclinedDates(
  excluded: readonly RequestWindow[] | undefined,
  dates: readonly string[],
  timeZone: string,
  now: number = Date.now(),
): RequestWindow[] {
  const result = [...(excluded ?? [])];
  for (const date of dates) {
    const day = wholeDay(date, timeZone);
    if (!day || Date.parse(day.end) <= now) continue;
    if (result.some((entry) => entry.start === day.start && entry.end === day.end)) continue;
    result.push(day);
  }
  return result;
}
