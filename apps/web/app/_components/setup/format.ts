import type { AnalysisEvidence } from "@lib/contracts/analysis";
import {
  clockSchema,
  endsNextDay,
  type LocationAnswer,
  type MeetingMode,
  TRAVEL_MODE_LABELS,
  type SetupFieldName,
  type TravelMode,
  VALUE_SOURCE_LABELS,
  type ValueSource,
  WEEKDAYS,
  type Weekday,
  type WeeklyWindow,
} from "@lib/contracts/setup";
import type { HandleAvailability } from "@lib/server/handles";

// Pure presentation and validation for the setup cards, kept apart from React so
// unit tests cover what the host reads and what an editor lets through.

export const WEEKDAY_LABELS: Readonly<Record<Weekday, string>> = {
  friday: "Friday",
  monday: "Monday",
  saturday: "Saturday",
  sunday: "Sunday",
  thursday: "Thursday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
};

export const WEEKDAY_SHORT: Readonly<Record<Weekday, string>> = {
  friday: "Fri",
  monday: "Mon",
  saturday: "Sat",
  sunday: "Sun",
  thursday: "Thu",
  tuesday: "Tue",
  wednesday: "Wed",
};

export const MEETING_MODE_LABELS: Readonly<Record<MeetingMode, string>> = {
  either: "Either",
  in_person: "In person",
  online: "Online",
};

// The badge beside every proposed value. Only an inference names a sample, so a
// starter default never reads as an observed pattern.
export function sourceBadgeText(source: ValueSource, sampleSize?: number | null) {
  if (source === "inferred" && typeof sampleSize === "number" && sampleSize > 0) {
    return `${VALUE_SOURCE_LABELS.inferred} · ${sampleSize} meeting${sampleSize === 1 ? "" : "s"}`;
  }
  return VALUE_SOURCE_LABELS[source];
}

export function formatWindow(window: Pick<WeeklyWindow, "start" | "end">) {
  return `${window.start} – ${window.end}${endsNextDay(window) ? " (next day)" : ""}`;
}

// Seven rows, Monday to Sunday, each with its ranges in start order.
export function weeklyPreview(windows: readonly WeeklyWindow[]) {
  return WEEKDAYS.map((weekday) => ({
    label: WEEKDAY_LABELS[weekday],
    ranges: windows
      .filter((window) => window.weekday === weekday)
      .sort((a, b) => a.start.localeCompare(b.start))
      .map(formatWindow),
    weekday,
  }));
}

export function summarizeWindows(windows: readonly WeeklyWindow[]) {
  const days = weeklyPreview(windows).filter((row) => row.ranges.length > 0);
  if (days.length === 0) return "No windows";
  return days.map((row) => `${WEEKDAY_SHORT[row.weekday]} ${row.ranges.join(", ")}`).join("; ");
}

// Consecutive weekdays with the same ranges, grouped into one compact line each:
// "Mon–Fri 10:00 – 17:00", "Sat–Sun" unavailable.
export function groupWindows(windows: readonly WeeklyWindow[]) {
  const groups: { first: Weekday; last: Weekday; ranges: string }[] = [];
  for (const row of weeklyPreview(windows)) {
    const ranges = row.ranges.join(", ");
    const previous = groups.at(-1);
    if (previous && previous.ranges === ranges) previous.last = row.weekday;
    else groups.push({ first: row.weekday, last: row.weekday, ranges });
  }
  return groups.map((group) => ({
    days: group.first === group.last ? WEEKDAY_SHORT[group.first] : `${WEEKDAY_SHORT[group.first]}–${WEEKDAY_SHORT[group.last]}`,
    ranges: group.ranges || null,
  }));
}

// ---------------------------------------------------------------------------
// The weekly windows editor

export type TimeRange = { readonly start: string; readonly end: string };
export type WindowRows = Readonly<Record<Weekday, readonly TimeRange[]>>;

export function emptyRows(): WindowRows {
  return Object.fromEntries(WEEKDAYS.map((weekday) => [weekday, []])) as unknown as WindowRows;
}

export function rowsFromWindows(windows: readonly WeeklyWindow[]): WindowRows {
  const rows = Object.fromEntries(WEEKDAYS.map((weekday) => [weekday, [] as TimeRange[]])) as Record<Weekday, TimeRange[]>;
  for (const window of windows) rows[window.weekday].push({ end: window.end, start: window.start });
  for (const weekday of WEEKDAYS) rows[weekday].sort((a, b) => a.start.localeCompare(b.start));
  return rows;
}

export type RangeCheck = { readonly error: string | null; readonly nextDay: boolean };

export function checkRange(range: TimeRange): RangeCheck {
  if (!clockSchema.safeParse(range.start).success || !clockSchema.safeParse(range.end).success) {
    return { error: "Use a 24-hour time such as 09:30.", nextDay: false };
  }
  if (range.start === range.end) {
    return { error: "A window can't start and end at the same time.", nextDay: false };
  }
  return { error: null, nextDay: endsNextDay(range) };
}

export const MAX_WINDOWS = 21;

// Whether the rows can be saved, and the windows they save. An end before its
// start is kept as the next day; equal clocks and malformed times block saving.
export function validateRows(rows: WindowRows): {
  readonly windows: WeeklyWindow[];
  readonly error: string | null;
} {
  const windows: WeeklyWindow[] = [];
  let invalid = false;

  for (const weekday of WEEKDAYS) {
    for (const range of rows[weekday]) {
      if (checkRange(range).error) invalid = true;
      windows.push({ end: range.end, start: range.start, weekday });
    }
  }

  if (invalid) return { error: "Fix the highlighted times before saving.", windows };
  if (windows.length === 0) return { error: "Add at least one window.", windows };
  if (windows.length > MAX_WINDOWS) return { error: `Use at most ${MAX_WINDOWS} windows in a week.`, windows };
  return { error: null, windows };
}

