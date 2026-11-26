// Guest timezone display (design decision 15), shared by the guest thread on
// the public host page and the booking page, and server projections. Times always carry the offset of
// their own date, so a meeting on the far side of a daylight-saving change shows
// the offset that applies then, not today's.

// The zone the browser reports, or UTC when it reports none.
export function detectedTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export { isValidTimeZone } from "./setup";

// Some runtimes write a zero offset as "GMT+0"; it is always shown as "GMT".
function offsetName(value: string | undefined) {
  return !value || value === "GMT+0" || value === "UTC" ? "GMT" : value;
}

// The offset of the zone at that instant, such as "GMT+9", "GMT-4" or "GMT+5:30";
// a zero offset is "GMT".
export function offsetLabel(instant: Date, timeZone: string) {
  const part = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(instant)
    .find((candidate) => candidate.type === "timeZoneName");
  return offsetName(part?.value);
}

// A display line with the date-specific offset, such as "Mon 3 Nov, 10:00 GMT+9".
export function displayTime(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "short",
      timeZone,
      timeZoneName: "shortOffset",
      weekday: "short",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );

  return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${offsetName(parts.timeZoneName)}`;
}

// The local date of an instant in the zone, as YYYY-MM-DD.
export function localDate(instant: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone, year: "numeric" }).format(instant);
}

export function addDays(date: string, days: number) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

// The Monday that starts the Monday-to-Sunday week of a YYYY-MM-DD date.
function mondayOf(date: string) {
  return addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
}

// The current date and time in the zone, with its year and weekday, and this
// and next week (Monday to Sunday), such as
// { now: "2026-11-19 (Thursday) 14:05 GMT+9", thisWeek: "2026-11-16 to 2026-11-22", nextWeek: "2026-11-23 to 2026-11-29" }.
export function currentTime(timeZone: string, now: Date = new Date()) {
  const today = localDate(now, timeZone);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long" }).format(now);
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", minute: "2-digit", timeZone }).format(now);
  const monday = mondayOf(today);
  return {
    now: `${today} (${weekday}) ${clock} ${offsetLabel(now, timeZone)}`,
    thisWeek: `${monday} to ${addDays(monday, 6)}`,
    nextWeek: `${addDays(monday, 7)} to ${addDays(monday, 13)}`,
  };
}

// Which Monday-to-Sunday week, in the zone, an instant falls in relative to now.
export function weekOf(instant: Date, timeZone: string, now: Date = new Date()) {
  const weeks = Math.round(
    (new Date(`${mondayOf(localDate(instant, timeZone))}T00:00:00Z`).getTime() -
      new Date(`${mondayOf(localDate(now, timeZone))}T00:00:00Z`).getTime()) /
      (7 * 24 * 60 * 60 * 1000),
  );
  return weeks < 0 ? "earlier" : weeks === 0 ? "this_week" : weeks === 1 ? "next_week" : "later";
}

// The timezone line: "Asia/Seoul (GMT+9)", with the offset at `at`.
export function zoneLabel(timeZone: string, at: Date = new Date()) {
  return `${timeZone.replaceAll("_", " ")} (${offsetLabel(at, timeZone)})`;
}

// The per-tab storage key of an explicit timezone choice. It is kept in
// sessionStorage, so it survives a reload and the return from Google consent in
// the same tab, and is forgotten with the tab.
export const TIMEZONE_STORAGE_KEY = "fmat.timezone";

// The authored question for a local time a clock change makes ambiguous or
// skips (clarification category ambiguous_local_time).
export const AMBIGUOUS_LOCAL_TIME_QUESTION = {
  en: "Because of a clock change, that time happens twice or not at all on that date. Which time do you mean?",
  ko: "그날은 시간 변경 때문에 그 시각이 두 번 있거나 아예 없어요. 어느 시각을 말씀하시는지 알려 주세요.",
} as const;

function offsetMinutes(instant: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      hour: "numeric",
      hourCycle: "h23",
      minute: "numeric",
      month: "numeric",
      second: "numeric",
      timeZone,
      year: "numeric",
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, Number(part.value)]),
  );
  const local = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return Math.round((local - Math.floor(instant / 1000) * 1000) / 60_000);
}

// The instant a local date (YYYY-MM-DD) and clock (HH:MM) name in a zone, as an
// ISO string; null when a clock change skips that local time. A time a clock
// change repeats resolves to its earlier instant. Used by the host's suggestion
// editor, whose times are in the host's own zone.
export function instantFromLocal(date: string, clock: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const time = /^(\d{2}):(\d{2})$/.exec(clock);
  if (!match || !time) return null;

  const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(time[1]), Number(time[2]));
  // The offsets a day either side cover both sides of any clock change.
  const offsets = [wall - 86_400_000, wall, wall + 86_400_000].map((instant) => offsetMinutes(instant, timeZone));
  const candidates = [...new Set(offsets.map((offset) => wall - offset * 60_000))]
    .filter((instant) => instant + offsetMinutes(instant, timeZone) * 60_000 === wall)
    .sort((a, b) => a - b);

  return candidates.length > 0 ? new Date(candidates[0]!).toISOString() : null;
}

export const BOOKING_WEEK_REPLY_NOTE =
  "booked is a confirmed meeting, which stands while a change is negotiated; proposed is a time not yet booked. Each week is Monday to Sunday in the host's timezone, as current gives this and next week. Asked about a week's meetings, name only those whose week matches, each with the requester and the time; when there are none, say so and name any booked this week or next week instead, such as \"No meetings are booked next week. This week you meet {requester} on {date} at {time}.\"";
