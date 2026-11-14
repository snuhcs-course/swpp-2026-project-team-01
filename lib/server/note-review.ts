import { z } from "zod";
import type { AnalysisCard } from "../contracts/analysis";
import type { NoteReview, NoteReviewChoice, NoteReviewDecision, NoteReviewItem, NoteWeek, NoteWeekEvent } from "../contracts/note-review";
import type { RequestLanguage } from "../contracts/request";
import type { CalendarRef } from "../contracts/setup";
import { lockActiveHost, readLatestAnalysis } from "./analysis";
import { isWritable } from "./calendar-roles";
import { hostConversationLanguage } from "./channel-language";
import { json } from "./chat-routes";
import { type CommandDefinition, CommandError, type CommandOutcome, runCommand } from "./commands";
import type { Queryable } from "./database";
import { startOfLocalDay } from "./feasibility";
import { type CalendarEvent, type GoogleCalendarDependencies, openHostCalendar } from "./google-calendar";
import { noteAnswerMatcher } from "./note-answers";
import {
  type NoteDecisionItem,
  readNoteDecisions,
  recordNoteDecisions,
  type RecordedNoteDecision,
  retryNoteWritebackCommand,
} from "./note-decisions";
import { queueSlotImageAfterReview, slotImageWaits } from "./onboarding-note-step";
import { crossSiteRefusal } from "./same-origin";
import { COMMAND_STATUS, eligibleHost, setupRouteDependenciesFromEnvironment, type SetupRouteDependencies } from "./setup-routes";

// The note review (calendar-note-review design 7): the candidates of the latest
// scan with the classifier's recommendations, a recurring series as one item
// with its occurrences ahead, the host's earlier decisions with their writeback
// state, and the week the page draws: the host's other busy entries of that
// week, read live from Google for context and kept nowhere. One builder serves the web setup's notes step and the /app/notes page;
// the chat onboarding link, the weekly check and settings open the same page.
// Confirming names the scan and the item keys the review showed, and the server
// rebuilds the review to turn them into decisions, so the browser can decide
// nothing it was not shown.

type Entry = NonNullable<AnalysisCard["evidence"]>["noteLike"]["entries"][number];

// What a review item stands for, kept on the server.
type Source = {
  readonly calendarId: string;
  readonly eventId: string;
  readonly seriesId: string | null;
  readonly fingerprint: string;
  // The latest updated time of the series' listed occurrences.
  readonly seriesFingerprint: string;
  readonly end: string | null;
  // Every listed occurrence by its event ID, for a "this time only" choice.
  readonly occurrences: ReadonlyMap<string, { readonly fingerprint: string; readonly end: string | null }>;
  // The host's standing answer about the item, when there is one.
  readonly decision: { readonly decision: "free" | "keep_busy"; readonly fingerprint: string } | null;
};

type DecisionView = Awaited<ReturnType<typeof readNoteDecisions>>[number];

function instant(value: string) {
  const at = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isNaN(at) ? 0 : at;
}

function later(a: string, b: string) {
  return instant(b) > instant(a) ? b : a;
}

function groupKey(calendarId: string, eventId: string, seriesId: string | null) {
  return seriesId ? `series\u0000${calendarId}\u0000${seriesId}` : `event\u0000${calendarId}\u0000${eventId}`;
}

