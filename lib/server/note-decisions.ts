import { z } from "zod";
import { lockActiveHost } from "./analysis";
import { type CommandDefinition, CommandError } from "./commands";
import type { Queryable, Transaction } from "./database";
import type { NoteExclusion } from "./feasibility";
import {
  CalendarAccessError,
  type GoogleCalendarConfig,
  googleCalendarConfigFromEnvironment,
  type HostCalendar,
  openHostCalendar,
} from "./google-calendar";
import { type ClaimedJob, type JobHandler, publishJob } from "./jobs";
import { type NoteAnswerScope, withNoteExclusion, withoutNoteExclusion } from "./note-answers";
import { type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// The host's note decisions (calendar-note-review design 3 to 6). A decision is
// its own host action, applied when the host confirms it, during onboarding or
// after it; a classifier verdict never reaches here.
//
// - free, on a calendar the host can write (owner or writer): recorded as
//   pending with a writeback job in the same transaction. The job patches the
//   event's transparency to transparent in Google and marks the row done with
//   Google's updated time. Until then the time stays busy.
// - free, on a calendar the host cannot change: recorded as not_writable and
//   written to the confirmed settings' note exclusions; Google is not called.
// - keep busy: remembered. When it undoes a freed entry, the same job patches the
//   event back to opaque, or the note exclusion is removed.
//
// The series scope decides the event recurringEventId names, so every occurrence
// follows; the occurrence scope decides that one occurrence.

export const NOTE_WRITEBACK_JOB = "calendar_note_writeback";

export type NoteDecision = "free" | "keep_busy";
export type NoteWritebackState = "pending" | "done" | "failed" | "not_writable";

// Why a writeback failed, shown to the host with a retry.
export type NoteWritebackFailure = "calendar_rejected" | "calendar_access_revoked" | "writeback_unavailable";

const WRITABLE_ROLES = new Set(["owner", "writer"]);

export const noteDecisionItemSchema = z
  .object({
    calendarId: z.string().min(1).max(1024),
    // The occurrence the host saw.
    eventId: z.string().min(1).max(1024),
    // Its series (Google's recurringEventId), when it repeats.
    seriesId: z.string().min(1).max(1024).nullable(),
    scope: z.enum(["series", "occurrence"]),
    // The updated time of what the host saw; for a series, the latest one of the
    // occurrences shown, so none of them is asked about again.
    fingerprint: z.string().max(100),
    decision: z.enum(["free", "keep_busy"]),
    end: z.string().max(40).nullable().optional(),
  })
  .strict()
  .refine((item) => item.scope === "occurrence" || item.seriesId !== null, { message: "A series decision needs its series." });

export type NoteDecisionItem = z.infer<typeof noteDecisionItemSchema>;

export type RecordedNoteDecision = {
  readonly id: string;
  readonly calendarId: string;
  readonly eventId: string;
  readonly scope: NoteAnswerScope;
  readonly decision: NoteDecision;
  readonly writebackState: NoteWritebackState | null;
  readonly revision: number;
};

type DecisionRow = {
  id: string;
  calendar_id: string;
  event_id: string;
  scope: NoteAnswerScope;
  fingerprint: string;
  decision: NoteDecision;
  writeback_state: NoteWritebackState | null;
  writeback_failure: NoteWritebackFailure | null;
  event_end: string | null;
  revision: number;
};

function recorded(row: DecisionRow): RecordedNoteDecision {
  return {
    calendarId: row.calendar_id,
    decision: row.decision,
    eventId: row.event_id,
    id: row.id,
    revision: row.revision,
    scope: row.scope,
    writebackState: row.writeback_state,
  };
}

// Serializes a host's decisions with each other and with Confirm and save, which
// copies the note exclusions of not_writable decisions into the settings it
// writes. Taken after the account lock and setup's own locks.
export async function lockNoteDecisions(tx: Transaction, hostAccountId: string) {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`app.calendar_note_decisions:${hostAccountId}`}, 0))`;
}

// The note exclusion a not_writable free decision stands for.
function exclusionOf(row: Pick<DecisionRow, "calendar_id" | "event_id" | "fingerprint" | "scope" | "event_end">): NoteExclusion {
  return {
    calendarId: row.calendar_id,
    eventId: row.event_id,
    fingerprint: row.fingerprint,
    ...(row.scope === "series" ? { scope: "series" as const } : {}),
    ...(row.event_end ? { end: row.event_end } : {}),
  };
}

// The exclusions Confirm and save adds to the settings it writes, so a decision
// made before or between confirmations is kept. The caller holds lockNoteDecisions.
export async function withNoteDecisionExclusions(db: Queryable, hostAccountId: string, exclusions: readonly NoteExclusion[], now = new Date()) {
  const rows = await db<DecisionRow[]>`
    select calendar_id, event_id, scope, fingerprint, event_end from app.calendar_note_decisions
    where host_account_id = ${hostAccountId} and writeback_state = 'not_writable'
    order by updated_at, id
  `;
  return rows.reduce<NoteExclusion[]>((list, row) => withNoteExclusion(list, exclusionOf(row), now), [...exclusions]);
}

// Applies one change to the confirmed settings' note exclusions, when the host
// has confirmed settings; before that, Confirm and save adds them.
async function updateSettingsExclusions(tx: Transaction, hostAccountId: string, change: (list: NoteExclusion[]) => NoteExclusion[]) {
  const [settings] = await tx<{ exclusions: NoteExclusion[] | null }[]>`
    select settings -> 'noteExclusions' as exclusions from app.host_settings
    where host_account_id = ${hostAccountId} for update
  `;
  if (!settings) return;
  const next = change(Array.isArray(settings.exclusions) ? settings.exclusions : []);
  await tx`
    update app.host_settings
    set settings = jsonb_set(settings, '{noteExclusions}', ${tx.json(next as unknown as Parameters<typeof tx.json>[0])}), updated_at = now()
    where host_account_id = ${hostAccountId}
  `;
}

async function publishWriteback(tx: Transaction, row: Pick<DecisionRow, "id" | "revision">) {
  await publishJob(tx, {
    dedupeKey: `${NOTE_WRITEBACK_JOB}:${row.id}:${row.revision}`,
    kind: NOTE_WRITEBACK_JOB,
    payload: { decisionId: row.id, revision: row.revision },
  });
}

// Records the host's decisions in the caller's transaction, after lockActiveHost.
// Each item's calendar must be one of the host's conflict calendars. Repeating a
// decision that already stands, with the same fingerprint, changes nothing; a
// failed writeback is retried by deciding again or by retryNoteWriteback.
export async function recordNoteDecisions(
  tx: Transaction,
  hostAccountId: string,
  items: readonly NoteDecisionItem[],
  now = new Date(),
): Promise<RecordedNoteDecision[]> {
  await lockNoteDecisions(tx, hostAccountId);
  const [roles] = await tx<{ conflict_calendars: { id: string; accessRole?: string }[] }[]>`
    select conflict_calendars from app.calendar_roles where host_account_id = ${hostAccountId}
  `;
  const accessRoles = new Map((roles?.conflict_calendars ?? []).map((calendar) => [calendar.id, calendar.accessRole ?? ""]));
  const results: RecordedNoteDecision[] = [];

  for (const item of items) {
    if (!accessRoles.has(item.calendarId)) throw new CommandError("invalid_input");
    const writable = WRITABLE_ROLES.has(accessRoles.get(item.calendarId)!);
    const eventId = item.scope === "series" ? item.seriesId! : item.eventId;
    const [previous] = await tx<DecisionRow[]>`
      select * from app.calendar_note_decisions
      where host_account_id = ${hostAccountId} and calendar_id = ${item.calendarId} and event_id = ${eventId}
      for update
    `;

    if (
      previous &&
      previous.scope === item.scope &&
      previous.decision === item.decision &&
      previous.fingerprint === item.fingerprint &&
      previous.writeback_state !== "failed"
    ) {
      results.push(recorded(previous));
      continue;
    }

    const freedInGoogle = previous?.decision === "free" && previous.writeback_state !== "not_writable";
    const state: NoteWritebackState | null =
      item.decision === "free" ? (writable ? "pending" : "not_writable") : freedInGoogle && writable ? "pending" : null;
    const [row] = await tx<DecisionRow[]>`
      insert into app.calendar_note_decisions as stored
        (host_account_id, calendar_id, event_id, scope, fingerprint, decision, writeback_state, event_end)
      values (${hostAccountId}, ${item.calendarId}, ${eventId}, ${item.scope}, ${item.fingerprint}, ${item.decision},
              ${state}, ${item.end ?? null})
      on conflict (host_account_id, calendar_id, event_id) do update set
        scope = excluded.scope, fingerprint = excluded.fingerprint, decision = excluded.decision,
        writeback_state = excluded.writeback_state, writeback_failure = null, event_end = excluded.event_end,
        revision = stored.revision + 1, updated_at = now()
      returning *
    `;

    if (state === "pending") await publishWriteback(tx, row!);
    if (state === "not_writable") await updateSettingsExclusions(tx, hostAccountId, (list) => withNoteExclusion(list, exclusionOf(row!), now));
    else if (previous?.writeback_state === "not_writable") {
      await updateSettingsExclusions(tx, hostAccountId, (list) => withoutNoteExclusion(list, item.calendarId, eventId));
    }
    results.push(recorded(row!));
  }

  return results;
}

// Retries a failed writeback with a new revision.
export async function retryNoteWriteback(tx: Transaction, hostAccountId: string, decisionId: string): Promise<RecordedNoteDecision> {
  await lockNoteDecisions(tx, hostAccountId);
  const [row] = await tx<DecisionRow[]>`
    update app.calendar_note_decisions
    set writeback_state = 'pending', writeback_failure = null, revision = revision + 1, updated_at = now()
    where id = ${decisionId} and host_account_id = ${hostAccountId} and writeback_state = 'failed'
    returning *
  `;
  if (!row) throw new CommandError("stale_revision");
  await publishWriteback(tx, row);
  return recorded(row);
}

// The host's decisions with their writeback state, for the review and settings.
export async function readNoteDecisions(db: Queryable, hostAccountId: string) {
  const rows = await db<(DecisionRow & { updated_at: Date })[]>`
    select * from app.calendar_note_decisions where host_account_id = ${hostAccountId} order by updated_at desc, id
  `;
  return rows.map((row) => ({
    ...recorded(row),
    fingerprint: row.fingerprint,
    updatedAt: row.updated_at.toISOString(),
    writebackFailure: row.writeback_failure,
  }));
}

export const decideNotesCommand: CommandDefinition<{ items: NoteDecisionItem[] }, { decisions: RecordedNoteDecision[] }> = {
  input: z.object({ items: z.array(noteDecisionItemSchema).min(1).max(100) }).strict() as z.ZodType<{ items: NoteDecisionItem[] }>,
  operation: "notes.decide",
  async run(tx, context) {
    await lockActiveHost(tx, context.actor.id);
    return { decisions: await recordNoteDecisions(tx, context.actor.id, context.input.items) };
  },
};

export const retryNoteWritebackCommand: CommandDefinition<{ decisionId: string }, { decision: RecordedNoteDecision }> = {
  input: z.object({ decisionId: z.string().uuid() }).strict(),
  operation: "notes.retry_writeback",
  async run(tx, context) {
    await lockActiveHost(tx, context.actor.id);
    return { decision: await retryNoteWriteback(tx, context.actor.id, context.input.decisionId) };
  },
};

// ---------------------------------------------------------------------------
// The writeback job

export type NoteWritebackDependencies = {
  readonly tokenKeys: readonly TokenKey[];
  readonly config: GoogleCalendarConfig;
  // A stand-in client for tests; the stored grant opens the real one.
  readonly calendar?: (hostAccountId: string) => Promise<HostCalendar>;
};

function writebackDependenciesFromEnvironment(): NoteWritebackDependencies {
  return { config: googleCalendarConfigFromEnvironment(), tokenKeys: [tokenKeyFromEnvironment()] };
}

// A transient failure: the job runner retries the attempt after its backoff.
class NoteWritebackUnavailable extends Error {}

async function fail(tx: Transaction, decisionId: string, revision: number, failure: NoteWritebackFailure) {
  await tx`
    update app.calendar_note_decisions
    set writeback_state = 'failed', writeback_failure = ${failure}, updated_at = now()
    where id = ${decisionId} and revision = ${revision} and writeback_state = 'pending'
  `;
  return { state: "failed", failure };
}

// Runs one writeback. A job published for an older revision, or one whose row is
// no longer pending (done, or replaced by a newer decision), changes nothing, so a
// replayed or superseded job never patches again. Google's refusal (400, 403, 404,
// 410) and a revoked grant fail the row; a timeout, a rate limit or a 5xx throws,
// so the runner retries, and an exhausted retry fails the row. The time stays
// busy for guests until the row is done, because only Google's transparency (or a
// note exclusion) frees it.
export function createNoteWritebackHandler(load: () => NoteWritebackDependencies = writebackDependenciesFromEnvironment): JobHandler {
  const handler: JobHandler = async (tx: Transaction, job: ClaimedJob) => {
    const decisionId = typeof job.payload.decisionId === "string" ? job.payload.decisionId : null;
    const revision = typeof job.payload.revision === "number" ? job.payload.revision : null;
    const [row] = decisionId
      ? await tx<(DecisionRow & { host_account_id: string })[]>`
          select * from app.calendar_note_decisions where id = ${decisionId} for update
        `
      : [];

    if (!row || row.revision !== revision || row.writeback_state !== "pending") return { skipped: true };

    const deps = load();
    let calendar: HostCalendar;
    try {
      calendar = deps.calendar
        ? await deps.calendar(row.host_account_id)
        : await openHostCalendar({ config: deps.config, db: tx, tokenKeys: deps.tokenKeys }, row.host_account_id);
    } catch (error) {
      if (error instanceof CalendarAccessError && error.category !== "calendar_unavailable") {
        return fail(tx, row.id, row.revision, "calendar_access_revoked");
      }
      throw new NoteWritebackUnavailable("Google Calendar could not be opened", { cause: error });
    }

    const transparency = row.decision === "free" ? "transparent" : "opaque";
    let outcome: Awaited<ReturnType<HostCalendar["patchTransparency"]>>;
    try {
      outcome = await calendar.patchTransparency(row.calendar_id, row.event_id, transparency);
    } catch (error) {
      if (error instanceof CalendarAccessError && error.category !== "calendar_unavailable") {
        return fail(tx, row.id, row.revision, "calendar_access_revoked");
      }
      throw new NoteWritebackUnavailable("Google Calendar could not be changed", { cause: error });
    }

    if (outcome.outcome === "rejected") return fail(tx, row.id, row.revision, "calendar_rejected");
    if (outcome.outcome === "uncertain") throw new NoteWritebackUnavailable(`Google Calendar answered ${outcome.httpStatus ?? "nothing"}`);

    // Google's updated time after our own change is the new fingerprint, so the
    // change does not make the entry look edited.
    const fingerprint = outcome.updated && outcome.updated.length <= 100 ? outcome.updated : row.fingerprint;
    await tx`
      update app.calendar_note_decisions
      set writeback_state = 'done', fingerprint = ${fingerprint}, updated_at = now()
      where id = ${row.id}
    `;
    return { state: "done", transparency };
  };

  handler.onExhausted = async (tx, job) => {
    const decisionId = typeof job.payload.decisionId === "string" ? job.payload.decisionId : null;
    const revision = typeof job.payload.revision === "number" ? job.payload.revision : null;
    if (decisionId && revision !== null) await fail(tx, decisionId, revision, "writeback_unavailable");
  };

  return handler;
}
