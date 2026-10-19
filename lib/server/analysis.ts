import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AnalysisCard, AnalysisEvidence, AnalysisForModel, AnalysisState, PlaceHint, ScannedCalendar } from "../contracts/analysis";
import {
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
import { HostIneligibleError } from "./host-eligibility";
import { type ClaimedJob, type JobHandler, publishJob } from "./jobs";
import { type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// Calendar analysis (design decision 8). Saving roles, or Analyze again, publishes
// a calendar_analysis job beside a pending app.calendar_analyses row. The job
// reads the saved conflict calendars over the four weeks before and after the
// scan and stores evidence under iteration 1's F02 rules, or records which
// calendar failed. Evidence only ever feeds labeled suggestions; it expires after
// 24 hours (app.cleanup_calendar_analyses).

export const CALENDAR_ANALYSIS_JOB = "calendar_analysis";

const RANGE_DAYS = 28;
// The overall read budget, inside the job's 120-second lease.
const ANALYSIS_BUDGET_MS = 30_000;
const MAX_NOTE_ENTRIES = 100;

// ---------------------------------------------------------------------------
// Evidence

type EvidenceContext = {
  readonly timezone: string;
  readonly hostEmail: string;
  readonly calendars: readonly { readonly id: string; readonly summary: string; readonly ok: boolean }[];
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

// The Monday that starts the week of a local date.
function weekStart(date: string, weekday: Weekday) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! - WEEKDAYS.indexOf(weekday))).toISOString().slice(0, 10);
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
//   not decline; all-day events are never meetings;
// - it is internal when every such attendee shares the host's email domain;
// - note-like entries (timed or all-day) have no other attendee, no location and
//   no link, and stay busy;
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
  const cells = new Map<string, { weekday: Weekday; hour: number; count: number }>();
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

    if (others.length === 0 && !event.location && !event.hasConferenceLink && notes.length < MAX_NOTE_ENTRIES) {
      notes.push({
        allDay: !timed,
        calendarId: event.calendarId,
        eventId: event.id,
        fingerprint: event.updated ?? "",
        start: event.start.dateTime ?? event.start.date ?? "",
        title: event.summary?.trim() || "(No title)",
      });
    }

    if (!timed) continue;

    const start = new Date(event.start.dateTime!);
    const end = new Date(event.end.dateTime!);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

    if (event.location && !event.hasConferenceLink) {
      const [venue, area] = event.location.split(",").map((part) => part.trim());
      placeSample += 1;
      if (venue) tally(venues, venue);
      if (area) tally(areas, area);
    }

    const present = others.filter((attendee) => attendee.responseStatus !== "declined");
    if (present.length === 0) continue;

    meetings += 1;
    const local = localTime(formatter, start);
    const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
    const hour = Math.floor(local.minute / 60);
    const cellKey = `${local.weekday}:${hour}`;
    const cell = cells.get(cellKey);

    if (cell) cell.count += 1;
    else cells.set(cellKey, { count: 1, hour, weekday: local.weekday });

    const span = spans.get(local.weekday);
    const endMinute = local.minute + minutes;

    if (span) {
      span.startMinute = Math.min(span.startMinute, local.minute);
      span.endMinute = Math.max(span.endMinute, endMinute);
    } else {
      spans.set(local.weekday, { endMinute, startMinute: local.minute });
    }

    const week = weekStart(local.date, local.weekday);
    const load = weeks.get(week) ?? { external: 0, internal: 0 };
    const internal = present.every((attendee) => emailDomain(attendee.email) === hostDomain);

    if (internal) load.internal += 1;
    else load.external += 1;
    weeks.set(week, load);
    durations.push(minutes);
  }

  const weekList = [...weeks]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([weekStartDate, load]) => ({ external: load.external, internal: load.internal, weekStart: weekStartDate }));
  const totals = weekList.map((week) => week.internal + week.external);

  return {
    durations: { medianMinutes: median(durations), sampleSize: durations.length },
    meetingLoad: {
      max: totals.length ? Math.max(...totals) : 0,
      min: totals.length ? Math.min(...totals) : 0,
      sampleSize: meetings,
      weeks: weekList,
    },
    noteLike: { entries: notes },
    places: { area: top(areas), sampleSize: placeSample, venue: top(venues) },
    preferredTimes: {
      cells: [...cells.values()].sort(
        (a, b) => WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) || a.hour - b.hour,
      ),
      sampleSize: meetings,
      spans: WEEKDAYS.flatMap((weekday) => {
        const span = spans.get(weekday);
        return span ? [{ endMinute: span.endMinute, startMinute: span.startMinute, weekday }] : [];
      }),
    },
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
// the hour after the latest end. An end at or past midnight is written as 00:00,
// which the windows contract reads as the next day.
function windowsFromSpans(spans: AnalysisEvidence["preferredTimes"]["spans"]): WeeklyWindow[] {
  return spans.map((span) => {
    const startHour = Math.floor(span.startMinute / 60);
    const endHour = Math.max(Math.ceil(span.endMinute / 60), startHour + 1);
    const end = endHour < 24 ? clock(endHour) : startHour === 0 ? "23:59" : "00:00";
    return { end, start: clock(startHour), weekday: span.weekday };
  });
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

  suggestions.weeklyWindows =
    enough && evidence.preferredTimes.spans.length > 0
      ? {
          reason: `From ${meetings} meetings: one window per weekday, spanning the hours you met.`,
          sampleSize: meetings,
          source: "inferred",
          value: windowsFromSpans(evidence.preferredTimes.spans),
        }
      : { reason: tooFew(meetings), sampleSize: meetings, source: "starter_default", value: STARTER_DEFAULTS.weeklyWindows };

  const load = evidence.meetingLoad;
  suggestions.weeklyLimit =
    load.sampleSize >= MIN_INFERENCE_SAMPLE && load.weeks.length >= 2
      ? {
          reason: `Your busiest week in the scan had ${load.max} meetings.`,
          sampleSize: load.sampleSize,
          source: "inferred",
          value: Math.min(50, Math.max(1, load.max)),
        }
      : {
          reason: "Too few meetings or weeks in the scan to infer a limit, so there is no limit unless you set one.",
          sampleSize: load.sampleSize,
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

// Inserts a pending scan of the saved conflict calendars and publishes its job in
// the caller's transaction. One scan per (host, key): publishing the same key again
// returns the scan already published.
export async function publishAnalysis(tx: Transaction, hostAccountId: string, rolesRevision: number, key: string) {
  const analysisId = randomUUID();
  const jobId = await publishJob(tx, {
    dedupeKey: `${CALENDAR_ANALYSIS_JOB}:${hostAccountId}:${key}`,
    kind: CALENDAR_ANALYSIS_JOB,
    payload: { analysisId },
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
           now() - make_interval(days => ${RANGE_DAYS}), now() + make_interval(days => ${RANGE_DAYS}),
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

// Creates the host's draft row when missing and clears a manual-setup choice,
// because a new scan is wanted. The draft revision is unchanged: no value moved.
export async function ensureDraftForAnalysis(tx: Transaction, hostAccountId: string) {
  await tx`
    insert into app.setup_drafts (host_account_id) values (${hostAccountId})
    on conflict (host_account_id) do update set analysis_skipped = false, updated_at = now()
    where app.setup_drafts.analysis_skipped
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
    await tx`select pg_advisory_xact_lock(hashtextextended(${`app.calendar_roles:${context.actor.id}`}, 0))`;

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
};

function analysisDependenciesFromEnvironment(): CalendarAnalysisDependencies {
  return { config: googleCalendarConfigFromEnvironment(), tokenKeys: [tokenKeyFromEnvironment()] };
}

function failureCategory(error: unknown): CalendarAccessCategory {
  return error instanceof CalendarAccessError ? error.category : "calendar_unavailable";
}

async function analysisTimezone(tx: Transaction, hostAccountId: string) {
  const [row] = await tx<{ settings_zone: string | null; draft_zone: string | null }[]>`
    select
      (select settings ->> 'timezone' from app.host_settings where host_account_id = ${hostAccountId}) as settings_zone,
      (select fields -> 'timezone' ->> 'value' from app.setup_drafts where host_account_id = ${hostAccountId}) as draft_zone
  `;

  return [row?.settings_zone, row?.draft_zone].find((zone): zone is string => !!zone && isValidTimeZone(zone)) ?? null;
}

// Runs one scan. Provider failures are caught and recorded as a failed analysis
// (with any grant invalidation), and the handler returns normally, so the failure
// commits with the job instead of rolling back with a retried attempt. A failed
// read stores no evidence: free time is never inferred from a calendar that was
// not read.
export function createCalendarAnalysisHandler(
  load: () => CalendarAnalysisDependencies = analysisDependenciesFromEnvironment,
): JobHandler {
  return async (tx: Transaction, job: ClaimedJob) => {
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
    let timezone = await analysisTimezone(tx, hostAccountId);

    try {
      const deps = load();
      const budget = AbortSignal.timeout(deps.budgetMs ?? ANALYSIS_BUDGET_MS);
      const calendar = await openHostCalendar({ config: deps.config, db: tx, tokenKeys: deps.tokenKeys }, hostAccountId);

      if (!timezone) {
        try {
          const zone = (await calendar.listCalendars()).primaryTimeZone;
          timezone = zone && isValidTimeZone(zone) ? zone : null;
        } catch (error) {
          // Without the calendar list the scan still counts in UTC, unless the
          // grant itself failed, which every read below would repeat.
          if (failureCategory(error) !== "calendar_unavailable") throw error;
        }
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
      return { failureCategory: failure, state: "failed" };
    }

    const [identity] = await tx<{ email: string }[]>`
      select email from app.google_identities where host_account_id = ${hostAccountId}
    `;
    const evidence = computeEvidence(events, {
      calendars: results,
      hostEmail: identity?.email ?? "",
      timezone: timezone ?? "UTC",
    });

    await tx`
      update app.calendar_analyses
      set state = 'completed', calendars = ${tx.json(results)},
          evidence = ${tx.json(evidence as unknown as Parameters<typeof tx.json>[0])},
          failure_category = null, completed_at = now()
      where id = ${analysisId}
    `;
    return { state: "completed" };
  };
}

// ---------------------------------------------------------------------------
// Projections

export async function readLatestAnalysis(db: Queryable, hostAccountId: string): Promise<AnalysisCard | null> {
  const [row] = await db<{
    calendars: ScannedCalendar[];
    created_at: Date;
    evidence: AnalysisEvidence | null;
    failure_category: string | null;
    id: string;
    range_end: Date;
    range_start: Date;
    state: AnalysisState;
  }[]>`
    select id, state, range_start, range_end, calendars, evidence, failure_category, created_at
    from app.calendar_analyses
    where host_account_id = ${hostAccountId}
    order by created_at desc, id
    limit 1
  `;

  if (!row) return null;

  return {
    calendars: row.calendars.map((calendar) => ({ id: calendar.id, ok: calendar.ok ?? null, summary: calendar.summary })),
    createdAt: row.created_at.toISOString(),
    evidence: row.evidence,
    failureCategory: row.failure_category,
    id: row.id,
    range: { end: row.range_end.toISOString(), start: row.range_start.toISOString() },
    state: row.state,
  };
}

// What the setup tools give the model: no titles, no event or calendar IDs, and
// only the number of note-like entries.
export function analysisForModel(card: AnalysisCard): AnalysisForModel {
  const evidence = card.evidence;

  return {
    calendars: card.calendars.map((calendar) => ({ ok: calendar.ok, summary: calendar.summary })),
    evidence: evidence
      ? {
          durations: evidence.durations,
          meetingLoad: evidence.meetingLoad,
          noteLikeCount: evidence.noteLike.entries.length,
          places: evidence.places,
          preferredTimes: evidence.preferredTimes,
          timezone: evidence.timezone,
        }
      : null,
    failureCategory: card.failureCategory,
    range: card.range,
    state: card.state,
  };
}
