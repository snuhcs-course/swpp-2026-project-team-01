import { z } from "zod";
import type { RequestWindow } from "../contracts/request";
import { resolveLocalTime } from "./feasibility";

// Local availability windows as a guest states them (design decision 15): a
// local date and clock times in a named zone, converted to instants with the
// offset of their own date. A clock time that a daylight-saving change repeats
// or skips on that date is ambiguous_local_time, never guessed. The requester
// tools and the meeting details card send windows this way.

export const localWindowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export type LocalWindow = z.infer<typeof localWindowSchema>;

export type WindowProblem = "ambiguous_local_time" | "past_window" | "too_short" | "invalid_date";

function addDay(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
}

// A local window as instants in the zone. An end at or before the start ends
// on the next day.
export function resolveLocalWindow(
  window: LocalWindow,
  timeZone: string,
  options: { readonly now: number; readonly durationMinutes?: number },
): { readonly ok: true; readonly window: RequestWindow } | { readonly ok: false; readonly problem: WindowProblem } {
  const day = new Date(`${window.date}T00:00:00Z`);

  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== window.date) {
    return { ok: false, problem: "invalid_date" };
  }

  const endDate = window.end <= window.start ? addDay(window.date) : window.date;
  const starts = resolveLocalTime(window.date, window.start, timeZone);
  const ends = resolveLocalTime(endDate, window.end, timeZone);

  if (starts.length !== 1 || ends.length !== 1) return { ok: false, problem: "ambiguous_local_time" };

  const [start] = starts as [number];
  const [end] = ends as [number];

  if (end <= options.now) return { ok: false, problem: "past_window" };
  if (options.durationMinutes && end - Math.max(start, options.now) < options.durationMinutes * 60_000) {
    return { ok: false, problem: "too_short" };
  }

  return { ok: true, window: { end: new Date(end).toISOString(), start: new Date(start).toISOString() } };
}
