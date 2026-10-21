import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { REQUEST_LANGUAGES, type RequestLanguage, type RequestWindow } from "../contracts/request";
import { MEETING_MODES, type MeetingMode } from "../contracts/setup";
import { isValidTimeZone } from "../contracts/timezone";
import type { Database, Queryable, Transaction } from "./database";
import { resolveLocalTime } from "./feasibility";
import { readReadiness } from "./readiness";

// The anonymous public intake (design decision 2; meeting-requests: anonymous
// intake conversation). A visitor's first message on a ready host's /{handle}
// creates an intake: a random token the page keeps in sessionStorage for its
// tab (only its hash is stored), a public_intake discussion and a draft of what
// the visitor described. The intake lasts 24 hours, accepts 30 messages, and
// ends when the visitor continues with or without Google, which creates at most
// one request from it. New intakes are bounded per keyed source address.

export const INTAKE_LIMITS = {
  perSourceHour: 5,
  perSourceDay: 20,
  // Messages one intake accepts before the visitor continues.
  messages: 30,
} as const;

export type IntakeLimits = { readonly [Key in keyof typeof INTAKE_LIMITS]: number };

export class IntakeLimitError extends Error {
  readonly bound: "source" | "messages";

  constructor(bound: "source" | "messages") {
    super(`The intake ${bound} bound is reached.`);
    this.name = "IntakeLimitError";
    this.bound = bound;
  }
}

