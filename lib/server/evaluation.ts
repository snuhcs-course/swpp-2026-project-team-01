import { randomUUID } from "node:crypto";
import { generateText, type LanguageModel } from "ai";
import type { NearestOpenTimes, RequesterEvaluationFailure, RequesterEvaluationView } from "../contracts/feasibility";
import type { EvaluationState, RequestDetails } from "../contracts/request";
import { type ConfirmedSettings, groupTripsOf, isValidTimeZone, WEEKDAYS, weeklyLimitCountsOf } from "../contracts/setup";
import { CommandError } from "./commands";
import { database, type Database, type Transaction } from "./database";
import {
  addDays,
  applyRanking,
  type BusyInterval,
  displayTime,
  type EvaluatedCandidate,
  evaluateFeasibility,
  type Exclusion,
  type FeasibilityInput,
  type FeasibilityResult,
  type LegQuery,
  legQueryKey,
  localParts,
  normalizeBusy,
  requesterProjection,
  type RequesterPreferences,
  resolveMeetingMode,
  startOfLocalDay,
  type TravelAllowance,
  travelQueries,
  tripQueries,
} from "./feasibility";
import {
  CalendarAccessError,
  type CalendarEvent,
  type GoogleCalendarConfig,
  googleCalendarConfigFromEnvironment,
  openHostCalendar,
} from "./google-calendar";
import { type ClaimedJob, type JobHandler, publishJob } from "./jobs";
import { markNegotiating } from "./request-lifecycle";
import type { NoticeDependencies } from "./booking-notices";
import { enqueueHostNotice } from "./imessage-notices";
import { settleSharedChange } from "./shared-change-settle";
import { rankingModelChoice } from "./model-choice";
import { limitModel, type ModelLimits, type Principal } from "./model-limits";
import {
  readRequesterCalendarGrant,
  readRequesterEvents,
  requesterCalendarConfigFromEnvironment,
} from "./requester-calendar";
import { dropGuestHostCalendars, type GuestHostSource, readGuestHostSource } from "./requester-host-profiles";
import { endpointHasher, estimateTravel, type RouteEstimate, type RoutesConfig, routesConfigFromEnvironment } from "./routes-client";
import { type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// Evaluation runs as an application job (design decision 8). evaluate_candidates
// and the Find times action publish an `evaluation` job beside a pending
// app.evaluations row at the request's and settings' current revisions, and wait
// for the row to leave pending. The job shares one AbortController and one
// deadline, 18 seconds after it starts work, across the host grant refresh, host
// and requester events.list, Routes and ranking; pagination, extra calendars and
// the second party never reset it, and a provider that ignores cancellation is
// abandoned at the deadline. The result is published only under the request lock
// with both revisions unchanged and the deadline not passed; otherwise the
// evaluation is incomplete and publishes nothing. Provider failures are recorded
// on the evaluation and the job completes, so a failure is never retried into
// free time.

export const EVALUATION_JOB = "evaluation";
export const EVALUATION_DEADLINE_MS = 18_000;
// The valid candidates the model may reorder.
export const RANKING_LIMIT = 20;
const AWAIT_POLL_MS = 250;

export type EvaluationAudience = "requester" | "host";

// Host-private failure categories on app.evaluations.failure_category.
export type EvaluationFailureCategory =
  | "deadline"
  | "revision_changed"
  | "request_closed"
  | "host_unavailable"
  | "needs_details"
  | "requester_calendar_unavailable"
  | "calendar_not_connected"
  | "calendar_access_revoked"
  | "calendar_unavailable"
  | "evaluation_failed";

// ---------------------------------------------------------------------------
// The shared deadline

export class EvaluationDeadlineError extends Error {
  constructor() {
    super("The evaluation deadline passed.");
    this.name = "EvaluationDeadlineError";
  }
}

export type EvaluationDeadline = {
  readonly at: Date;
  readonly signal: AbortSignal;
  // Whether the deadline has passed; passing it also cancels the signal.
  passed(): boolean;
  // Starts provider work only before the deadline, and stops waiting for it at
  // the deadline even when the work ignores the signal.
  run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T>;
  clear(): void;
};

export function startDeadline(ms: number, now: () => number = Date.now): EvaluationDeadline {
  const controller = new AbortController();
  const error = new EvaluationDeadlineError();
  const at = now() + ms;
  const timer = setTimeout(() => controller.abort(error), ms);
  const expired = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(error), { once: true });
  });
  expired.catch(() => {});

  const passed = () => {
    if (!controller.signal.aborted && now() >= at) controller.abort(error);
    return controller.signal.aborted;
  };

  return {
    at: new Date(at),
    clear: () => clearTimeout(timer),
    passed,
    async run(work) {
      if (passed()) throw error;
      try {
        return await Promise.race([work(controller.signal), expired]);
      } catch (cause) {
        // Work cancelled by the deadline fails in its own way; the deadline is the cause.
        if (passed()) throw error;
        throw cause;
      }
    },
    signal: controller.signal,
  };
}

// ---------------------------------------------------------------------------
// Publication and reading

function dedupeKey(requestId: string, retryKey: string) {
  return `${EVALUATION_JOB}:${requestId}:${retryKey}`;
}

// New evaluations of one request per rolling hour.
export const EVALUATIONS_PER_HOUR = 10;

