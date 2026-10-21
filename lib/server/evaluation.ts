import { randomUUID } from "node:crypto";
import { generateText, type LanguageModel } from "ai";
import type { RequesterEvaluationFailure, RequesterEvaluationView } from "../contracts/feasibility";
import type { EvaluationState, RequestDetails } from "../contracts/request";
import { type ConfirmedSettings, isValidTimeZone, WEEKDAYS } from "../contracts/setup";
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
  legQueryKey,
  localParts,
  normalizeBusy,
  requesterProjection,
  resolveMeetingMode,
  startOfLocalDay,
  type TravelAllowance,
  travelQueries,
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
import { limitModel, type ModelLimits, type Principal } from "./model-limits";
import {
  readRequesterCalendarGrant,
  readRequesterEvents,
  requesterCalendarConfigFromEnvironment,
} from "./requester-calendar";
import { endpointHasher, estimateTravel, type RoutesConfig, routesConfigFromEnvironment } from "./routes-client";
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
const RANKING_MODEL_ID = "gpt-5.6-terra";

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

// Inserts a pending evaluation of the request at its current request and
// settings revisions and publishes its job, in the caller's transaction. One
// evaluation per (request, retryKey): publishing the same key again returns the
// evaluation already published, which an exact retry then reads, with any saved
// ranking, without another model call.
export async function publishEvaluation(
  tx: Transaction,
  input: { readonly requestId: string; readonly retryKey: string; readonly audience: EvaluationAudience },
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
  `;

  if (!revisions || revisions.settings_revision === null) {
    throw new CommandError("invalid_input");
  }

  const evaluationId = randomUUID();
  const jobId = await publishJob(tx, {
    dedupeKey: key,
    kind: EVALUATION_JOB,
    // One attempt: a failed run records its failure on the evaluation instead of
    // spending another 18 seconds and another ranking reservation.
    maxAttempts: 1,
    payload: { audience: input.audience, evaluationId },
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
  return {
    candidates: row.state === "completed" ? (row.requester_projection?.candidates ?? []) : [],
    failure: requesterFailure(row.state, row.failure_category),
    id: row.id,
    meetAvailable: row.requester_projection?.meetAvailable ?? null,
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
};

// The OpenAI provider is loaded only when an evaluation runs.
async function defaultDependencies(): Promise<EvaluationDependencies> {
  const { openai } = await import("eve/models/openai");

  return {
    calendar: googleCalendarConfigFromEnvironment(),
    db: database(),
    model: openai(RANKING_MODEL_ID),
    requesterCalendar: requesterCalendarConfigFromEnvironment(),
    routes: routesConfigFromEnvironment(),
    tokenKeys: [tokenKeyFromEnvironment()],
  };
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

type Outcome =
  | { readonly kind: "result"; readonly input: FeasibilityInput; readonly candidates: StoredCandidate[]; readonly ordered: EvaluatedCandidate[]; readonly ranking: string[] | null; readonly meetAvailable: boolean | null; readonly failure: "needs_details" | null }
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

function windowsOf(details: RequestDetails) {
  return (details.windows ?? [])
    .map((window) => ({ end: new Date(window.end), start: new Date(window.start) }))
    .filter((window) => !Number.isNaN(window.start.getTime()) && window.end > window.start);
}

async function evaluate(
  tx: Transaction,
  deps: EvaluationDependencies,
  evaluation: { readonly id: string; readonly requestId: string },
  audience: EvaluationAudience,
  deadline: EvaluationDeadline,
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
  const windows = windowsOf(details);
  const mode = resolveMeetingMode(settings.meetingMode, details.mode ?? null, Boolean(details.location));

  const emptyResult = (failure: "needs_details" | null, input: FeasibilityInput): Outcome => ({
    candidates: [],
    failure,
    input,
    kind: "result",
    meetAvailable: null,
    ordered: [],
    ranking: null,
  });
  const baseInput: FeasibilityInput = {
    allowances: [],
    host: {
      bufferAfterMinutes: settings.bufferAfterMinutes,
      bufferBeforeMinutes: settings.bufferBeforeMinutes,
      meetingMode: settings.meetingMode,
      timezone: settings.timezone,
      travelBufferMinutes: settings.travelBufferMinutes,
      travelMode: settings.travelMode,
      weeklyLimit: settings.weeklyLimit,
      weeklyWindows: settings.weeklyWindows,
    },
    hostBusy: [],
    now,
    request: {
      durationMinutes: details.durationMinutes ?? settings.durationMinutes,
      linkPlan: details.linkPlan ?? null,
      location: details.location ? { key: hash(details.location), text: details.location } : null,
      mode: details.mode ?? null,
      timezone: requesterZone,
      travelMode: details.travelMode ?? null,
      windows,
    },
    requesterBusy: null,
  };

  if (windows.length === 0 || mode === null) return emptyResult("needs_details", baseInput);

  const range = readRange(windows, settings.timezone);

  // Host busy time from the confirmed conflict calendars, the grant refresh included.
  const hostEvents: CalendarEvent[] = [];
  let meetAvailable: boolean | null = null;

  try {
    const calendar = await openHostCalendar({ config: deps.calendar, db: tx, tokenKeys: deps.tokenKeys }, loaded.request.hostAccountId);

    for (const entry of settings.conflictCalendars) {
      hostEvents.push(...(await deadline.run((signal) => calendar.listEvents(entry.id, range, { signal }))));
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

  try {
    const grant = await readRequesterCalendarGrant(tx, deps.tokenKeys, evaluation.requestId);

    if (grant) {
      const events = await deadline.run((signal) => readRequesterEvents(deps.requesterCalendar, grant, range, { signal }));
      requesterBusy = normalizeBusy(events, { endpointKey: hash, selfEmail: grant.email, timezone: requesterZone });
    }
  } catch (error) {
    if (error instanceof EvaluationDeadlineError) throw error;
    throw new FailedEvaluation("requester_calendar_unavailable", { cause: error });
  }

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
    hostBusy: normalizeBusy(hostEvents, {
      endpointKey: hash,
      noteExclusions: settings.noteExclusions,
      selfEmail: loaded.hostEmail,
      timezone: settings.timezone,
    }),
    meetAvailable: meetAvailable ?? false,
    requesterBusy,
  };

  const queries = travelQueries(input);
  const estimates =
    queries.length > 0
      ? await deadline.run((signal) => estimateTravel({ config: deps.routes, db: deps.db }, queries, { now, signal }))
      : new Map();
  const result = evaluateFeasibility({ ...input, estimate: (query) => estimates.get(legQueryKey(query)) });

  // Ranking may only reorder the first valid candidates; a failed or invalid
  // ranking keeps the deterministic order, and the deadline still applies.
  const valid = result.candidates.filter((candidate) => candidate.status === "offered").slice(0, RANKING_LIMIT);
  let ranking: string[] | null = null;

  if (deps.model && valid.length > 1) {
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

  const ordered = applyRanking(result.candidates, ranking);

  return {
    candidates: [...ordered, ...result.exclusions.map((exclusion) => ({ ...exclusion, status: "excluded" as const }))],
    failure: null,
    input,
    kind: "result",
    meetAvailable: mode === "online" ? meetAvailable : null,
    ordered,
    ranking,
  };
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
    let outcome: Outcome;

    try {
      outcome = await evaluate(tx, deps, { id: evaluationId!, requestId: evaluation.request_id }, audience, deadline);
    } catch (error) {
      if (error instanceof EvaluationDeadlineError) outcome = { category: "deadline", kind: "incomplete" };
      else if (error instanceof FailedEvaluation) outcome = { category: error.category, kind: "failed" };
      else throw error;
    } finally {
      deadline.clear();
    }

    if (outcome.kind !== "result") {
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

    if (deadline.passed()) return finish(tx, evaluationId!, "incomplete", "deadline", deadline.at);
    if (!current || current.closed) return finish(tx, evaluationId!, "incomplete", "request_closed", deadline.at);
    if (current.revision !== evaluation.request_revision || current.settings_revision !== evaluation.settings_revision) {
      return finish(tx, evaluationId!, "incomplete", "revision_changed", deadline.at);
    }

    const projection: RequesterEvaluationView = {
      ...requesterProjection(outcome.ordered, {
        displayTimezone: outcome.input.request.timezone,
        id: evaluationId!,
        state: "completed",
      }),
      failure: outcome.failure,
      meetAvailable: outcome.meetAvailable,
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

    return { candidates: outcome.ordered.length, ranked: outcome.ranking !== null, state: "completed" };
  };

  // A run that failed unexpectedly leaves its evaluation failed, so the card
  // offers Find other times instead of waiting.
  handler.onExhausted = async (tx, job) => {
    const evaluationId = typeof job.payload.evaluationId === "string" ? job.payload.evaluationId : null;
    if (!evaluationId) return;

    await tx`
      update app.evaluations
      set state = 'failed', failure_category = 'evaluation_failed', completed_at = now()
      where id = ${evaluationId} and state = 'pending'
    `;
  };

  return handler;
}