// The host is not ready (or not active) any more, or the intake is closed,
// expired or unknown: every case gets the same neutral answer.
export class IntakeUnavailableError extends Error {
  constructor() {
    super("This intake is not available.");
    this.name = "IntakeUnavailableError";
  }
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function isIntakeToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

export function hashIntakeToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// The draft

// A window as the visitor states it: a local date and clock times in the
// intake's timezone. An end at or before the start ends on the next day.
export const localWindowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export type LocalWindow = z.infer<typeof localWindowSchema>;

// What draft_intake may record. Each field replaces the drafted one; windows
// replace the drafted list as a whole.
export const intakeDraftPatchSchema = z
  .object({
    purpose: z.string().trim().min(1).max(500).optional(),
    durationMinutes: z.number().int().min(5).max(480).optional(),
    mode: z.enum(MEETING_MODES).optional(),
    location: z.string().trim().min(1).max(300).optional(),
    windows: z.array(localWindowSchema).min(1).max(10).optional(),
  })
  .strict();

export type IntakeDraftPatch = z.infer<typeof intakeDraftPatchSchema>;

// app.intakes.draft.
export type IntakeDraft = {
  readonly purpose?: string;
  readonly durationMinutes?: number;
  readonly mode?: MeetingMode;
  readonly location?: string;
  readonly windows?: readonly RequestWindow[];
  readonly timezone?: string;
  readonly language?: RequestLanguage;
};

export type WindowProblem = "ambiguous_local_time" | "past_window" | "too_short" | "invalid_date";

function addDay(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
}

// A local window as instants in the zone. A clock time that a daylight-saving
// change repeats or skips on that date is ambiguous_local_time, never guessed.
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

export type DraftOutcome =
  | { readonly recorded: true; readonly draft: IntakeDraft }
  | { readonly recorded: false; readonly problem: WindowProblem; readonly window: LocalWindow };

// Applies a patch to a draft, converting windows in the draft's timezone. Any
// window that cannot be resolved records nothing.
export function applyDraftPatch(draft: IntakeDraft, patch: IntakeDraftPatch, now: number): DraftOutcome {
  const timeZone = draft.timezone && isValidTimeZone(draft.timezone) ? draft.timezone : "UTC";
  const durationMinutes = patch.durationMinutes ?? draft.durationMinutes;
  let windows = draft.windows;

  if (patch.windows) {
    const resolved: RequestWindow[] = [];

    for (const local of patch.windows) {
      const outcome = resolveLocalWindow(local, timeZone, { durationMinutes, now });
      if (!outcome.ok) return { problem: outcome.problem, recorded: false, window: local };
      resolved.push(outcome.window);
    }

    windows = resolved.sort((a, b) => a.start.localeCompare(b.start));
  }

  const { windows: _windows, ...fields } = patch;
  return { draft: { ...draft, ...fields, ...(windows ? { windows } : {}) }, recorded: true };
}

// The drafted meeting fields the request's first review carries (the review
// patch shape: RequestDetails keys), or null when nothing was drafted.
export function draftReviewPatch(draft: IntakeDraft) {
  const patch: Record<string, unknown> = {};

  if (draft.purpose) patch.purpose = draft.purpose;
  if (draft.durationMinutes) patch.durationMinutes = draft.durationMinutes;
  if (draft.mode) patch.mode = draft.mode;
  if (draft.location) patch.location = draft.location;
  if (draft.windows?.length) patch.windows = draft.windows;

  return Object.keys(patch).length > 0 ? patch : null;
}

const languageSchema = z.enum(REQUEST_LANGUAGES);

export function normalizeLanguage(value: unknown): RequestLanguage | undefined {
  const parsed = languageSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

// ---------------------------------------------------------------------------
// Records

export type IntakeRow = {
  readonly id: string;
  readonly host_account_id: string;
  readonly discussion_id: string;
  readonly token_hash: string;
  readonly draft: IntakeDraft;
  readonly request_id: string | null;
  readonly open: boolean;
};

// The intake a tab's token names on this host, or null for any other token.
export async function findIntake(db: Queryable, hostAccountId: string, token: string): Promise<IntakeRow | null> {
  if (!isIntakeToken(token)) return null;

  const [row] = await db<IntakeRow[]>`
    select id, host_account_id, discussion_id, token_hash, draft, request_id,
           closed_at is null and expires_at > now() as open
    from app.intakes
    where token_hash = ${hashIntakeToken(token)} and host_account_id = ${hostAccountId}
  `;
  return row ?? null;
}

// Locks an open intake of a ready host, or throws IntakeUnavailableError.
export async function lockOpenIntake(tx: Transaction, intakeId: string) {
  const [row] = await tx<IntakeRow[]>`
    select id, host_account_id, discussion_id, token_hash, draft, request_id,
           closed_at is null and expires_at > now() as open
    from app.intakes where id = ${intakeId}
    for update
  `;

  if (!row?.open) throw new IntakeUnavailableError();
  return row;
}

// Whether the host can take requests now, with its account row share-locked so
// a suspension waits for the caller's transaction.
export async function hostAcceptsRequests(tx: Transaction, hostAccountId: string) {
  const [account] = await tx<{ status: string }[]>`
    select status from app.host_accounts where id = ${hostAccountId} for share
  `;

  if (account?.status !== "active") return false;
  return (await readReadiness(tx, hostAccountId)).ready;
}

// Creates an intake for a ready host within the per-source bounds, with its
// discussion, and returns the token once.
export async function createIntake(
  db: Database,
  input: {
    readonly hostAccountId: string;
    readonly sourceHash: string;
    readonly draft?: IntakeDraft;
    readonly limits?: Partial<IntakeLimits>;
  },
) {
  const limits = { ...INTAKE_LIMITS, ...input.limits };
  const token = randomBytes(32).toString("base64url");
  const intakeId = randomUUID();

  return (await db.begin(async (tx) => {
    if (!(await hostAcceptsRequests(tx, input.hostAccountId))) throw new IntakeUnavailableError();

    await tx`select pg_advisory_xact_lock(hashtextextended(${`app.intake_source:${input.sourceHash}`}, 0))`;
    const [counts] = await tx<{ day: number; hour: number }[]>`
      select count(*)::int as day, count(*) filter (where created_at > now() - interval '1 hour')::int as hour
      from app.intakes
      where source_hash = ${input.sourceHash} and created_at > now() - interval '24 hours'
    `;

    if (counts!.hour >= limits.perSourceHour || counts!.day >= limits.perSourceDay) {
      throw new IntakeLimitError("source");
    }

    const [discussion] = await tx<{ id: string }[]>`
      insert into app.discussions (principal_type, principal_id, audience)
      values ('public_intake', ${intakeId}, 'public_intake')
      returning id
    `;
    await tx`
      insert into app.intakes (id, host_account_id, token_hash, source_hash, discussion_id, draft)
      values (${intakeId}, ${input.hostAccountId}, ${hashIntakeToken(token)}, ${input.sourceHash}, ${discussion!.id},
              ${tx.json((input.draft ?? {}) as Parameters<typeof tx.json>[0])})
    `;

    return { discussionId: discussion!.id, intakeId, token };
  })) as { discussionId: string; intakeId: string; token: string };
}

// Records the browser's timezone and language on the draft, as the visitor's
// tab reports them with each message; an invalid zone is ignored.
export async function noteIntakeContext(
  tx: Transaction,
  intakeId: string,
  context: { readonly timezone?: string; readonly language?: RequestLanguage },
) {
  const patch: Record<string, string> = {};

  if (context.timezone && isValidTimeZone(context.timezone)) patch.timezone = context.timezone;
  if (context.language) patch.language = context.language;
  if (Object.keys(patch).length === 0) return;

  await tx`update app.intakes set draft = draft || ${tx.json(patch)} where id = ${intakeId}`;
}