// Inserts a pending evaluation of the request at its current request and
// settings revisions and publishes its job, in the caller's transaction, under
// the request lock. One evaluation per (request, retryKey): publishing the same
// key again returns the evaluation already published, which an exact retry then
// reads, with any saved ranking, without another model call. A pending
// evaluation at the same revisions is returned instead of a new one, unless the
// caller changed what it reads (`reusePending: false`, a new trip allowance).
// Past EVALUATIONS_PER_HOUR new evaluations, publishing is rate_limited.
export async function publishEvaluation(
  tx: Transaction,
  input: {
    readonly requestId: string;
    readonly retryKey: string;
    readonly audience: EvaluationAudience;
    readonly reusePending?: boolean;
    // A fixed interval to check instead of the requested windows, and the shared
    // change it settles (host-review-and-booking design 4); never reused.
    readonly interval?: { readonly start: string; readonly end: string };
    readonly sharedChangeId?: string;
  },
): Promise<{ evaluationId: string; created: boolean }> {
  const key = dedupeKey(input.requestId, input.retryKey);
  const [existing] = await tx<{ evaluation_id: string }[]>`
    select payload ->> 'evaluationId' as evaluation_id from app.jobs where kind = ${EVALUATION_JOB} and dedupe_key = ${key}
  `;

  if (existing) return { created: false, evaluationId: existing.evaluation_id };

  const [revisions] = await tx<{ request_revision: number; settings_revision: number | null }[]>`
    select r.revision as request_revision, s.revision as settings_revision
    from app.requests r
    left join app.host_settings s on s.host_account_id = r.host_account_id
    where r.id = ${input.requestId}
    for update of r
  `;

  if (!revisions || revisions.settings_revision === null) {
    throw new CommandError("invalid_input");
  }

  const [recent] = await tx<{ count: number; pending_id: string | null }[]>`
    select count(*) filter (where created_at > now() - interval '1 hour')::int as count,
           (array_agg(id order by created_at desc) filter (
             where state = 'pending' and request_revision = ${revisions.request_revision}
               and settings_revision = ${revisions.settings_revision}
           ))[1] as pending_id
    from app.evaluations
    where request_id = ${input.requestId}
  `;

  if (recent!.pending_id && input.reusePending !== false && !input.interval) {
    return { created: false, evaluationId: recent!.pending_id };
  }
  if (recent!.count >= EVALUATIONS_PER_HOUR) throw new CommandError("rate_limited");

  const evaluationId = randomUUID();
  const jobId = await publishJob(tx, {
    dedupeKey: key,
    kind: EVALUATION_JOB,
    // One attempt: a failed run records its failure on the evaluation instead of
    // spending another 18 seconds and another ranking reservation.
    maxAttempts: 1,
    payload: {
      audience: input.audience,
      evaluationId,
      ...(input.interval ? { interval: input.interval } : {}),
      ...(input.sharedChangeId ? { sharedChangeId: input.sharedChangeId } : {}),
    },
  });

  if (!jobId) {
    // A concurrent publication of the same key won.
    const [raced] = await tx<{ evaluation_id: string }[]>`
      select payload ->> 'evaluationId' as evaluation_id from app.jobs where kind = ${EVALUATION_JOB} and dedupe_key = ${key}
    `;
    return { created: false, evaluationId: raced!.evaluation_id };
  }

  await tx`
    insert into app.evaluations (id, request_id, request_revision, settings_revision)
    values (${evaluationId}, ${input.requestId}, ${revisions.request_revision}, ${revisions.settings_revision})
  `;

  return { created: true, evaluationId };
}

// An excluded candidate in the host's private record.
export type ExcludedEntry = Exclusion & { readonly status: "excluded" };
export type StoredCandidate = EvaluatedCandidate | ExcludedEntry;

// The host audience's view: every candidate with its basis, the exclusions and
// the validated ranking. Phase 4's host review reads it; the requester never does.
export type HostEvaluationView = {
  readonly id: string;
  readonly requestId: string;
  readonly state: EvaluationState;
  readonly failureCategory: string | null;
  readonly requestRevision: number;
  readonly settingsRevision: number;
  readonly deadlineAt: string | null;
  readonly candidates: readonly EvaluatedCandidate[];
  readonly exclusions: readonly ExcludedEntry[];
  readonly ranking: readonly string[] | null;
  readonly meetAvailable: boolean | null;
};

type EvaluationRow = {
  candidates: StoredCandidate[] | null;
  deadline_at: Date | null;
  failure_category: string | null;
  id: string;
  ranking: string[] | null;
  request_id: string;
  request_revision: number;
  requester_projection: RequesterEvaluationView | null;
  settings_revision: number;
  state: EvaluationState;
};

function requesterFailure(state: EvaluationState, category: string | null): RequesterEvaluationFailure | null {
  if (category === "requester_calendar_unavailable") return "requester_calendar_unavailable";
  if (category === "needs_details") return "needs_details";
  return state === "incomplete" || state === "failed" ? "try_again" : null;
}

function requesterView(row: EvaluationRow): RequesterEvaluationView {
  const nearest = row.state === "completed" ? row.requester_projection?.nearest : undefined;
  return {
    candidates: row.state === "completed" ? (row.requester_projection?.candidates ?? []) : [],
    failure: requesterFailure(row.state, row.failure_category),
    id: row.id,
    meetAvailable: row.requester_projection?.meetAvailable ?? null,
    ...(nearest ? { nearest } : {}),
    state: row.state,
  };
}

function hostView(row: EvaluationRow): HostEvaluationView {
  const stored = row.candidates ?? [];

  return {
    candidates: stored.filter((entry): entry is EvaluatedCandidate => entry.status !== "excluded"),
    deadlineAt: row.deadline_at?.toISOString() ?? null,
    exclusions: stored.filter((entry): entry is ExcludedEntry => entry.status === "excluded"),
    failureCategory: row.failure_category,
    id: row.id,
    meetAvailable: row.requester_projection?.meetAvailable ?? null,
    ranking: row.ranking,
    requestId: row.request_id,
    requestRevision: row.request_revision,
    settingsRevision: row.settings_revision,
    state: row.state,
  };
}

async function readRow(db: Database | Transaction, evaluationId: string) {
  const [row] = await db<EvaluationRow[]>`
    select id, request_id, request_revision, settings_revision, state, deadline_at, candidates, requester_projection,
           ranking, failure_category
    from app.evaluations
    where id = ${evaluationId}
  `;
  return row ?? null;
}

// Polls until the evaluation leaves pending or the time is up.
async function pollRow(db: Database, evaluationId: string, timeoutMs: number) {
  const until = Date.now() + timeoutMs;

  for (;;) {
    const row = await readRow(db, evaluationId);
    if (!row || row.state !== "pending" || Date.now() >= until) return row;
    await new Promise((resolve) => setTimeout(resolve, Math.min(AWAIT_POLL_MS, Math.max(0, until - Date.now()))));
  }
}

// The requester audience's view of an evaluation, or null for an unknown one.
// The caller has already checked that the evaluation belongs to its request.
export async function readEvaluation(db: Database | Transaction, evaluationId: string) {
  const row = await readRow(db, evaluationId);
  return row ? requesterView(row) : null;
}

export async function readHostEvaluation(db: Database | Transaction, evaluationId: string) {
  const row = await readRow(db, evaluationId);
  return row ? hostView(row) : null;
}

// Waits up to timeoutMs for the evaluation to leave pending, then returns the
// requester audience's view, still pending if it did not finish in time (the card
// fills in from the record later). Null for an unknown evaluation.
export async function awaitEvaluation(db: Database, evaluationId: string, timeoutMs: number) {
  const row = await pollRow(db, evaluationId, timeoutMs);
  return row ? requesterView(row) : null;
}

// The same wait for the host audience (Phase 4's host review).
export async function awaitHostEvaluation(db: Database, evaluationId: string, timeoutMs: number) {
  const row = await pollRow(db, evaluationId, timeoutMs);
  return row ? hostView(row) : null;
}

// ---------------------------------------------------------------------------
// Ranking