// The review of the latest scan's candidates on the conflict calendars. A
// subscribed or read-only calendar's notes are offered too: freeing one changes
// only Find Me a Time (design 6). An entry the host already answered stays in
// the review with that answer, so the host can go back and change it.
export function buildNoteReview(input: {
  readonly analysis: AnalysisCard | null;
  readonly calendars: readonly CalendarRef[];
  readonly decisions: readonly DecisionView[];
  readonly now: Date;
  // The language the reason is shown in; English by default.
  readonly language?: RequestLanguage;
}): { review: NoteReview; sources: ReadonlyMap<string, Source> } {
  const { analysis, calendars, decisions, now } = input;
  const language = input.language ?? "en";
  const named = new Map(calendars.map((calendar) => [calendar.id, calendar]));
  const entries = analysis?.state === "completed" ? (analysis.evidence?.noteLike.entries ?? []) : [];
  const groups = new Map<string, Entry[]>();
  // Answers by the item they decide, matched while the entry was not edited after.
  const answers = new Map(decisions.map((decision) => [groupKey(decision.calendarId, decision.eventId, decision.scope === "series" ? decision.eventId : null), decision]));
  const answerOf = (entry: Entry) => {
    const decision = answers.get(groupKey(entry.calendarId, entry.eventId, entry.seriesId ?? null));
    if (!decision) return null;
    const matches = noteAnswerMatcher([decision]);
    return matches({ calendarId: entry.calendarId, id: entry.eventId, recurringEventId: entry.seriesId ?? null, updated: entry.fingerprint }) ? decision : null;
  };

  for (const entry of entries) {
    if (!named.has(entry.calendarId)) continue;
    const key = groupKey(entry.calendarId, entry.eventId, entry.seriesId ?? null);
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }

  const sources = new Map<string, Source>();
  const items: NoteReviewItem[] = [];

  for (const [key, group] of groups) {
    const ordered = [...group].sort((a, b) => instant(a.start) - instant(b.start));
    // The next occurrence, or the last one when all have passed.
    const shown = ordered.find((entry) => instant(entry.end ?? entry.start) > now.getTime()) ?? ordered.at(-1)!;
    const calendar = named.get(shown.calendarId)!;
    const answer = answerOf(shown);
    sources.set(key, {
      calendarId: shown.calendarId,
      decision: answer ? { decision: answer.decision, fingerprint: answer.fingerprint } : null,
      end: shown.end ?? null,
      eventId: shown.eventId,
      fingerprint: shown.fingerprint,
      occurrences: new Map(ordered.map((entry) => [entry.eventId, { end: entry.end ?? null, fingerprint: entry.fingerprint }])),
      seriesFingerprint: group.reduce((latest, entry) => later(latest, entry.fingerprint), shown.fingerprint),
      seriesId: shown.seriesId ?? null,
    });
    items.push({
      allDay: shown.allDay,
      calendarName: calendar.summary,
      decision: answer?.decision ?? null,
      end: shown.end ?? null,
      key,
      occurrences: ordered.map((entry) => ({ allDay: entry.allDay, end: entry.end ?? null, id: entry.eventId, start: entry.start })),
      reason: (shown.reasons ? shown.reasons[language] : shown.reason) || null,
      repeats: Boolean(shown.seriesId),
      start: shown.start,
      title: shown.title,
      verdict: shown.verdict ?? null,
      writable: isWritable(calendar),
    });
  }

  items.sort((a, b) => instant(a.start) - instant(b.start));

  // A decision's title and time come from the scan's entry (the next one ahead
  // of a series), so a decision stores neither.
  const entryOf = (decision: DecisionView) => {
    const matching = entries
      .filter((entry) => entry.calendarId === decision.calendarId && (decision.scope === "series" ? entry.seriesId === decision.eventId : entry.eventId === decision.eventId))
      .sort((a, b) => instant(a.start) - instant(b.start));
    return matching.find((entry) => instant(entry.end ?? entry.start) > now.getTime()) ?? matching.at(-1) ?? null;
  };
  const decided: NoteReviewDecision[] = decisions.map((decision) => {
    const entry = entryOf(decision);
    return {
      allDay: entry?.allDay ?? false,
      calendarName: named.get(decision.calendarId)?.summary ?? decision.calendarId,
      decision: decision.decision,
      end: entry?.end ?? null,
      id: decision.id,
      scope: decision.scope,
      start: entry?.start ?? null,
      title: entry?.title ?? null,
      updatedAt: decision.updatedAt,
      writebackFailure: decision.writebackFailure,
      writebackState: decision.writebackState,
    };
  });

  const state = !analysis || analysis.state === "failed" ? "unavailable" : analysis.state === "pending" ? "pending" : "ready";
  return { review: { analysisId: analysis?.id ?? null, decisions: decided, items, slotImageWaits: false, state, week: null }, sources };
}

// ---------------------------------------------------------------------------
// The week

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

function localDate(instant: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone, year: "numeric" }).format(instant);
}

function mondayOf(date: string) {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -weekday);
}

// Which week to draw: the requested one, moved to its Monday and kept between the
// week of today and the week the scan's range ahead ends in.
export function weekBounds(requested: string | null, timeZone: string, now: Date, rangeEnd: Date) {
  const first = mondayOf(localDate(now, timeZone));
  const last = mondayOf(localDate(new Date(rangeEnd.getTime() - 1), timeZone));
  const wanted = requested && DATE.test(requested) ? mondayOf(requested) : first;
  const start = wanted < first ? first : wanted > last ? last : wanted;
  return {
    next: start < last ? addDays(start, 7) : null,
    previous: start > first ? addDays(start, -7) : null,
    start,
    today: localDate(now, timeZone),
  };
}