// Minutes typed into a number field, within bounds and on the step; null otherwise.
export function parseMinutes(raw: string, min: number, max: number, step = 1) {
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return value >= min && value <= max && value % step === 0 ? value : null;
}

// Lets "930" or "9:30" become "09:30" once it can only mean one time; partial
// input is kept as typed so the host can keep editing.
export function normalizeClock(raw: string) {
  const value = raw.replace(/[^\d:]/g, "");
  const match = value.match(/^(\d{1,2}):(\d{2})$/) ?? value.match(/^(\d{1,2})(\d{2})$/);
  if (match && (value.includes(":") || value.length === 4)) return `${match[1]!.padStart(2, "0")}:${match[2]}`;
  return value;
}

export const WEEKDAY_TARGETS: readonly Weekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday"];

// Copies one day's ranges onto the target days, replacing theirs.
export function copyDay(rows: WindowRows, from: Weekday, targets: readonly Weekday[]): WindowRows {
  const next = { ...rows } as Record<Weekday, readonly TimeRange[]>;
  for (const weekday of targets) if (weekday !== from) next[weekday] = rows[from].map((range) => ({ ...range }));
  return next;
}

// ---------------------------------------------------------------------------
// Labels

export function accessLabel(accessRole: string) {
  switch (accessRole) {
    case "owner":
      return "Owner";
    case "writer":
      return "Can edit";
    case "reader":
      return "View only";
    case "freeBusyReader":
      return "Free/busy only";
    default:
      return "Unknown access";
  }
}

export function canAddEvents(accessRole: string) {
  return accessRole === "owner" || accessRole === "writer";
}

export function formatMinutes(minutes: number) {
  if (minutes === 0) return "None";
  if (minutes < 60 || minutes % 60 !== 0) return `${minutes} min`;
  const hours = minutes / 60;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

export function describeLocation(answer: LocationAnswer) {
  if (answer.kind === "decide_per_meeting") return "Decide per meeting";
  return [answer.areas.length > 0 ? answer.areas.join(", ") : null, answer.venue].filter(Boolean).join(" · ");
}

export function describeTravelMode(mode: TravelMode) {
  return TRAVEL_MODE_LABELS[mode];
}

export function describeLimit(limit: number | null) {
  return limit === null ? "No weekly limit" : `At most ${limit} meeting${limit === 1 ? "" : "s"} a week`;
}

export function handleMessage(availability: HandleAvailability | null) {
  switch (availability) {
    case "available":
      return null;
    case "format":
      return "Use 3–30 lowercase letters, digits or single hyphens, starting with a letter.";
    case "reserved":
      return "That name is reserved. Choose another.";
    case "taken":
      return "That handle belongs to someone else. Choose another.";
    case "change_limit":
      return "You've changed your handle twice in the last 30 days. Keep the current one for now.";
    default:
      return null;
  }
}

export function calendarErrorText(category: string | null) {
  switch (category) {
    case "calendar_not_connected":
      return "Google Calendar isn't connected. Connect it to choose calendars.";
    case "calendar_access_revoked":
      return "Google Calendar access was removed. Connect it again to continue.";
    case "calendar_unavailable":
      return "Google Calendar couldn't be read right now. Try again in a moment.";
    default:
      return null;
  }
}

export const FIELD_LABELS: Readonly<Record<SetupFieldName, string>> = {
  bufferAfterMinutes: "Buffer after",
  bufferBeforeMinutes: "Buffer before",
  displayName: "Display name",
  durationMinutes: "Meeting length",
  handle: "Handle",
  location: "Where you meet",
  meetingMode: "Online or in person",
  noteExclusions: "Note-like entries",
  timezone: "Time zone",
  travelBufferMinutes: "Travel buffer",
  travelMode: "How you travel",
  weeklyLimit: "Weekly meeting limit",
  weeklyWindows: "Weekly windows",
};

// ---------------------------------------------------------------------------
// Analysis

export function formatDay(iso: string, timeZone?: string) {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone, year: "numeric" }).format(
    new Date(iso),
  );
}

export function formatClock(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

// The most frequent weekday-and-hour start slots with their share of meetings.
export function topSlots(preferred: AnalysisEvidence["preferredTimes"], limit = 3) {
  return [...preferred.cells]
    .sort((a, b) => b.count - a.count || WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) || a.hour - b.hour)
    .slice(0, limit)
    .map((cell) => ({
      count: cell.count,
      label: `${WEEKDAY_SHORT[cell.weekday]} ${formatClock(cell.hour)}`,
      share: preferred.sampleSize > 0 ? Math.round((cell.count / preferred.sampleSize) * 100) : 0,
    }));
}

// Meetings per weekday, for the compact weekday summary.
export function weekdayCounts(preferred: AnalysisEvidence["preferredTimes"]) {
  return WEEKDAYS.map((weekday) => ({
    count: preferred.cells.filter((cell) => cell.weekday === weekday).reduce((sum, cell) => sum + cell.count, 0),
    weekday,
  }));
}

export function loadTotals(load: AnalysisEvidence["meetingLoad"]) {
  return load.weeks.reduce(
    (totals, week) => ({ external: totals.external + week.external, internal: totals.internal + week.internal }),
    { external: 0, internal: 0 },
  );
}

// A short, stable, non-reversible key for a string, so browser storage never
// holds the host's address itself.
export function storageKey(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