// The model's ranking, accepted only as an ordering of IDs it was given: any
// unknown or repeated ID, or output that is not a list of IDs, discards it.
export function validateRanking(output: unknown, allowed: readonly string[]): string[] | null {
  const order = (output as { order?: unknown } | null)?.order;
  if (!Array.isArray(order) || order.length === 0) return null;

  const known = new Set(allowed);
  const seen = new Set<string>();

  for (const id of order) {
    if (typeof id !== "string" || !known.has(id) || seen.has(id)) return null;
    seen.add(id);
  }

  return order as string[];
}

function parseJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

const RANKING_INSTRUCTIONS = [
  "You order candidate meeting times that have already passed every scheduling check.",
  'Reply with JSON only: {"order": [candidate IDs, most suitable first]}. Use only IDs from the list, each at most once.',
  "Prefer times comfortably inside the working day for both parties, then sooner dates. Never invent an ID.",
].join("\n");

// Asks the limited model to reorder the candidates. The caller wraps the model
// with the ranking work item, so each attempt reserves allowance and at most two
// are made (one retry); output is limited to 2,048 tokens by the same wrapper.
export async function rankCandidates(
  model: LanguageModel,
  candidates: readonly EvaluatedCandidate[],
  zones: { readonly host: string; readonly requester: string },
  signal: AbortSignal,
): Promise<string[] | null> {
  const lines = candidates.map((candidate) => {
    const start = new Date(candidate.start);
    return `${candidate.id}: ${candidate.durationMinutes} minutes, host ${displayTime(start, zones.host)}, requester ${displayTime(start, zones.requester)}`;
  });

  const result = await generateText({
    abortSignal: signal,
    maxOutputTokens: 2048,
    maxRetries: 1,
    model,
    prompt: lines.join("\n"),
    system: RANKING_INSTRUCTIONS,
  });

  return validateRanking(parseJson(result.text), candidates.map((candidate) => candidate.id));
}

// ---------------------------------------------------------------------------
// The job

export type EvaluationDependencies = {
  readonly db: Database;
  readonly tokenKeys: readonly TokenKey[];
  readonly calendar: GoogleCalendarConfig;
  readonly requesterCalendar: GoogleCalendarConfig;
  readonly routes: RoutesConfig;
  // The ranking model before the limit wrapper, or null to keep the deterministic order.
  readonly model: LanguageModel | null;
  readonly deadlineMs?: number;
  readonly now?: () => number;
  readonly limits?: Partial<ModelLimits>;
  // Where a settled shared change's email links; the environment's by default.
  readonly notices?: NoticeDependencies;
};

// The providers an evaluation reads, without a ranking model unless one is
// given: booking revalidation never ranks.
export function evaluationDependenciesFromEnvironment(model: LanguageModel | null = null): EvaluationDependencies {
  return {
    calendar: googleCalendarConfigFromEnvironment(),
    db: database(),
    model,
    requesterCalendar: requesterCalendarConfigFromEnvironment(),
    routes: routesConfigFromEnvironment(),
    tokenKeys: [tokenKeyFromEnvironment()],
  };
}

// The ranking provider, FMAT_RANKING_MODEL or gpt-5.6-terra by default
// (model-choice.ts), is loaded only when an evaluation runs.
async function defaultDependencies(): Promise<EvaluationDependencies> {
  const choice = rankingModelChoice();
  const model =
    choice.provider === "openai"
      ? (await import("eve/models/openai")).openai(choice.modelId)
      : (await import("eve/models/anthropic")).anthropic(choice.modelId);
  return evaluationDependenciesFromEnvironment(model);
}

type Loaded = {
  readonly request: {
    readonly closed: boolean;
    readonly details: RequestDetails;
    readonly hostAccountId: string;
    readonly revision: number;
  };
  readonly settings: ConfirmedSettings;
  readonly settingsRevision: number;
  readonly hostActive: boolean;
  readonly hostEmail: string | null;
};

async function load(tx: Transaction, requestId: string): Promise<Loaded | null> {
  const [row] = await tx<
    {
      closed: boolean;
      details: RequestDetails;
      host_account_id: string;
      host_email: string | null;
      host_status: string;
      revision: number;
      settings: ConfirmedSettings | null;
      settings_revision: number | null;
    }[]
  >`
    select r.host_account_id, r.revision, r.details,
           (r.closed_at is not null or r.expires_at <= now()) as closed,
           a.status as host_status, s.settings, s.revision as settings_revision,
           (select email from app.google_identities g where g.host_account_id = r.host_account_id) as host_email
    from app.requests r
    join app.host_accounts a on a.id = r.host_account_id
    left join app.host_settings s on s.host_account_id = r.host_account_id
    where r.id = ${requestId}
  `;

  if (!row || !row.settings || row.settings_revision === null) return null;

  return {
    hostActive: row.host_status === "active",
    hostEmail: row.host_email,
    request: { closed: row.closed, details: row.details, hostAccountId: row.host_account_id, revision: row.revision },
    settings: row.settings,
    settingsRevision: row.settings_revision,
  };
}

// The host-timezone range events are read over: whole weeks around the requested
// windows (the weekly limit counts by week), from the day before for an
// overnight window's tail, to the day after for its end.
function readRange(windows: readonly { start: Date; end: Date }[], timezone: string) {
  const first = localParts(Math.min(...windows.map((window) => window.start.getTime())), timezone);
  const last = localParts(Math.max(...windows.map((window) => window.end.getTime())), timezone);
  const firstMonday = addDays(first.date, -WEEKDAYS.indexOf(first.weekday));
  const lastMonday = addDays(last.date, -WEEKDAYS.indexOf(last.weekday));

  return {
    end: new Date(startOfLocalDay(addDays(lastMonday, 8), timezone)),
    start: new Date(startOfLocalDay(addDays(firstMonday, -1), timezone)),
  };
}

type Nearest = { readonly before: EvaluatedCandidate | null; readonly after: EvaluatedCandidate | null };

type Outcome =
  | { readonly kind: "result"; readonly input: FeasibilityInput; readonly candidates: StoredCandidate[]; readonly ordered: EvaluatedCandidate[]; readonly requesterNotes: FeasibilityResult["requesterNotes"]; readonly ranking: string[] | null; readonly meetAvailable: boolean | null; readonly failure: "needs_details" | null; readonly nearest: Nearest }
  | { readonly kind: "failed"; readonly category: EvaluationFailureCategory }
  | { readonly kind: "incomplete"; readonly category: EvaluationFailureCategory };

class FailedEvaluation extends Error {
  readonly category: EvaluationFailureCategory;

  constructor(category: EvaluationFailureCategory, options?: { cause?: unknown }) {
    super(`Evaluation failed: ${category}.`, options);
    this.name = "FailedEvaluation";
    this.category = category;
  }
}