function isDeclined(event: CalendarEvent, hostEmail: string | null) {
  return event.attendees.some((attendee) => (attendee.self || attendee.email.toLowerCase() === hostEmail) && attendee.responseStatus === "declined");
}

// The week the page draws. Candidates come from the scan; the other busy
// entries are read now from the conflict calendars, for context only: a
// cancelled, declined or transparent entry is not drawn, a candidate is not
// drawn twice, and copies on several calendars appear once. Nothing read here is
// stored, and no attendee leaves this function.
export async function readNoteWeek(
  calendarDeps: GoogleCalendarDependencies,
  hostAccountId: string,
  input: {
    readonly requested: string | null;
    readonly analysis: AnalysisCard;
    readonly calendars: readonly CalendarRef[];
    readonly sources: ReadonlyMap<string, Source>;
    readonly now: Date;
  },
): Promise<NoteWeek> {
  const timezone = input.analysis.evidence?.timezone ?? "UTC";
  const bounds = weekBounds(input.requested, timezone, input.now, new Date(input.analysis.range.end));
  const range = { end: new Date(startOfLocalDay(addDays(bounds.start, 7), timezone)), start: new Date(startOfLocalDay(bounds.start, timezone)) };
  const candidates = new Set<string>();
  for (const source of input.sources.values()) {
    for (const id of source.occurrences.keys()) candidates.add(`${source.calendarId}\u0000${id}`);
    if (source.seriesId) candidates.add(`${source.calendarId}\u0000${source.seriesId}`);
  }

  const events: NoteWeekEvent[] = [];
  let contextUnavailable = false;
  try {
    const [identity] = await calendarDeps.db<{ email: string }[]>`
      select email from app.google_identities where host_account_id = ${hostAccountId}
    `;
    const hostEmail = identity?.email.toLowerCase() ?? null;
    const calendar = await openHostCalendar(calendarDeps, hostAccountId);
    const seen = new Set<string>();
    for (const entry of input.calendars) {
      for (const event of await calendar.listEvents(entry.id, range)) {
        if (event.status === "cancelled" || event.transparency === "transparent" || isDeclined(event, hostEmail)) continue;
        if (candidates.has(`${event.calendarId}\u0000${event.id}`)) continue;
        if (event.recurringEventId && candidates.has(`${event.calendarId}\u0000${event.recurringEventId}`)) continue;
        const start = event.start.dateTime ?? event.start.date;
        const end = event.end.dateTime ?? event.end.date;
        if (!start || !end) continue;
        const copy = `${event.iCalUID ?? event.id}|${start}`;
        if (seen.has(copy)) continue;
        seen.add(copy);
        events.push({ allDay: !event.start.dateTime, end, id: `${events.length}`, start, title: event.summary?.trim() ?? "" });
      }
    }
  } catch {
    contextUnavailable = true;
    events.length = 0;
  }

  return { ...bounds, contextUnavailable, events, timezone };
}

async function reviewInputs(db: Queryable, hostAccountId: string) {
  const [roles] = await db<{ conflict_calendars: CalendarRef[] }[]>`
    select conflict_calendars from app.calendar_roles where host_account_id = ${hostAccountId}
  `;
  return {
    analysis: await readLatestAnalysis(db, hostAccountId),
    calendars: roles?.conflict_calendars ?? [],
    decisions: await readNoteDecisions(db, hostAccountId),
  };
}

export async function readNoteReview(db: Queryable, hostAccountId: string, now = new Date(), language?: RequestLanguage): Promise<NoteReview> {
  return buildNoteReview({ ...(await reviewInputs(db, hostAccountId)), language, now }).review;
}

// The language the review shows the reasons in: the screen's, from the
// language cookie the web app sets, else the host's conversation, by the rule
// the linked conversation's fixed replies follow.
export async function reviewLanguage(request: Request, db: Queryable, hostAccountId: string): Promise<RequestLanguage> {
  const cookie = /(?:^|;\s*)lang=(en|ko)(?:;|$)/.exec(request.headers.get("cookie") ?? "");
  return (cookie?.[1] as RequestLanguage | undefined) ?? (await hostConversationLanguage(db, hostAccountId));
}

const choiceSchema = z
  .object({
    key: z.string().min(1).max(2100),
    decision: z.enum(["free", "keep_busy"]),
    scope: z.enum(["series", "occurrence"]).optional(),
    occurrence: z.string().min(1).max(1024).optional(),
  })
  .strict();

type ConfirmInput = { readonly analysisId: string; readonly choices: readonly NoteReviewChoice[] };

