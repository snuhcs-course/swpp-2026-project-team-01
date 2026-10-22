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