// The search range when the requester gave no windows (guest-flow-completion
// U9): from now to two weeks ahead, within the host's weekly windows as always.
export const DEFAULT_SEARCH_DAYS = 14;

// How far before and after the requester's windows the nearest open times are
// looked for (nearest-open-times design 1), one day at a time outward, and the
// part of the deadline kept for the main result: the nearest search stops when
// less than NEAREST_RESERVE_MS remain.
export const NEAREST_SEARCH_DAYS = 7;
export const NEAREST_RESERVE_MS = 4_000;
const DAY_MS = 86_400_000;

// The extra range the nearest search may read, around the requested windows.
function nearestRange(windows: readonly { start: Date; end: Date }[], now: Date) {
  const first = Math.min(...windows.map((window) => window.start.getTime()));
  const last = Math.max(...windows.map((window) => window.end.getTime()));
  return { end: new Date(last + NEAREST_SEARCH_DAYS * DAY_MS), start: new Date(Math.max(now.getTime(), first - NEAREST_SEARCH_DAYS * DAY_MS)) };
}

function windowsOf(details: RequestDetails) {
  return (details.windows ?? [])
    .map((window) => ({ end: new Date(window.end), start: new Date(window.start) }))
    .filter((window) => !Number.isNaN(window.start.getTime()) && window.end > window.start);
}

// The times a host declined or named as no longer working (guest-flow-completion
// U17), as blocked time that anchors no trip and fills no week.
function excludedBusy(details: RequestDetails): BusyInterval[] {
  return (details.excludedTimes ?? [])
    .map((entry) => ({ end: Date.parse(entry.end), start: Date.parse(entry.start) }))
    .filter((entry) => !Number.isNaN(entry.start) && entry.end > entry.start)
    .map((entry) => ({
      ...entry,
      allDay: true,
      endpoint: { kind: "unknown" as const, reason: "no_location" as const },
      meeting: false,
    }));
}

// The preferred area the same-day trip rank measures from (same-day-trips
// design 1): the first named area, else the venue, when the host groups trips.
function preferredArea(settings: ConfirmedSettings, hash: (text: string) => string) {
  if (!groupTripsOf(settings)) return null;
  return usualPlace(settings, hash);
}

// The host's usual place, which a host commitment with no location is taken to
// happen at (#324): the first named area, else the venue.
export function usualPlace(settings: Pick<ConfirmedSettings, "location">, hash: (text: string) => string) {
  if (settings.location?.kind !== "places") return null;
  const text = settings.location.areas[0] ?? settings.location.venue;
  return text ? { key: hash(text), text } : null;
}

// A guest-host's soft preferences (#60): their weekly windows and limit, and
// each of their weeks' load in their own timezone, counted like the host's.
export function guestHostPreferences(
  settings: GuestHostSource["preferences"],
  bookedStarts: readonly number[],
  busy: readonly BusyInterval[],
  hash: (text: string) => string = (text) => text,
): RequesterPreferences | null {
  const counted = [
    ...bookedStarts,
    ...(weeklyLimitCountsOf(settings) === "all_meetings" ? busy.filter((interval) => interval.meeting).map((interval) => interval.start) : []),
  ];
  const weekCounts: Record<string, number> = {};
  for (const start of counted) {
    const local = localParts(start, settings.timezone);
    const week = addDays(local.date, -WEEKDAYS.indexOf(local.weekday));
    weekCounts[week] = (weekCounts[week] ?? 0) + 1;
  }
  const place = usualPlace(settings, hash);
  // Nothing to order by: no preferences, so the ranking and the order stay as for any guest.
  if (settings.weeklyWindows.length === 0 && settings.weeklyLimit === null && !place) return null;
  return {
    timezone: settings.timezone,
    usualPlace: place,
    weekCounts,
    weeklyLimit: settings.weeklyLimit,
    weeklyWindows: settings.weeklyWindows,
  };
}

// The host's confirmed places a request without a place is paired with
// (guest-time-place-pairs design 1): the venue first, then the areas in the
// host's order, without repeats.
export const PAIR_PLACE_LIMIT = 6;

export function hostPlaces(settings: Pick<ConfirmedSettings, "location">) {
  if (settings.location?.kind !== "places") return [];
  const texts = [...(settings.location.venue ? [settings.location.venue] : []), ...settings.location.areas];
  return [...new Set(texts.map((text) => text.trim()).filter(Boolean))].slice(0, PAIR_PLACE_LIMIT);
}

// How an evaluation differs from the ordinary search over the requested windows
// (host-review-and-booking design 4 and 6): a fixed interval checks exactly one
// candidate (a shared change, or booking revalidation); extra busy time adds the
// host's in-flight bookings; ranking and the requester's calendar can be left
// out; route estimates can be required fresher than the cache's 24 hours.
export type EvaluateOptions = {
  readonly interval?: { readonly start: Date; readonly end: Date };
  readonly extraHostBusy?: readonly BusyInterval[];
  readonly rank?: boolean;
  readonly requesterCalendar?: boolean;
  readonly routeMaxAgeHours?: number;
  // A fixed-interval check of a chosen pair checks its place only
  // (guest-time-place-pairs design 7); null checks no place.
  readonly place?: string | null;
};

