import type { HoursSuggestion } from "../contracts/slot-preview";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AnalysisCard, AnalysisEvidence, AnalysisForModel, AnalysisState, PlaceHint, ScannedCalendar } from "../contracts/analysis";
import {
  type DraftFields,
  isValidTimeZone,
  MIN_INFERENCE_SAMPLE,
  type SetupFieldName,
  type SetupFieldValue,
  STARTER_DEFAULTS,
  WEEKDAYS,
  type WeeklyWindow,
  type Weekday,
} from "../contracts/setup";
import { type CommandDefinition, CommandError } from "./commands";
import type { Queryable, Transaction } from "./database";
import {
  CalendarAccessError,
  type CalendarAccessCategory,
  type CalendarEvent,
  type GoogleCalendarConfig,
  googleCalendarConfigFromEnvironment,
  openHostCalendar,
} from "./google-calendar";
import { encodeDisplayName } from "./entry-documents";
import { meetingGuests } from "./feasibility";
import { activeBindingOfHost, bindingRecipient } from "./imessage-links";
import { recordOutbound } from "./imessage-outbox";
import { hostConversationLanguage } from "./channel-language";
import { channelReplies } from "./channel-texts";
import { readReadiness } from "./readiness";
import { HostIneligibleError } from "./host-eligibility";
import { type ClaimedJob, type JobHandler, publishJob } from "./jobs";
import { type NoteAnswer, noteAnswerMatcher, readNoteAnswers } from "./note-answers";
import { limitNoteClassifier } from "./model-limits";
import { classifyNoteCandidates, type NoteCandidate, type NoteClassifierModel, type NoteVerdict } from "./note-classifier";
import { knownWeeklyVerdicts, publishWeeklyNoteReview } from "./note-weekly-store";
import { noteClassifierFromEnvironment } from "./note-classifier-stand-in";
import { type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// Calendar analysis (design decision 8). Saving roles, or Analyze again, publishes
// a calendar_analysis job beside a pending app.calendar_analyses row. The job
// reads the saved conflict calendars over the four weeks before the
// scan and stores evidence under iteration 1's F02 rules, or records which
// calendar failed. Evidence only ever feeds labeled suggestions; it expires after
// 24 hours (app.cleanup_calendar_analyses).

export const CALENDAR_ANALYSIS_JOB = "calendar_analysis";

const RANGE_DAYS = 28;
// The overall read budget, inside the job's 120-second lease.
const ANALYSIS_BUDGET_MS = 30_000;
const MAX_NOTE_ENTRIES = 100;
// A scan still pending after this long was lost (its job exhausted or its lease
// expired); the state reports it failed so the host can analyze again.
export const ANALYSIS_STALE_AFTER_MINUTES = 15;
export const ANALYSIS_FAILED = "analysis_failed";

// ---------------------------------------------------------------------------
// Evidence

type EvidenceContext = {
  readonly timezone: string;
  // The primary calendar's own zone, when the calendar list was read.
  readonly primaryTimeZone?: string | null;
  readonly hostEmail: string;
  readonly calendars: readonly { readonly id: string; readonly summary: string; readonly ok: boolean }[];
  // The scanned range, so a full week without meetings counts toward the minimum load.
  readonly range?: { readonly start: Date; readonly end: Date };
  // Entries the host already answered (free or keep busy). An entry an answer
  // matches (note-answers.ts) is not a candidate.
  readonly answers?: readonly NoteAnswer[];
  // The scan's clock: note candidates are only entries that have not ended.
  readonly now?: Date;
};

const SHORT_WEEKDAYS: Readonly<Record<string, Weekday>> = {
  Fri: "friday",
  Mon: "monday",
  Sat: "saturday",
  Sun: "sunday",
  Thu: "thursday",
  Tue: "tuesday",
  Wed: "wednesday",
};

// Local date, weekday and minute of the day of an instant in the host timezone.
function localTime(formatter: Intl.DateTimeFormat, instant: Date) {
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: SHORT_WEEKDAYS[parts.weekday!]!,
  };
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

// The Monday that starts the week of a local date.
function weekStart(date: string, weekday: Weekday) {
  return addDays(date, -WEEKDAYS.indexOf(weekday));
}

// Whether some Monday-to-Sunday week lying wholly inside the range, in the host
// timezone, is missing from the weeks that had meetings.
function hasEmptyFullWeek(
  formatter: Intl.DateTimeFormat,
  range: { readonly start: Date; readonly end: Date },
  busyWeeks: ReadonlySet<string>,
) {
  const start = localTime(formatter, range.start);
  const end = localTime(formatter, range.end);
  // The first week starting strictly after the range's first local day.
  let monday = addDays(weekStart(start.date, start.weekday), 7);

  for (; addDays(monday, 7) <= end.date; monday = addDays(monday, 7)) {
    if (!busyWeeks.has(monday)) return true;
  }

  return false;
}

function emailDomain(email: string) {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

function isHost(attendee: CalendarEvent["attendees"][number], hostEmail: string) {
  return attendee.self || attendee.email.toLowerCase() === hostEmail;
}

// Busy unless cancelled, transparent or declined by the host.
function isBusy(event: CalendarEvent, hostEmail: string) {
  return (
    event.status !== "cancelled" &&
    event.transparency !== "transparent" &&
    !event.attendees.some((attendee) => isHost(attendee, hostEmail) && attendee.responseStatus === "declined")
  );
}

// Copies of one event on several calendars share the provider identity: the
// iCalUID with the instance's start, or the event ID when there is no iCalUID.
function eventIdentity(event: CalendarEvent) {
  if (!event.iCalUID) return `id:${event.id}`;

  const start = event.start.dateTime ? new Date(event.start.dateTime).toISOString() : (event.start.date ?? "");
  return `uid:${event.iCalUID}|${start}`;
}

function tally(counts: Map<string, { name: string; count: number }>, name: string) {
  const key = name.toLowerCase();
  const entry = counts.get(key);

  if (entry) entry.count += 1;
  else counts.set(key, { count: 1, name });
}

// The most frequent entry; ties keep the one seen first.
function top(counts: Map<string, { name: string; count: number }>) {
  let best: { name: string; count: number } | null = null;

  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }

  return best ? { count: best.count, name: best.name } : null;
}

function median(values: readonly number[]) {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

// The evidence dimensions over the scanned events (design decision 8):
// - a counted meeting is busy, timed, and has at least one other attendee who did
//   not decline, or a location without a conference link; all-day events are never
//   counted. Weekly load still counts only meetings with guests, as feasibility does;
// - it is internal when every such attendee shares the host's email domain;
// - note candidates (calendar-note-review design 1) are busy, timed or all-day,
//   and have no other attendee; a location or a link does not exclude one ("헬스"
//   at a gym may be a note). Entries that have ended, and entries the host
//   answered with an unchanged fingerprint, are left out. Candidates stay
//   busy: the classifier only recommends, and the host decides;
// - places come from busy timed events with a location and no conference link, so
//   an event with both decides nothing.
export function computeEvidence(events: readonly CalendarEvent[], ctx: EvidenceContext): AnalysisEvidence {
  const hostEmail = ctx.hostEmail.trim().toLowerCase();
  const hostDomain = emailDomain(hostEmail);
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: ctx.timezone,
    weekday: "short",
    year: "numeric",
  });

  const seen = new Set<string>();
  const answered = noteAnswerMatcher(ctx.answers ?? []);
  // Only entries still ahead are note candidates: freeing a past one opens no
  // time. A timed entry counts until its end; an all-day entry while its
  // (exclusive) end date is after today in the host timezone. Without a clock,
  // every entry counts.
  const today = ctx.now ? localTime(formatter, ctx.now).date : null;
  const ended = (event: CalendarEvent) => {
    if (!ctx.now) return false;
    if (event.end.dateTime) return Date.parse(event.end.dateTime) <= ctx.now.getTime();
    return event.end.date !== undefined && event.end.date <= today!;
  };
  const cells = new Map<string, { weekday: Weekday; hour: number; count: number }>();
  const samples: { weekday: Weekday; startMinute: number; endMinute: number }[] = [];
  const locations = new Map<string, { name: string; count: number }>();
  const spans = new Map<Weekday, { startMinute: number; endMinute: number }>();
  const weeks = new Map<string, { internal: number; external: number }>();
  const durations: number[] = [];
  const notes: AnalysisEvidence["noteLike"]["entries"][number][] = [];
  const venues = new Map<string, { name: string; count: number }>();
  const areas = new Map<string, { name: string; count: number }>();
  let placeSample = 0;
  let meetings = 0;

  for (const event of events) {
    if (!isBusy(event, hostEmail)) continue;

    const identity = eventIdentity(event);
    if (seen.has(identity)) continue;
    seen.add(identity);

    const others = event.attendees.filter((attendee) => !isHost(attendee, hostEmail));
    const timed = Boolean(event.start.dateTime && event.end.dateTime);

    if (others.length === 0 && notes.length < MAX_NOTE_ENTRIES && !ended(event) && !answered(event)) {
      notes.push({
        allDay: !timed,
        calendarId: event.calendarId,
        end: event.end.dateTime ?? event.end.date ?? "",
        eventId: event.id,
        fingerprint: event.updated ?? "",
        hasConferenceLink: event.hasConferenceLink,
        hasLocation: event.location !== null,
        seriesId: event.recurringEventId,
        start: event.start.dateTime ?? event.start.date ?? "",
        title: event.summary?.trim() || "(No title)",
      });
    }

    if (!timed) continue;

    const start = new Date(event.start.dateTime!);
    const end = new Date(event.end.dateTime!);

    // An event that ends at or before its start blocks no time and, as at
    // evaluation, is no meeting.
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) continue;

    if (event.location && !event.hasConferenceLink) {
      const location = locations.get(event.location);
      if (location) location.count += 1;
      else locations.set(event.location, { name: event.location, count: 1 });
      const [venue, area] = event.location.split(",").map((part) => part.trim());
      placeSample += 1;
      if (venue) tally(venues, venue);
      if (area) tally(areas, area);
    }

    const present = meetingGuests(event, hostEmail);
    if (present.length === 0 && !(event.location && !event.hasConferenceLink)) continue;

    const local = localTime(formatter, start);
    const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
    const hour = Math.floor(local.minute / 60);
    const cellKey = `${local.weekday}:${hour}`;
    const cell = cells.get(cellKey);

    if (cell) cell.count += 1;
    else cells.set(cellKey, { count: 1, hour, weekday: local.weekday });

    const span = spans.get(local.weekday);
    const endLocal = localTime(formatter, end);
    const dayOffset = Math.round((Date.parse(endLocal.date) - Date.parse(local.date)) / 86_400_000);
    const endMinute = dayOffset * 1440 + endLocal.minute;
    samples.push({ weekday: local.weekday, startMinute: local.minute, endMinute });

    if (span) {
      span.startMinute = Math.min(span.startMinute, local.minute);
      span.endMinute = Math.max(span.endMinute, endMinute);
    } else {
      spans.set(local.weekday, { endMinute, startMinute: local.minute });
    }

    durations.push(minutes);
    if (present.length === 0) continue;
    meetings += 1;
    const week = weekStart(local.date, local.weekday);
    const load = weeks.get(week) ?? { external: 0, internal: 0 };
    const internal = present.every((attendee) => emailDomain(attendee.email) === hostDomain);

    if (internal) load.internal += 1;
    else load.external += 1;
    weeks.set(week, load);
  }

  const weekList = [...weeks]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([weekStartDate, load]) => ({ external: load.external, internal: load.internal, weekStart: weekStartDate }));
  const totals = weekList.map((week) => week.internal + week.external);
  const emptyWeek = ctx.range ? hasEmptyFullWeek(formatter, ctx.range, new Set(weeks.keys())) : false;

  return {
    durations: { medianMinutes: median(durations), sampleSize: durations.length },
    meetingLoad: {
      max: totals.length ? Math.max(...totals) : 0,
      min: totals.length && !emptyWeek ? Math.min(...totals) : 0,
      sampleSize: meetings,
      weeks: weekList,
    },
    noteLike: { entries: notes },
    places: { area: top(areas), sampleSize: placeSample, venue: top(venues), candidates: [...locations.values()].sort((a, b) => b.count - a.count).slice(0, 5) },
    preferredTimes: {
      samples,
      cells: [...cells.values()].sort(
        (a, b) => WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) || a.hour - b.hour,
      ),
      sampleSize: samples.length,
      spans: WEEKDAYS.flatMap((weekday) => {
        const span = spans.get(weekday);
        return span ? [{ endMinute: span.endMinute, startMinute: span.startMinute, weekday }] : [];
      }),
    },
    primaryTimeZone: ctx.primaryTimeZone ?? null,
    scannedCalendars: ctx.calendars.map((calendar) => ({ id: calendar.id, ok: calendar.ok, summary: calendar.summary })),
    timezone: ctx.timezone,
  };
}

