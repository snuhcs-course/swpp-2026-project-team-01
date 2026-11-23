import { addDays, instantFromLocal, localDate } from "@lib/contracts/timezone";

// Day and clock arithmetic for the calendar grids (calendar-views design 1).
// A day is a "YYYY-MM-DD" key in the grid's own time zone; times on the grid
// are minutes from that day's local midnight. The host Dashboard's Week view
// uses the same geometry: Monday-first weeks, hour rows and blocks placed by
// their local start and end.

export const DEFAULT_HOURS: readonly [number, number] = [8, 19];

export type Span = { readonly start: string; readonly end: string };

export { addDays };

/** The local day of an instant in a zone. */
export function dayIn(instant: string, timeZone: string) {
  return localDate(new Date(instant), timeZone);
}

/** Minutes from local midnight of an instant in a zone. */
export function minutesIn(instant: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { hour: "2-digit", hourCycle: "h23", minute: "2-digit", timeZone }).formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value("hour") * 60 + value("minute");
}

/** The Monday-first week holding a day, as seven day keys. */
export function weekOf(day: string) {
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addDays(day, -weekday);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

/** "Tue 1 Dec": the label of a day column. */
export function dayLabel(day: string, weekday: "short" | "long" = "short") {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC", weekday }).format(new Date(`${day}T00:00:00Z`));
}

/** "30 Nov – 6 Dec 2026", or "1 – 7 Dec 2026" within one month. */
export function weekTitle(days: readonly string[]) {
  const first = new Date(`${days[0]}T00:00:00Z`);
  const last = new Date(`${days.at(-1)}T00:00:00Z`);
  const month = (date: Date) => new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(date);
  return first.getUTCMonth() === last.getUTCMonth()
    ? `${first.getUTCDate()} – ${last.getUTCDate()} ${month(last)} ${last.getUTCFullYear()}`
    : `${first.getUTCDate()} ${month(first)} – ${last.getUTCDate()} ${month(last)} ${last.getUTCFullYear()}`;
}

/** "10:00–10:30" in a zone, on the 24-hour clock the cards use. */
export function clockRange(span: Span, timeZone: string) {
  const format = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", minute: "2-digit", timeZone });
  return `${format.format(new Date(span.start))}–${format.format(new Date(span.end))}`;
}

/**
 * The hour rows to draw: the default working day, widened to the whole hours
 * that cover every given span on the shown days, so no proposed or offered
 * time falls outside the grid.
 */
export function visibleHours(spans: readonly Span[], days: readonly string[], timeZone: string, fallback = DEFAULT_HOURS): readonly [number, number] {
  let [first, last] = fallback;
  for (const span of spans) {
    const day = dayIn(span.start, timeZone);
    if (!days.includes(day)) continue;
    const start = minutesIn(span.start, timeZone);
    const endDay = dayIn(span.end, timeZone);
    const end = endDay === day ? minutesIn(span.end, timeZone) : 24 * 60;
    first = Math.min(first, Math.floor(start / 60));
    last = Math.max(last, Math.ceil(end / 60));
  }
  return [Math.max(0, first), Math.min(24, last)];
}

/**
 * Where a timed span sits in one day's column, in minutes from the first
 * drawn hour, or null when none of it is drawn on that day. A span running
 * past midnight is cut at the day's edge.
 */
export function placement(span: Span, day: string, timeZone: string, hours: readonly [number, number]) {
  const startDay = dayIn(span.start, timeZone);
  const endDay = dayIn(span.end, timeZone);
  if (day < startDay || day > endDay) return null;
  const start = startDay === day ? minutesIn(span.start, timeZone) : 0;
  const end = endDay === day ? minutesIn(span.end, timeZone) : 24 * 60;
  if (endDay === day && end === 0 && startDay !== day) return null;
  const top = Math.max(start, hours[0] * 60);
  const bottom = Math.min(end, hours[1] * 60);
  if (bottom <= top) return null;
  return { top: top - hours[0] * 60, height: bottom - top };
}

/** Whether two spans share any time. */
export function overlaps(a: Span, b: Span) {
  return Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);
}

/**
 * The instant a pointer pick names: the day's local time at the given
 * minutes from the first drawn hour, rounded down to a quarter hour. Null for
 * a local time that does not exist (a clock change gap).
 */
export function pickedInstant(day: string, offsetMinutes: number, hours: readonly [number, number], timeZone: string, step = 15) {
  const total = Math.min(Math.max(hours[0] * 60 + Math.floor(offsetMinutes / step) * step, hours[0] * 60), hours[1] * 60 - step);
  const clock = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  return instantFromLocal(day, clock, timeZone);
}

/** The instant range a set of days covers, a day either side for zone offsets. */
export function daysRange(days: readonly string[]) {
  return { from: new Date(`${addDays(days[0]!, -1)}T00:00:00Z`).toISOString(), to: new Date(`${addDays(days.at(-1)!, 2)}T00:00:00Z`).toISOString() };
}