async function evaluate(
  tx: Transaction,
  deps: EvaluationDependencies,
  evaluation: { readonly id: string; readonly requestId: string },
  audience: EvaluationAudience,
  deadline: EvaluationDeadline,
  options: EvaluateOptions = {},
): Promise<Outcome> {
  const loaded = await load(tx, evaluation.requestId);
  if (!loaded) return { category: "host_unavailable", kind: "failed" };
  if (loaded.request.closed) return { category: "request_closed", kind: "incomplete" };
  if (!loaded.hostActive) return { category: "host_unavailable", kind: "failed" };

  const { details } = loaded.request;
  const settings = loaded.settings;
  const now = new Date((deps.now ?? Date.now)());
  const hash = endpointHasher(deps.tokenKeys[0]!);
  const requesterZone = details.timezone && isValidTimeZone(details.timezone) ? details.timezone : settings.timezone;
  const requested = options.interval ? [options.interval] : windowsOf(details);
  // Without the requester's windows: the next two weeks, spread across days.
  const searchDefault = requested.length === 0;
  const windows = searchDefault ? [{ end: new Date(now.getTime() + DEFAULT_SEARCH_DAYS * 86_400_000), start: now }] : requested;
  const durationMinutes = options.interval
    ? Math.round((options.interval.end.getTime() - options.interval.start.getTime()) / 60_000)
    : (details.durationMinutes ?? settings.durationMinutes);
  const location = options.place !== undefined ? options.place : (details.location ?? null);
  const mode = resolveMeetingMode(settings.meetingMode, details.mode ?? null, Boolean(location));

  const emptyResult = (failure: "needs_details" | null, input: FeasibilityInput): Outcome => ({
    candidates: [],
    failure,
    input,
    kind: "result",
    meetAvailable: null,
    nearest: NO_NEAREST,
    ordered: [],
    ranking: null,
    requesterNotes: new Map(),
  });
  // The requester's own search over their windows looks around them too when
  // nothing fits (nearest-open-times design 1); a fixed interval, the default
  // two-week search and the host's review do not.
  const searchAround = audience === "requester" && !options.interval && !searchDefault;
  const baseInput: FeasibilityInput = {
    allowances: [],
    host: {
      bufferAfterMinutes: settings.bufferAfterMinutes,
      bufferBeforeMinutes: settings.bufferBeforeMinutes,
      meetingMode: settings.meetingMode,
      preferredArea: preferredArea(settings, hash),
      timezone: settings.timezone,
      travelBufferMinutes: settings.travelBufferMinutes,
      travelMode: settings.travelMode,
      usualPlace: usualPlace(settings, hash),
      weeklyLimit: settings.weeklyLimit,
      weeklyLimitCounts: weeklyLimitCountsOf(settings),
      weeklyWindows: settings.weeklyWindows,
      scheduleOverrides: settings.scheduleOverrides,
    },
    hostBusy: [],
    now,
    request: {
      durationMinutes,
      linkPlan: details.linkPlan ?? null,
      location: location ? { key: hash(location), text: location } : null,
      mode: details.mode ?? null,
      places: options.place !== undefined ? [] : hostPlaces(settings).map((text) => ({ key: hash(text), text })),
      preferredWindows: (details.preferredWindows ?? []).map((window) => ({ start: new Date(window.start), end: new Date(window.end) })),
      lessPreferredWindows: (details.lessPreferredWindows ?? []).map((window) => ({ start: new Date(window.start), end: new Date(window.end) })),
      preferredWeeklyWindows: details.preferredWeeklyWindows ?? [],
      timezone: requesterZone,
      travelMode: details.travelMode ?? null,
      windows,
    },
    requesterBusy: null,
  };

  if (windows.length === 0 || mode === null) return emptyResult("needs_details", baseInput);

  const range = readRange(searchAround ? [...windows, nearestRange(windows, now)] : windows, settings.timezone);

  // A change after booking (post-booking-changes design 5): the meeting being
  // changed is not busy time for its own new time, on either calendar.
  const [standing] = await tx<{ event_id: string }[]>`
    select event_id from app.bookings where request_id = ${evaluation.requestId} and state = 'confirmed'
  `;
  const notOwnEvent = (event: CalendarEvent) => !standing || (event.id !== standing.event_id && event.iCalUID !== `${standing.event_id}@google.com`);

  // Host busy time from the confirmed conflict calendars, the grant refresh included.
  const hostEvents: CalendarEvent[] = [];
  let meetAvailable: boolean | null = null;

  try {
    const calendar = await openHostCalendar({ config: deps.calendar, db: tx, tokenKeys: deps.tokenKeys }, loaded.request.hostAccountId);

    for (const entry of settings.conflictCalendars) {
      hostEvents.push(...(await deadline.run((signal) => calendar.listEvents(entry.id, range, { signal }))).filter(notOwnEvent));
    }

    if (mode === "online" && !details.linkPlan) {
      try {
        const types = await deadline.run((signal) => calendar.conferenceSolutionTypes(settings.bookingCalendar.id, { signal }));
        meetAvailable = types.includes("hangoutsMeet");
      } catch (error) {
        if (error instanceof EvaluationDeadlineError) throw error;
        // Unknown support asks the requester for a link rather than promising Meet.
        meetAvailable = false;
      }
    }
  } catch (error) {
    if (error instanceof EvaluationDeadlineError) throw error;
    throw new FailedEvaluation(error instanceof CalendarAccessError ? error.category : "calendar_unavailable", { cause: error });
  }

  // The requester's own events, in memory only, when they connected a calendar.
  let requesterBusy: BusyInterval[] | null = null;
  const grant =
    options.requesterCalendar === false ? null : await readRequesterCalendarGrant(tx, deps.tokenKeys, evaluation.requestId);

  try {
    if (grant) {
      const events = await deadline.run((signal) => readRequesterEvents(deps.requesterCalendar, grant, range, { signal }));
      requesterBusy = normalizeBusy(events.filter(notOwnEvent), { endpointKey: hash, selfEmail: grant.email, timezone: requesterZone });
    }
  } catch (error) {
    if (error instanceof EvaluationDeadlineError) throw error;
    throw new FailedEvaluation("requester_calendar_unavailable", { cause: error });
  }

  // A guest who is a host and chose Calendars (design 6, D8) is also busy on
  // their host conflict calendars, read with their host grant and kept in
  // memory only; both sources count (user, 2026-11-02). A failed read drops
  // the item and reopens the Calendar step, never free time.
  const guestHost = options.requesterCalendar === false ? null : await readGuestHostSource(tx, evaluation.requestId);

  // Their own weekly windows and weekly limit order the candidates as soft
  // preferences (#60, design 7), the limit counting their Find Me a Time
  // bookings, and their other meetings too when they count every meeting.
  let requesterPreferences: RequesterPreferences | null = null;

  if (guestHost) {
    try {
      const calendar = await openHostCalendar({ config: deps.calendar, db: tx, tokenKeys: deps.tokenKeys }, guestHost.hostAccountId);
      const events: CalendarEvent[] = [];
      for (const entry of guestHost.conflictCalendars) {
        events.push(...(await deadline.run((signal) => calendar.listEvents(entry.id, range, { signal }))));
      }
      const ownBookings = await tx<{ event_id: string; start_at: Date }[]>`
        select event_id, start_at
        from app.bookings
        where host_account_id = ${guestHost.hostAccountId} and request_id <> ${evaluation.requestId}
          and state in ('reserved', 'dispatching', 'confirmed')
          and end_at > ${range.start} and start_at < ${range.end}
      `;
      const own = normalizeBusy(events, {
        bookedEventIds: new Set(ownBookings.map((row) => row.event_id)),
        endpointKey: hash,
        selfEmail: guestHost.email,
        timezone: requesterZone,
      });
      requesterBusy = [...(requesterBusy ?? []), ...own];
      requesterPreferences = guestHostPreferences(guestHost.preferences, ownBookings.map((row) => row.start_at.getTime()), own, hash);
    } catch (error) {
      if (error instanceof EvaluationDeadlineError) throw error;
      await dropGuestHostCalendars(tx, evaluation.requestId);
      throw new FailedEvaluation("requester_calendar_unavailable", { cause: error });
    }
  }

  // The host's live bookings for other requests, which fill their weeks toward
  // the weekly limit whether or not their events are on a conflict calendar.
  const bookings = await tx<{ event_id: string; start_at: Date }[]>`
    select event_id, start_at
    from app.bookings
    where host_account_id = ${loaded.request.hostAccountId} and request_id <> ${evaluation.requestId}
      and state in ('reserved', 'dispatching', 'confirmed')
      and end_at > ${range.start} and start_at < ${range.end}
  `;

  const allowances = await tx<
    {
      candidate_end: Date;
      candidate_start: Date;
      destination_hash: string;
      direction: "inbound" | "outbound";
      minutes: number;
      mode: TravelAllowance["mode"];
      origin_hash: string;
      party: "host" | "requester";
    }[]
  >`
    select party, candidate_start, candidate_end, direction, origin_hash, destination_hash, mode, minutes
    from app.travel_allowances
    where request_id = ${evaluation.requestId} and invalidated_at is null
  `;

  const input: FeasibilityInput = {
    ...baseInput,
    allowances: allowances.map((row) => ({
      candidateEnd: row.candidate_end,
      candidateStart: row.candidate_start,
      destinationKey: row.destination_hash,
      direction: row.direction,
      minutes: row.minutes,
      mode: row.mode,
      originKey: row.origin_hash,
      party: row.party,
    })),
    bookedStarts: bookings.map((row) => row.start_at.getTime()),
    hostBusy: [
      ...normalizeBusy(hostEvents, {
        bookedEventIds: new Set(bookings.map((row) => row.event_id)),
        endpointKey: hash,
        noteExclusions: settings.noteExclusions,
        selfEmail: loaded.hostEmail,
        timezone: settings.timezone,
      }),
      ...(options.extraHostBusy ?? []),
      ...excludedBusy(details),
    ].sort((a, b) => a.start - b.start),
    meetAvailable: meetAvailable ?? false,
    requesterBusy,
    requesterPreferences,
  };

  const estimate = (queries: readonly LegQuery[]) =>
    queries.length > 0
      ? deadline.run((signal) =>
          estimateTravel({ config: deps.routes, db: deps.db }, queries, { maxAgeHours: options.routeMaxAgeHours, now, signal }),
        )
      : Promise.resolve(new Map<string, RouteEstimate>());

  // The same-day trip rank's estimates first (same-day-trips design 4), so the
  // candidates kept for the travel check are cut from the ranked order; a
  // failure other than the deadline only leaves the days unranked.
  let trips = new Map<string, RouteEstimate>();
  try {
    trips = await estimate(tripQueries(input));
  } catch (error) {
    if (error instanceof EvaluationDeadlineError) throw error;
  }
  const lookup = (estimates: ReadonlyMap<string, RouteEstimate>) => (query: LegQuery) =>
    estimates.get(legQueryKey(query)) ?? trips.get(legQueryKey(query));
  const ranked: FeasibilityInput = { ...input, estimate: lookup(new Map()) };
  const estimates = await estimate(travelQueries(ranked).filter((query) => !trips.has(legQueryKey(query))));
  const result = evaluateFeasibility({ ...input, estimate: lookup(estimates) });
  const nearest =
    searchAround && !result.candidates.some((candidate) => candidate.status === "offered")
      ? await nearestOpenTimes(input, windows, {
          estimate,
          known: new Map([...trips, ...estimates]),
          remainingMs: () => deadline.at.getTime() - (deps.now ?? Date.now)(),
        })
      : NO_NEAREST;

  // Ranking may only reorder the first valid candidates; a failed or invalid
  // ranking keeps the deterministic order, and the deadline still applies.
  const valid = result.candidates.filter((candidate) => candidate.status === "offered").slice(0, RANKING_LIMIT);
  let ranking: string[] | null = null;

  // The default two-week search is the fixed slot step, before any model call
  // (guest-flow-completion U9): it keeps the deterministic order, spread across days.
  if (deps.model && valid.length > 1 && options.rank !== false && !searchDefault && !(details.preferredWindows?.length) && !(details.lessPreferredWindows?.length) && !(details.preferredWeeklyWindows?.length) && !requesterPreferences) {
    const principal: Principal =
      audience === "host"
        ? { id: loaded.request.hostAccountId, type: "host_account" }
        : { id: evaluation.requestId, type: "requester_request" };
    const model = limitModel(deps.model, () => ({
      db: deps.db,
      limits: deps.limits,
      ranking: { id: evaluation.id, principal },
    }));

    try {
      ranking = await deadline.run((signal) =>
        rankCandidates(model, valid, { host: settings.timezone, requester: requesterZone }, signal),
      );
    } catch (error) {
      if (error instanceof EvaluationDeadlineError) throw error;
      ranking = null;
    }
  }

  const ordered = applyRanking(result.candidates, ranking, requesterZone);

  return {
    candidates: [...ordered, ...result.exclusions.map((exclusion) => ({ ...exclusion, status: "excluded" as const }))],
    failure: null,
    input,
    kind: "result",
    meetAvailable: mode === "online" ? meetAvailable : null,
    nearest,
    ordered,
    ranking,
    requesterNotes: result.requesterNotes,
  };
}