// ---------------------------------------------------------------------------
// Suggestions

export type FieldSuggestion<F extends SetupFieldName> = {
  readonly value: SetupFieldValue<F>;
  readonly source: "inferred" | "starter_default";
  readonly sampleSize: number | null;
  readonly reason: string;
};

export type SetupSuggestions = Partial<{ [F in SetupFieldName]: FieldSuggestion<F> }>;

function clock(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function tooFew(count: number) {
  return `Only ${count} counted meeting${count === 1 ? "" : "s"} in the scan, too few to infer a pattern, so this is a starter default.`;
}

// One window per weekday with meetings, from the hour of the earliest start to
// the hour after the latest end. An end past midnight keeps its real next-day
// clock (a meeting until 01:00 ends the window at 01:00), which the windows
// contract reads as the next day because it is earlier than the start. A span of
// a whole day or more ends a minute before the start hour.
function windowsFromSpans(spans: AnalysisEvidence["preferredTimes"]["spans"]): WeeklyWindow[] {
  return spans.map((span) => {
    const startHour = Math.floor(span.startMinute / 60);
    const endHour = Math.max(Math.ceil(span.endMinute / 60), startHour + 1);
    const end =
      endHour < 24
        ? clock(endHour)
        : endHour - 24 < startHour
          ? clock(endHour - 24)
          : startHour === 0
            ? "23:59"
            : `${String(startHour - 1).padStart(2, "0")}:59`;
    return { end, start: clock(startHour), weekday: span.weekday };
  });
}

function suggestedWindows(evidence: AnalysisEvidence): WeeklyWindow[] {
  const samples = evidence.preferredTimes.samples;
  // Older retained scans did not store individual times; analyze again for the new rule.
  if (!samples) return windowsFromSpans(evidence.preferredTimes.spans);
  const repeated = (entries: typeof samples) => {
    const index = entries.length === 2 ? 0 : 1;
    return {
      startMinute: entries.map(entry => entry.startMinute).sort((a, b) => a - b)[index]!,
      endMinute: entries.map(entry => entry.endMinute).sort((a, b) => b - a)[index]!,
    };
  };
  const weekdays = samples.filter(entry => !["saturday", "sunday"].includes(entry.weekday));
  const spans = weekdays.length >= 2
    ? WEEKDAYS.slice(0, 5).map(weekday => ({ weekday, ...repeated(weekdays) })) : [];
  for (const weekday of ["saturday", "sunday"] as const) {
    const entries = samples.filter(entry => entry.weekday === weekday);
    if (entries.length >= 2) spans.push({ weekday, ...repeated(entries) });
  }
  const windows = windowsFromSpans(spans);
  return weekdays.length < 2 && windows.length > 0 ? [...STARTER_DEFAULTS.weeklyWindows, ...windows] : windows;
}

export function hoursSuggestion(evidence: AnalysisEvidence | null): HoursSuggestion {
  const sampleSize = evidence?.preferredTimes.sampleSize ?? 0;
  const windows = evidence !== null && sampleSize >= MIN_INFERENCE_SAMPLE ? suggestedWindows(evidence) : [];
  const inferred = windows.length > 0;
  const weekdays = windows.find(window => window.weekday === "monday") ?? STARTER_DEFAULTS.weeklyWindows[0]!;
  return {
    weekdays: { start: weekdays.start, end: weekdays.end },
    weekend: windows.flatMap(window => window.weekday === "saturday" || window.weekday === "sunday"
      ? [{ weekday: window.weekday, start: window.start, end: window.end }] : []),
    source: inferred ? "inferred" : "starter_default",
    sampleSize,
  };
}

// The weekly windows suggestion when the scan counted hours in another zone than
// the one now proposed: its hours would be shifted, so the starter default stands
// in, saying why.
export function windowsInOtherZone(countedZone: string, proposedZone: string): FieldSuggestion<"weeklyWindows"> {
  return {
    reason: `The scan counted your meetings in ${countedZone}, not ${proposedZone}, so this is a starter default. Analyze again to count them in ${proposedZone}.`,
    sampleSize: null,
    source: "starter_default",
    value: STARTER_DEFAULTS.weeklyWindows,
  };
}

// Suggestions from evidence, with starter defaults where evidence is thin
// (design decision 5). Mode, location and transport are host answers and are
// never suggested; display name and handle come from the Google profile, not
// from calendar evidence. The caller never lets a suggestion overwrite a value
// the host stated or accepted.
export function suggestFromEvidence(evidence: AnalysisEvidence, primaryTimeZone: string | null): SetupSuggestions {
  const meetings = evidence.preferredTimes.sampleSize;
  const enough = meetings >= MIN_INFERENCE_SAMPLE;
  const suggestions: SetupSuggestions = {};

  if (primaryTimeZone && isValidTimeZone(primaryTimeZone)) {
    suggestions.timezone = {
      reason: "The time zone of your primary Google calendar.",
      sampleSize: null,
      source: "inferred",
      value: primaryTimeZone,
    };
  }

  const windows = enough ? suggestedWindows(evidence) : [];
  suggestions.weeklyWindows =
    windows.length > 0
      ? {
          reason: `From ${meetings} meetings: one weekday range from repeated starts and ends.`,
          sampleSize: meetings,
          source: "inferred",
          value: windows,
        }
      : { reason: tooFew(meetings), sampleSize: meetings, source: "starter_default", value: STARTER_DEFAULTS.weeklyWindows };

  suggestions.weeklyLimit = {
    reason: "No limit unless you set one.",
    sampleSize: null,
    source: "starter_default",
    value: STARTER_DEFAULTS.weeklyLimit,
  };

  const durations = evidence.durations;
  suggestions.durationMinutes =
    durations.sampleSize >= MIN_INFERENCE_SAMPLE && durations.medianMinutes !== null
      ? {
          reason: `The median length of ${durations.sampleSize} meetings, rounded to 15 minutes.`,
          sampleSize: durations.sampleSize,
          source: "inferred",
          value: Math.min(240, Math.max(15, Math.round(durations.medianMinutes / 15) * 15)),
        }
      : {
          reason: tooFew(durations.sampleSize),
          sampleSize: durations.sampleSize,
          source: "starter_default",
          value: STARTER_DEFAULTS.durationMinutes,
        };

  const bufferReason = "A starter default; buffers cannot be observed from your calendar.";
  suggestions.bufferBeforeMinutes = {
    reason: bufferReason,
    sampleSize: null,
    source: "starter_default",
    value: STARTER_DEFAULTS.bufferBeforeMinutes,
  };
  suggestions.bufferAfterMinutes = {
    reason: bufferReason,
    sampleSize: null,
    source: "starter_default",
    value: STARTER_DEFAULTS.bufferAfterMinutes,
  };
  suggestions.travelBufferMinutes = {
    reason: "A starter default for travel to in-person meetings.",
    sampleSize: null,
    source: "starter_default",
    value: STARTER_DEFAULTS.travelBufferMinutes,
  };
  suggestions.noteExclusions = {
    reason: "Nothing is excluded until you confirm which entries are notes.",
    sampleSize: null,
    source: "starter_default",
    value: STARTER_DEFAULTS.noteExclusions,
  };

  return suggestions;
}

// The most frequent in-person area and venue, shown beside the location question.
export function placeHintFromEvidence(evidence: AnalysisEvidence): PlaceHint {
  return {
    area: evidence.places.area?.name ?? null,
    sampleSize: evidence.places.sampleSize,
    venue: evidence.places.venue?.name ?? null,
  };
}

// ---------------------------------------------------------------------------
// Publication and commands

// Share-locks the actor's account for the rest of the transaction and requires it
// active, so a concurrent suspension waits and a suspended host changes nothing.
export async function lockActiveHost(tx: Transaction, hostAccountId: string) {
  const [row] = await tx<{ status: string }[]>`
    select status from app.host_accounts where id = ${hostAccountId} for share
  `;

  if (row?.status !== "active") {
    throw new CommandError("forbidden", {
      cause: new HostIneligibleError(row ? "account_suspended" : "sign_in"),
    });
  }
}

// Setup's lock order, in every transaction that takes more than one of them: the
// account share lock (lockActiveHost), then the host's calendar roles
// (lockCalendarRoles), then its draft (lockDraft), then handle locks. Saving roles
// and confirming both touch roles and the draft, so a different order deadlocks.
export async function lockCalendarRoles(tx: Transaction, hostAccountId: string) {
  // An advisory lock, because the first save has no row to lock.
  await tx`select pg_advisory_xact_lock(hashtextextended(${`app.calendar_roles:${hostAccountId}`}, 0))`;
}

// Locks the host's draft row. With no row yet the revision is 0, so a first
// write expects 0 and creates revision 1.
export async function lockDraft(tx: Transaction, hostAccountId: string) {
  // Serializes the first write, which has no row to lock.
  await tx`select pg_advisory_xact_lock(hashtextextended(${`app.setup_drafts:${hostAccountId}`}, 0))`;
  const [row] = await tx<{ fields: DraftFields; revision: number }[]>`
    select revision, fields from app.setup_drafts where host_account_id = ${hostAccountId} for update
  `;
  return { fields: row?.fields ?? {}, revision: row?.revision ?? 0 };
}

// Writes the draft's fields as the next revision. The caller holds lockDraft.
export async function writeDraft(tx: Transaction, hostAccountId: string, fields: DraftFields) {
  const [saved] = await tx<{ revision: number }[]>`
    insert into app.setup_drafts as stored (host_account_id, fields)
    values (${hostAccountId}, ${tx.json(fields as Parameters<typeof tx.json>[0])})
    on conflict (host_account_id) do update set
      fields = excluded.fields, revision = stored.revision + 1, updated_at = now()
    returning revision
  `;
  return saved!.revision;
}

// Inserts a pending scan of the saved conflict calendars and publishes its job in
// the caller's transaction. One scan per (host, key): publishing the same key again
// returns the scan already published. A weekly note check (calendar-note-review
// design 9) names its week, so the finished scan records that week's review.
export async function publishAnalysis(
  tx: Transaction,
  hostAccountId: string,
  rolesRevision: number,
  key: string,
  options: { readonly weeklyCheck?: string; readonly rangeDays?: number } = {},
) {
  const analysisId = randomUUID();
  const rangeDays = options.rangeDays ?? RANGE_DAYS;
  const jobId = await publishJob(tx, {
    dedupeKey: `${CALENDAR_ANALYSIS_JOB}:${hostAccountId}:${key}`,
    kind: CALENDAR_ANALYSIS_JOB,
    payload: { analysisId, ...(options.weeklyCheck ? { weeklyCheck: options.weeklyCheck } : {}) },
  });

  if (!jobId) {
    const [existing] = await tx<{ analysis_id: string }[]>`
      select payload ->> 'analysisId' as analysis_id
      from app.jobs
      where kind = ${CALENDAR_ANALYSIS_JOB} and dedupe_key = ${`${CALENDAR_ANALYSIS_JOB}:${hostAccountId}:${key}`}
    `;
    return existing!.analysis_id;
  }

  await tx`
    insert into app.calendar_analyses (id, host_account_id, roles_revision, range_start, range_end, calendars)
    select ${analysisId}, r.host_account_id, ${rolesRevision},
           now() - make_interval(days => ${rangeDays}), now() + make_interval(days => ${rangeDays}),
           coalesce(
             (select jsonb_agg(jsonb_build_object('id', c ->> 'id', 'summary', c ->> 'summary', 'ok', null))
              from jsonb_array_elements(r.conflict_calendars) c),
             '[]'::jsonb
           )
    from app.calendar_roles r
    where r.host_account_id = ${hostAccountId}
  `;

  return analysisId;
}

// Clears a manual-setup choice, because a new scan is wanted. It takes the draft
// lock in setup's order and creates no row: a missing draft already means "not
// skipped" at revision 0, and the revision is unchanged, so no open card goes stale.
export async function ensureDraftForAnalysis(tx: Transaction, hostAccountId: string) {
  await lockDraft(tx, hostAccountId);
  await tx`
    update app.setup_drafts set analysis_skipped = false, updated_at = now()
    where host_account_id = ${hostAccountId} and analysis_skipped
  `;
}

const emptyInput = z.object({}).strict();

// Analyze again: a fresh scan of the saved roles. Its key comes from the
// command's correlation ID, so each new request scans once and an exact retry
// replays the saved outcome through runCommand instead of scanning again.
export const analyzeAgainCommand: CommandDefinition<Record<string, never>, { analysisId: string }> = {
  input: emptyInput as z.ZodType<Record<string, never>>,
  operation: "setup.analyze_again",
  async run(tx, context) {
    await lockActiveHost(tx, context.actor.id);
    await lockCalendarRoles(tx, context.actor.id);

    const [roles] = await tx<{ revision: number }[]>`
      select revision from app.calendar_roles where host_account_id = ${context.actor.id}
    `;

    if (!roles) {
      throw new CommandError("invalid_input");
    }

    await ensureDraftForAnalysis(tx, context.actor.id);
    const analysisId = await publishAnalysis(tx, context.actor.id, roles.revision, `again-${context.correlationId}`);
    return { analysisId };
  },
};

// Set up manually: the host stops waiting for, or retrying, a scan.
export const setUpManuallyCommand: CommandDefinition<Record<string, never>, { analysisSkipped: true }> = {
  input: emptyInput as z.ZodType<Record<string, never>>,
  operation: "setup.set_up_manually",
  async run(tx, context) {
    await lockActiveHost(tx, context.actor.id);
    await lockDraft(tx, context.actor.id);
    await tx`
      insert into app.setup_drafts (host_account_id, analysis_skipped) values (${context.actor.id}, true)
      on conflict (host_account_id) do update set analysis_skipped = true, updated_at = now()
    `;
    return { analysisSkipped: true };
  },
};

// ---------------------------------------------------------------------------
// The job

export type CalendarAnalysisDependencies = {
  readonly tokenKeys: readonly TokenKey[];
  readonly config: GoogleCalendarConfig;
  readonly budgetMs?: number;
  // The note classifier (calendar-note-review design 2); without one, candidates
  // are listed without a recommendation.
  readonly classify?: NoteClassifierModel;
  // Puts each classifier call under the host's usage limit; limitNoteClassifier
  // by default.
  readonly limitClassifier?: (model: NoteClassifierModel, hostAccountId: string) => NoteClassifierModel;
};

function analysisDependenciesFromEnvironment(): CalendarAnalysisDependencies {
  return {
    classify: noteClassifierFromEnvironment(),
    config: googleCalendarConfigFromEnvironment(),
    tokenKeys: [tokenKeyFromEnvironment()],
  };
}

// The scan's note candidates with the classifier's recommendations. The call is
// apart from the host assistant and sees titles only as data; whatever it
// answers, a candidate stays busy until the host confirms it.
// A weekly check passes the verdicts its earlier list already gave (known), so
// only new or changed candidates go to the model again (proposal D10).
export async function withNoteRecommendations(
  evidence: AnalysisEvidence,
  classify: NoteClassifierModel | undefined,
  known: (entry: NoteCandidate) => NoteVerdict | null = () => null,
): Promise<AnalysisEvidence> {
  const entries = evidence.noteLike.entries;
  if (!classify || entries.length === 0) return evidence;
  const kept = entries.map((entry) => known(entry));
  const fresh = entries.filter((_, index) => kept[index] === null);
  const recommended = fresh.length ? await classifyNoteCandidates(fresh, classify, { timezone: evidence.timezone }) : [];
  let next = 0;
  return {
    ...evidence,
    noteLike: {
      entries: entries.map((entry, index) => {
        const verdict = kept[index];
        if (verdict) return { ...entry, reasons: null, verdict };
        const judged = recommended[next++]!;
        return { ...judged.candidate, reasons: judged.reasons, verdict: judged.verdict };
      }),
    },
  };
}

function failureCategory(error: unknown): CalendarAccessCategory {
  return error instanceof CalendarAccessError ? error.category : "calendar_unavailable";
}

// The zones the scan may count in, from the records setup proposes the timezone
// from: the draft's entry (and whether it is the browser's unaccepted starter
// default), then the confirmed settings.
async function recordedZones(tx: Transaction, hostAccountId: string) {
  const [row] = await tx<{ draft_starter: boolean | null; draft_zone: string | null; settings_zone: string | null }[]>`
    select
      (select settings ->> 'timezone' from app.host_settings where host_account_id = ${hostAccountId}) as settings_zone,
      (select fields -> 'timezone' ->> 'value' from app.setup_drafts where host_account_id = ${hostAccountId}) as draft_zone,
      (select fields -> 'timezone' ->> 'source' = 'starter_default' and not coalesce((fields -> 'timezone' ->> 'accepted')::boolean, false)
       from app.setup_drafts where host_account_id = ${hostAccountId}) as draft_starter
  `;
  const valid = (zone: string | null | undefined) => (zone && isValidTimeZone(zone) ? zone : null);

  return {
    chosen: row?.draft_starter ? null : valid(row?.draft_zone),
    settings: valid(row?.settings_zone),
    starter: row?.draft_starter ? valid(row?.draft_zone) : null,
  };
}

// The zone the scan counts in, matching the timezone setup will propose: a zone
// the host chose or stated, then the confirmed one, then the primary calendar's
// (which replaces an unaccepted browser starter default), then that starter.
export function countingZone(
  zones: { readonly chosen: string | null; readonly settings: string | null; readonly starter: string | null },
  primaryTimeZone: string | null,
) {
  return zones.chosen ?? zones.settings ?? primaryTimeZone ?? zones.starter ?? "UTC";
}

export async function queueHoursQuestion(tx: Transaction, hostAccountId: string, tokenKeys: readonly TokenKey[], evidence: AnalysisEvidence | null, analysisId: string) {
  if ((await readLatestAnalysis(tx, hostAccountId))?.id !== analysisId) return;
  const binding = await activeBindingOfHost(tx, hostAccountId);
  if (!binding || (await readReadiness(tx, hostAccountId)).ready) return;
  const [marked] = await tx<{ id: string }[]>`
    update app.imessage_bindings set hours_question_sent_at = now()
    where id = ${binding.id} and state = 'active' and hours_question_sent_at is null returning id
  `;
  if (!marked) return;
  const language = await hostConversationLanguage(tx, hostAccountId);
  await recordOutbound(tx, {
    kind: "notice", dedupeKey: `onboarding-hours:${binding.id}`, bindingId: binding.id, hostAccountId,
    recipient: bindingRecipient(tokenKeys, binding), recipientHash: binding.sender_hash, tokenKey: tokenKeys[0]!,
    text: channelReplies(language).onboarding.hoursQuestion(hoursSuggestion(evidence)),
  });
}

// Runs one scan. Provider failures are caught and recorded as a failed analysis
// (with any grant invalidation), and the handler returns normally, so the failure
// commits with the job instead of rolling back with a retried attempt. A failed
// read stores no evidence: free time is never inferred from a calendar that was
// not read.
export function createCalendarAnalysisHandler(
  load: () => CalendarAnalysisDependencies = analysisDependenciesFromEnvironment,
): JobHandler {
  const handler: JobHandler = async (tx: Transaction, job: ClaimedJob) => {
    const analysisId = typeof job.payload.analysisId === "string" ? job.payload.analysisId : null;
    const [analysis] = analysisId
      ? await tx<{
          calendars: { id: string; summary: string }[];
          host_account_id: string;
          range_end: Date;
          range_start: Date;
          state: AnalysisState;
        }[]>`
          select host_account_id, state, range_start, range_end, calendars
          from app.calendar_analyses
          where id = ${analysisId}
          for update
        `
      : [];

    if (!analysis || analysis.state !== "pending") {
      return { skipped: true };
    }

    const hostAccountId = analysis.host_account_id;
    const calendars = analysis.calendars.map((calendar) => ({ id: calendar.id, summary: calendar.summary }));
    const results: { id: string; summary: string; ok: boolean }[] = [];
    const events: CalendarEvent[] = [];
    let failure: CalendarAccessCategory | null = null;
    const zones = await recordedZones(tx, hostAccountId);
    let primaryTimeZone: string | null = null;

    try {
      const deps = load();
      // One budget bounds every Google request of the scan, the token exchange included.
      const budget = AbortSignal.timeout(deps.budgetMs ?? ANALYSIS_BUDGET_MS);
      const calendar = await openHostCalendar({ config: deps.config, db: tx, tokenKeys: deps.tokenKeys }, hostAccountId);

      try {
        const zone = (await calendar.listCalendars({ signal: budget })).primaryTimeZone;
        primaryTimeZone = zone && isValidTimeZone(zone) ? zone : null;
      } catch (error) {
        // Without the calendar list the scan still counts in a recorded zone or UTC,
        // unless the grant itself failed, which every read below would repeat.
        if (failureCategory(error) !== "calendar_unavailable") throw error;
      }

      for (const entry of calendars) {
        if (failure === "calendar_access_revoked" || failure === "calendar_not_connected") {
          results.push({ ...entry, ok: false });
          continue;
        }

        try {
          events.push(
            ...(await calendar.listEvents(
              entry.id,
              { end: analysis.range_end, start: analysis.range_start },
              { signal: budget },
            )),
          );
          results.push({ ...entry, ok: true });
        } catch (error) {
          // A grant failure outranks an unavailable read in what the card reports.
          const category = failureCategory(error);
          if (!failure || category !== "calendar_unavailable") failure = category;
          results.push({ ...entry, ok: false });
        }
      }
    } catch (error) {
      failure = failureCategory(error);
      for (const entry of calendars.slice(results.length)) results.push({ ...entry, ok: false });
    }

    if (failure) {
      await tx`
        update app.calendar_analyses
        set state = 'failed', calendars = ${tx.json(results)}, evidence = null,
            failure_category = ${failure}, completed_at = now()
        where id = ${analysisId}
      `;
      await queueHoursQuestion(tx, hostAccountId, load().tokenKeys, null, analysisId!);
      return { failureCategory: failure, state: "failed" };
    }

    const [identity] = await tx<{ email: string }[]>`
      select email from app.google_identities where host_account_id = ${hostAccountId}
    `;
    const counted = computeEvidence(events, {
      answers: await readNoteAnswers(tx, hostAccountId),
      calendars: results,
      hostEmail: identity?.email ?? "",
      primaryTimeZone,
      range: { end: analysis.range_end, start: analysis.range_start },
      now: new Date(),
      timezone: countingZone(zones, primaryTimeZone),
    });
    const { classify, limitClassifier = limitNoteClassifier } = load();
    const weeklyCheck = typeof job.payload.weeklyCheck === "string" ? job.payload.weeklyCheck : null;
    const evidence = await withNoteRecommendations(
      counted,
      classify && limitClassifier(classify, hostAccountId),
      weeklyCheck ? await knownWeeklyVerdicts(tx, hostAccountId) : undefined,
    );

    await tx`
      update app.calendar_analyses
      set state = 'completed', calendars = ${tx.json(results)},
          evidence = ${tx.json(evidence as unknown as Parameters<typeof tx.json>[0])},
          failure_category = null, completed_at = now()
      where id = ${analysisId}
    `;
    await queueHoursQuestion(tx, hostAccountId, load().tokenKeys, evidence, analysisId!);
    if (weeklyCheck) await publishWeeklyNoteReview(tx, { analysisId: analysisId!, hostAccountId, week: weeklyCheck });
    return { state: "completed" };
  };

  // A job that spent its attempts on unexpected errors leaves its scan failed, so
  // the card offers Analyze again instead of waiting forever.
  handler.onExhausted = async (tx, job) => {
    const analysisId = typeof job.payload.analysisId === "string" ? job.payload.analysisId : null;
    if (!analysisId) return;

    const failed = await tx<{ host_account_id: string }[]>`
      update app.calendar_analyses
      set state = 'failed', failure_category = ${ANALYSIS_FAILED}, evidence = null, completed_at = now()
      where id = ${analysisId} and state = 'pending'
      returning host_account_id
    `;
    if (failed[0]) await queueHoursQuestion(tx, failed[0].host_account_id, load().tokenKeys, null, analysisId);
  };

  return handler;
}

// ---------------------------------------------------------------------------
// Projections

export async function readLatestAnalysis(db: Queryable, hostAccountId: string): Promise<AnalysisCard | null> {
  const [row] = await db<{
    calendars: ScannedCalendar[];
    completed_at: Date | null;
    created_at: Date;
    evidence: AnalysisEvidence | null;
    failure_category: string | null;
    id: string;
    range_end: Date;
    range_start: Date;
    state: AnalysisState;
  }[]>`
    select id, range_start, range_end, calendars, evidence, created_at, completed_at,
           case when stale then 'failed' else state end as state,
           case when stale then ${ANALYSIS_FAILED} else failure_category end as failure_category
    from (
      select *, state = 'pending' and created_at < now() - make_interval(mins => ${ANALYSIS_STALE_AFTER_MINUTES}) as stale
      from app.calendar_analyses
      where host_account_id = ${hostAccountId}
      order by created_at desc, id
      limit 1
    ) latest
  `;

  if (!row) return null;

  return {
    calendars: row.calendars.map((calendar) => ({ id: calendar.id, ok: calendar.ok ?? null, summary: calendar.summary })),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    evidence: row.evidence,
    failureCategory: row.failure_category,
    id: row.id,
    range: { end: row.range_end.toISOString(), start: row.range_start.toISOString() },
    state: row.state,
  };
}

// What the setup tools give the model: no titles, no event or calendar IDs, only
// the number of note-like entries, and no place names. Places and calendar names
// come from event and calendar text other people can write, so they could carry
// instructions; the place sample size is enough for the model to mention the
// location card's hint.
export function analysisForModel(card: AnalysisCard): AnalysisForModel {
  const evidence = card.evidence;

  return {
    // Quoted data: a calendar name is text the calendar's owner chose.
    calendars: card.calendars.map((calendar) => ({ name: encodeDisplayName(calendar.summary), ok: calendar.ok })),
    evidence: evidence
      ? {
          durations: evidence.durations,
          meetingLoad: evidence.meetingLoad,
          noteLikeCount: evidence.noteLike.entries.length,
          places: { sampleSize: evidence.places.sampleSize },
          preferredTimes: evidence.preferredTimes,
          timezone: evidence.timezone,
        }
      : null,
    failureCategory: card.failureCategory,
    range: card.range,
    state: card.state,
  };
}