// Pressing 확인 on the review: ticked items free, the others shown kept busy. A
// review of an older scan, or a key the current review does not show, changes
// nothing.
// When the host's chat onboarding is waiting for the slot image (design 8), the
// same transaction publishes the job that sends it, with the confirmed notes no
// longer busy, even when no answer changed; slotImage says it follows.
export const confirmNoteReviewCommand: CommandDefinition<ConfirmInput, { decisions: RecordedNoteDecision[]; slotImage: boolean }> = {
  input: z.object({ analysisId: z.string().uuid(), choices: z.array(choiceSchema).max(100) }).strict() as z.ZodType<ConfirmInput>,
  operation: "notes.confirm_review",
  async run(tx, context) {
    await lockActiveHost(tx, context.actor.id);
    const { review, sources } = buildNoteReview({ ...(await reviewInputs(tx, context.actor.id)), now: new Date() });
    if (review.analysisId !== context.input.analysisId) throw new CommandError("stale_revision");

    const items: NoteDecisionItem[] = context.input.choices.flatMap((choice) => {
      const source = sources.get(choice.key);
      if (!source) throw new CommandError("stale_revision");
      // An answer the host left as it was changes nothing.
      if (source.decision?.decision === choice.decision) return [];
      const scope = source.seriesId ? (choice.scope ?? "series") : "occurrence";
      // "This time only" names one of the occurrences the review listed.
      const eventId = scope === "occurrence" && choice.occurrence ? choice.occurrence : source.eventId;
      const occurrence = source.occurrences.get(eventId);
      if (!occurrence) throw new CommandError("stale_revision");
      return [{
        calendarId: source.calendarId,
        decision: choice.decision,
        end: occurrence.end,
        eventId,
        // A changed answer keeps the later of the scan's and the answer's
        // fingerprints, so our own writeback does not make it look edited.
        fingerprint: later(scope === "series" ? source.seriesFingerprint : occurrence.fingerprint, source.decision?.fingerprint ?? ""),
        scope,
        seriesId: source.seriesId,
      }];
    });

    const decisions = await recordNoteDecisions(tx, context.actor.id, items);
    return { decisions, slotImage: await queueSlotImageAfterReview(tx, context.actor.id) };
  },
};

// ---------------------------------------------------------------------------
// Routes

// GET /api/notes/review[?week=YYYY-MM-DD]: the review, with the requested week
// (the week of today by default) once a scan is ready.
export function createNoteReviewHandler(load: () => SetupRouteDependencies = setupRouteDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const actor = await eligibleHost(request, deps);
    if (actor instanceof Response) return actor;
    const inputs = await reviewInputs(deps.db, actor.id);
    const now = new Date();
    const built = buildNoteReview({ ...inputs, language: await reviewLanguage(request, deps.db, actor.id), now });
    const sources = built.sources;
    const review = { ...built.review, slotImageWaits: await slotImageWaits(deps.db, actor.id) };
    if (review.state !== "ready" || !inputs.analysis) return json(review);
    const week = await readNoteWeek(deps.calendar, actor.id, {
      analysis: inputs.analysis,
      calendars: inputs.calendars,
      now,
      requested: new URL(request.url).searchParams.get("week"),
      sources,
    });
    return json({ ...review, week });
  };
}

const commandBody = z.object({
  operation: z.enum(["notes.confirm_review", "notes.retry_writeback"]),
  retryKey: z.string().min(1).max(200),
  input: z.unknown(),
});

// POST /api/notes/commands { operation, retryKey, input }
export function createNoteCommandHandler(load: () => SetupRouteDependencies = setupRouteDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const refused = crossSiteRefusal(request, deps, { json: true });
    if (refused) return refused;
    const actor = await eligibleHost(request, deps);
    if (actor instanceof Response) return actor;
    const body = commandBody.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ code: "invalid_request", error: "Send an operation, a retry key and its input." }, 400);

    const run = <Input, Result>(command: CommandDefinition<Input, Result>) =>
      runCommand({ authenticate: async () => actor, db: deps.db }, command, {
        input: body.data.input,
        resourceId: actor.id,
        retryKey: body.data.retryKey,
      });
    const outcome: CommandOutcome<unknown> =
      body.data.operation === "notes.confirm_review" ? await run(confirmNoteReviewCommand) : await run(retryNoteWritebackCommand);

    return outcome.ok ? json(outcome) : json(outcome, COMMAND_STATUS[outcome.error.category]);
  };
}