const NO_NEAREST: Nearest = { after: null, before: null };

// The nearest open times before and after the requested windows, when none of
// them fits (nearest-open-times design 1): the same deterministic checks over
// one day at a time, moving outward from the windows for up to
// NEAREST_SEARCH_DAYS, with the requester's preferences left out. Only an
// offered time counts, and below the host's weekly limit when one is set, so
// the guest is never offered a time the host would have to waive a rule for.
// It stops early, keeping what it found, when the deadline nears or a route
// estimate fails; nothing it returns says why the windows did not work.
async function nearestOpenTimes(
  input: FeasibilityInput,
  requested: readonly { start: Date; end: Date }[],
  routes: {
    readonly estimate: (queries: readonly LegQuery[]) => Promise<Map<string, RouteEstimate>>;
    readonly known: Map<string, RouteEstimate>;
    readonly remainingMs: () => number;
  },
): Promise<Nearest> {
  const first = Math.min(...requested.map((window) => window.start.getTime()));
  const last = Math.max(...requested.map((window) => window.end.getTime()));
  const now = input.now.getTime();
  const lookup = (query: LegQuery) => routes.known.get(legQueryKey(query));
  const inRequested = (candidate: EvaluatedCandidate) =>
    requested.some((window) => Date.parse(candidate.start) < window.end.getTime() && Date.parse(candidate.end) > window.start.getTime());
  const open = (candidate: EvaluatedCandidate) =>
    candidate.status === "offered" && (input.host.weeklyLimit === null || candidate.belowWeeklyLimit) && !inRequested(candidate);

  const search = async (window: { start: Date; end: Date }): Promise<FeasibilityResult | null> => {
    const day: FeasibilityInput = {
      ...input,
      request: { ...input.request, lessPreferredWindows: [], preferredWeeklyWindows: [], preferredWindows: [], windows: [window] },
      requesterPreferences: null,
    };
    try {
      const missing = travelQueries({ ...day, estimate: lookup }).filter((query) => !routes.known.has(legQueryKey(query)));
      for (const [key, value] of await routes.estimate(missing)) routes.known.set(key, value);
    } catch {
      // A failed or late estimate ends the search; what was found stands.
      return null;
    }
    return evaluateFeasibility({ ...day, estimate: lookup });
  };

  let before: EvaluatedCandidate | null = null;
  let after: EvaluatedCandidate | null = null;
  let beforeDone = first <= now;
  let afterDone = false;

  for (let day = 1; day <= NEAREST_SEARCH_DAYS && !(beforeDone && afterDone); day += 1) {
    if (!beforeDone) {
      if (routes.remainingMs() < NEAREST_RESERVE_MS) break;
      const end = first - (day - 1) * DAY_MS;
      const result = await search({ end: new Date(end), start: new Date(Math.max(now, end - DAY_MS)) });
      if (!result) beforeDone = true;
      else {
        before = result.candidates.filter(open).sort((a, b) => Date.parse(b.start) - Date.parse(a.start))[0] ?? null;
        beforeDone = before !== null || end - DAY_MS <= now;
      }
    }
    if (!afterDone) {
      if (routes.remainingMs() < NEAREST_RESERVE_MS) break;
      const result = await search({ end: new Date(last + day * DAY_MS), start: new Date(last + (day - 1) * DAY_MS) });
      if (!result) afterDone = true;
      else {
        after = result.candidates.filter(open).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0] ?? null;
        afterDone = after !== null;
      }
    }
  }

  return { after, before };
}

// ---------------------------------------------------------------------------
// One fixed interval

// Why a fixed interval is not bookable, in host-private terms.
export type IntervalProblem = "busy" | "travel" | "travel_unresolved" | "outside_hours" | "requester_unavailable" | "needs_details";

export type IntervalCheck =
  | { readonly ok: true; readonly candidate: EvaluatedCandidate }
  | { readonly ok: false; readonly problem: IntervalProblem; readonly explanation: string | null }
  | { readonly ok: false; readonly problem: "unavailable"; readonly category: EvaluationFailureCategory };

// Whether exactly this interval passes the deterministic checks.
export function intervalVerdict(
  outcome: Extract<Outcome, { kind: "result" }>,
  interval: { readonly start: Date; readonly end: Date },
): IntervalCheck {
  if (outcome.failure === "needs_details") return { explanation: null, ok: false, problem: "needs_details" };

  const start = interval.start.toISOString();
  const candidate = outcome.ordered.find((entry) => entry.start === start);

  if (candidate?.status === "offered") return { candidate, ok: true };
  if (candidate) return { explanation: candidate.basis.at(-1) ?? null, ok: false, problem: "travel_unresolved" };

  const excluded = outcome.candidates.find(
    (entry): entry is ExcludedEntry => entry.status === "excluded" && entry.start === start,
  );
  if (excluded) {
    const problem: IntervalProblem =
      excluded.reason === "host_travel" ? "travel" : excluded.reason === "requester_unavailable" ? "requester_unavailable" : "busy";
    return { explanation: excluded.explanation, ok: false, problem };
  }

  return { explanation: null, ok: false, problem: "outside_hours" };
}

// Checks one interval of a request under its own shared deadline, publishing
// nothing: booking revalidation (design 6) reads the host's calendars fresh,
// counts the host's other in-flight bookings as busy, refetches route estimates
// older than an hour, and leaves out ranking and the requester's calendar (the
// requester agreed to this time).
export async function checkInterval(
  tx: Transaction,
  deps: EvaluationDependencies,
  requestId: string,
  interval: { readonly start: Date; readonly end: Date },
  options: Omit<EvaluateOptions, "interval"> = {},
): Promise<IntervalCheck> {
  const deadline = startDeadline(deps.deadlineMs ?? EVALUATION_DEADLINE_MS, deps.now);

  try {
    const outcome = await evaluate(tx, deps, { id: randomUUID(), requestId }, "host", deadline, {
      ...options,
      interval,
      rank: false,
    });

    if (outcome.kind !== "result") return { category: outcome.category, ok: false, problem: "unavailable" };
    if (deadline.passed()) return { category: "deadline", ok: false, problem: "unavailable" };
    return intervalVerdict(outcome, interval);
  } catch (error) {
    if (error instanceof EvaluationDeadlineError) return { category: "deadline", ok: false, problem: "unavailable" };
    if (error instanceof FailedEvaluation) return { category: error.category, ok: false, problem: "unavailable" };
    throw error;
  } finally {
    deadline.clear();
  }
}

// D8: when the weekly limit is set, at least one candidate is offered and every
// offered candidate falls in a week at or above the limit, nothing is offered to
// the requester until the host waives the limit for this request.
export function weeklyLimitHold(candidates: readonly EvaluatedCandidate[], weeklyLimit: number | null) {
  const offered = candidates.filter((candidate) => candidate.status === "offered");
  return weeklyLimit !== null && offered.length > 0 && offered.every((candidate) => !candidate.belowWeeklyLimit);
}

async function weeklyLimitWaived(tx: Transaction, requestId: string, settingsRevision: number) {
  const [row] = await tx<{ found: boolean }[]>`
    select true as found from app.request_exceptions
    where request_id = ${requestId} and kind = 'weekly_limit' and invalidated_at is null
      and settings_revision = ${settingsRevision}
  `;
  return Boolean(row);
}

async function finish(
  tx: Transaction,
  evaluationId: string,
  state: "incomplete" | "failed",
  category: EvaluationFailureCategory,
  deadlineAt: Date | null,
) {
  await tx`
    update app.evaluations
    set state = ${state}, failure_category = ${category}, deadline_at = ${deadlineAt}, candidates = null,
        requester_projection = null, ranking = null, completed_at = now()
    where id = ${evaluationId} and state = 'pending'
  `;
  return { failureCategory: category, state };
}

function fixedInterval(value: unknown) {
  const raw = value as { start?: unknown; end?: unknown } | null | undefined;
  if (typeof raw?.start !== "string" || typeof raw.end !== "string") return null;
  const start = new Date(raw.start);
  const end = new Date(raw.end);
  return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start ? null : { end, start };
}

// The nearest open times as the requester may see them: the same fields as a
// candidate, nothing of why the windows did not work.
function nearestProjection(nearest: Nearest, displayTimezone: string, id: string): NearestOpenTimes {
  const shown = (candidate: EvaluatedCandidate | null) =>
    candidate ? (requesterProjection([candidate], { displayTimezone, id, state: "completed" }).candidates[0] ?? null) : null;
  return { after: shown(nearest.after), before: shown(nearest.before) };
}

export function createEvaluationHandler(
  loadDependencies: () => EvaluationDependencies | Promise<EvaluationDependencies> = defaultDependencies,
): JobHandler {
  const handler: JobHandler = async (tx: Transaction, job: ClaimedJob) => {
    const evaluationId = typeof job.payload.evaluationId === "string" ? job.payload.evaluationId : null;
    const audience: EvaluationAudience = job.payload.audience === "host" ? "host" : "requester";
    const [evaluation] = evaluationId
      ? await tx<{ request_id: string; request_revision: number; settings_revision: number; state: EvaluationState }[]>`
          select request_id, request_revision, settings_revision, state from app.evaluations where id = ${evaluationId}
        `
      : [];

    if (!evaluation || evaluation.state !== "pending") return { skipped: true };

    const deps = await loadDependencies();
    const deadline = startDeadline(deps.deadlineMs ?? EVALUATION_DEADLINE_MS, deps.now);
    const fixed = fixedInterval(job.payload.interval);
    const sharedChangeId = typeof job.payload.sharedChangeId === "string" ? job.payload.sharedChangeId : null;
    let outcome: Outcome;

    try {
      outcome = await evaluate(
        tx,
        deps,
        { id: evaluationId!, requestId: evaluation.request_id },
        audience,
        deadline,
        fixed ? { interval: fixed, rank: false } : {},
      );
    } catch (error) {
      if (error instanceof EvaluationDeadlineError) outcome = { category: "deadline", kind: "incomplete" };
      else if (error instanceof FailedEvaluation) outcome = { category: error.category, kind: "failed" };
      else throw error;
    } finally {
      deadline.clear();
    }

    if (outcome.kind !== "result") {
      if (sharedChangeId) await settleSharedChange(tx, sharedChangeId, evaluationId!, { category: outcome.category, ok: false, problem: "unavailable" }, deps.notices);
      return finish(tx, evaluationId!, outcome.kind, outcome.category, deadline.at);
    }

    // Publication under the request lock: the request and the settings must still
    // be at the revisions this evaluation read, the request open, and the
    // deadline not passed; a late or stale result publishes nothing.
    const [current] = await tx<{ closed: boolean; revision: number; settings_revision: number | null }[]>`
      select r.revision, (r.closed_at is not null or r.expires_at <= now()) as closed,
             (select revision from app.host_settings s where s.host_account_id = r.host_account_id) as settings_revision
      from app.requests r
      where r.id = ${evaluation.request_id}
      for update of r
    `;

    const stale = (category: EvaluationFailureCategory) => async () => {
      if (sharedChangeId) await settleSharedChange(tx, sharedChangeId, evaluationId!, { category, ok: false, problem: "unavailable" }, deps.notices);
      return finish(tx, evaluationId!, "incomplete", category, deadline.at);
    };

    if (deadline.passed()) return stale("deadline")();
    if (!current || current.closed) return stale("request_closed")();
    if (current.revision !== evaluation.request_revision || current.settings_revision !== evaluation.settings_revision) {
      return stale("revision_changed")();
    }

    const held =
      !fixed &&
      weeklyLimitHold(outcome.ordered, outcome.input.host.weeklyLimit) &&
      !(await weeklyLimitWaived(tx, evaluation.request_id, evaluation.settings_revision));
    const offered = fixed
      ? outcome.ordered.filter((candidate) => candidate.status === "offered" && candidate.start === fixed.start.toISOString())
      : held
        ? []
        : outcome.ordered;

    const shown = requesterProjection(offered, {
      displayTimezone: outcome.input.request.timezone,
      id: evaluationId!,
      notes: outcome.requesterNotes,
      state: "completed",
    });
    const projection: RequesterEvaluationView = {
      ...shown,
      failure: outcome.failure,
      meetAvailable: outcome.meetAvailable,
      ...(!fixed && !held && shown.candidates.length === 0 && (outcome.nearest.before || outcome.nearest.after)
        ? { nearest: nearestProjection(outcome.nearest, outcome.input.request.timezone, evaluationId!) }
        : {}),
    };

    await tx`
      update app.evaluations
      set state = 'completed', deadline_at = ${deadline.at},
          candidates = ${tx.json(outcome.candidates as unknown as Parameters<typeof tx.json>[0])},
          requester_projection = ${tx.json(projection as unknown as Parameters<typeof tx.json>[0])},
          ranking = ${outcome.ranking ? tx.json(outcome.ranking) : null},
          failure_category = ${outcome.failure}, completed_at = now()
      where id = ${evaluationId} and state = 'pending'
    `;
    // Still under the request lock and after the revision check above.
    await markNegotiating(tx, evaluation.request_id, projection.candidates.length);

    // Tell the host when a requester has no selectable time because every
    // otherwise feasible candidate is in a full week. Revision-keyed notices
    // avoid repeats from retries while allowing a later request/settings edit.
    if (held && audience === "requester" && current.settings_revision !== null) {
      await enqueueHostNotice(tx, evaluation.request_id, {
        kind: "weekly_limit_hold",
        requestRevision: current.revision,
        settingsRevision: current.settings_revision,
        weeklyLimit: outcome.input.host.weeklyLimit!,
      });
    }

    if (sharedChangeId && fixed) {
      await settleSharedChange(tx, sharedChangeId, evaluationId!, intervalVerdict(outcome, fixed), deps.notices);
    }

    return { candidates: outcome.ordered.length, held, ranked: outcome.ranking !== null, state: "completed" };
  };

  // A run that failed unexpectedly leaves its evaluation failed, so the card
  // offers Find other times instead of waiting.
  handler.onExhausted = async (tx, job) => {
    const evaluationId = typeof job.payload.evaluationId === "string" ? job.payload.evaluationId : null;
    if (!evaluationId) return;

    if (typeof job.payload.sharedChangeId === "string") {
      await settleSharedChange(tx, job.payload.sharedChangeId, evaluationId, {
        category: "evaluation_failed",
        ok: false,
        problem: "unavailable",
      });
    }

    await tx`
      update app.evaluations
      set state = 'failed', failure_category = 'evaluation_failed', completed_at = now()
      where id = ${evaluationId} and state = 'pending'
    `;
  };

  return handler;
}
