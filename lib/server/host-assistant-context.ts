import { createHash } from "node:crypto";
import { z } from "zod";
import type { ModelMessage } from "ai";
import type { Database, Queryable } from "./database";
import { linkedMessagingTurn } from "./channel-selection";
import { authorizeSetupTool, modelProjection, type SetupToolCall } from "./setup-tools";
import { listHostRequests, readHostTimezone } from "./host-requests";
import { listSentRequests } from "./host-sent-requests";
import { requestRef } from "./request-ref";
import { readSetupState, type SetupDependencies } from "./setup";
import { currentTime } from "../contracts/timezone";

export const questionSchema = z.object({
  question: z.string().trim().min(1).max(500),
  direction: z.enum(["received", "sent", "account"]),
  decision: z.enum(["approve", "decline", "cancel", "agree", "change", "withdraw", "choose", "details"]).nullable().default(null),
  ref: z.string().min(1).max(120).nullable(),
  version: z.number().int().positive().nullable(),
  expectedRevision: z.number().int().nonnegative().nullable(),
}).strict().refine(item => item.direction === "account" || Boolean(item.ref), "Request questions require a ref.");
export const memorySchema = z.object({
  text: z.string().trim().min(1).max(500),
  category: z.enum(["tone", "relationship", "priority", "soft_preference", "life_context", "pattern"]),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
}).strict().refine(item => item.category !== "life_context" || item.expiresAt !== null, "Dated life context needs an expiry.");
export type ContextKind = "question" | "deferred" | "memory" | "capture";
export type ContextEntry = { kind: ContextKind; entry_key: string; revision: number; content: unknown; confirmed: boolean; operation_id: string; source_input_id: string | null };
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export async function contextAuthority(q: Queryable, call: SetupToolCall) {
  const actor = await authorizeSetupTool(q, call.auth, call.sessionId, { lock: true });
  const turn = await linkedMessagingTurn(q, call.sessionId, actor.id);
  if (!turn) throw new Error("Private account context requires a current linked host turn.");
  return { actor, turn };
}

export async function readContext(q: Queryable, hostId: string, scope: string): Promise<ContextEntry[]> {
  const rows = await q<ContextEntry[]>`
    select kind, entry_key, revision, content,
      (confirmed and forgotten_at is null and (expires_at is null or expires_at > now())) as confirmed, operation_id, source_input_id
    from app.host_assistant_context
    where host_account_id = ${hostId} and scope_key = ${scope}
      and ((forgotten_at is null and (expires_at is null or expires_at > now())) or (kind = 'question' and entry_key = 'latest'))
      and kind <> 'capture'
    order by created_at, entry_key limit 34
  `;
  return [...rows];
}

export function recalledContext(entries: readonly ContextEntry[]) {
  // Empty values replace previous recall records too: omission cannot retract
  // an eve recall. No unacknowledged staged memory is presented as remembered.
  return {
    questionRevision: entries.find(row => row.kind === "question" && row.entry_key === "latest")?.revision ?? 0,
    ledger: entries.filter(row => row.confirmed && (row.kind === "question" || row.kind === "deferred")),
    memories: entries.filter(row => row.confirmed && row.kind === "memory"),
  };
}

// postgres.js selects the JSONB encoder for this parameter. Pass an object,
// not a pre-stringified JSON string that the driver would encode a second time.
const contextObject = z.record(z.string(), z.json());

export function stagedContext(entries: readonly ContextEntry[], turnId: string | null) {
  return turnId === null ? [] : entries.filter(row => {
    const content = contextObject.safeParse(row.content);
    return !row.confirmed && row.operation_id.startsWith(`${turnId}:`) && content.success && Object.keys(content.data).length > 0;
  });
}

export async function writeContext(db: Database, call: SetupToolCall, scope: string, entry: {
  kind: ContextKind; key: string; expectedRevision: number; content: unknown; operationId: string; expiresAt?: string | null;
}) {
  return db.begin(async tx => {
    const { actor, turn } = await contextAuthority(tx, call);
    // Serialize writes even to different entries; account deletion takes an
    // incompatible account lock and no deleted account can regain context.
    await tx`select pg_advisory_xact_lock(hashtextextended(${actor.id + scope}, 0))`;
    const [existing] = await tx<{ revision: number; operation_id: string; forgotten_at: Date | null }[]>`
      select revision, operation_id, forgotten_at from app.host_assistant_context
      where host_account_id = ${actor.id} and scope_key = ${scope} and kind = ${entry.kind} and entry_key = ${entry.key}
      for update
    `;
    if (existing?.operation_id === entry.operationId) return { saved: existing.forgotten_at === null, revision: existing.revision };
    if ((existing?.revision ?? 0) !== entry.expectedRevision || (existing?.forgotten_at && entry.kind === "memory")) return { saved: false, problem: "stale_revision: list context again" };
    const [{ count } = { count: 0 }] = await tx<{ count: number }[]>`
      select count(*)::int as count from app.host_assistant_context
      where host_account_id = ${actor.id} and scope_key = ${scope} and kind <> 'capture' and forgotten_at is null
        and (expires_at is null or expires_at > now())
    `;
    if (!existing && entry.kind !== "question" && count >= 32) return { saved: false, problem: "Context is full; forget or resolve an item first." };
    const content = tx.json(contextObject.parse(entry.content));
    const [written] = await tx<{ revision: number }[]>`
      insert into app.host_assistant_context (host_account_id, scope_key, kind, entry_key, content, source_input_id, operation_id, expires_at)
      values (${actor.id}, ${scope}, ${entry.kind}, ${entry.key}, ${content}::jsonb, ${turn.inputId}, ${entry.operationId}, ${entry.expiresAt ?? null})
      on conflict (host_account_id, scope_key, kind, entry_key) do update
      set content = excluded.content, source_input_id = excluded.source_input_id, operation_id = excluded.operation_id,
          expires_at = excluded.expires_at, revision = app.host_assistant_context.revision + 1,
          confirmed = false, forgotten_at = null, updated_at = now()
      where app.host_assistant_context.revision = ${entry.expectedRevision}
      returning revision
    `;
    return { saved: Boolean(written), revision: written?.revision };
  });
}

export async function forgetContext(db: Database, call: SetupToolCall, scope: string, key: string, revision: number, kind: "memory" | "question" | "deferred") {
  return db.begin(async tx => {
    const { actor } = await contextAuthority(tx, call);
    const rows = await tx`
      update app.host_assistant_context set content = '{}'::jsonb, forgotten_at = now(), confirmed = false,
        revision = revision + 1, updated_at = now()
      where host_account_id = ${actor.id} and scope_key = ${scope} and kind = ${kind} and entry_key = ${key}
        and revision = ${revision} and forgotten_at is null
    `;
    return { forgotten: rows.count === 1 };
  });
}

export function assistantText(messages: readonly ModelMessage[]) {
  const last = messages.findLast(message => message.role === "assistant");
  if (!last || last.role !== "assistant") return "";
  return typeof last.content === "string" ? last.content : last.content.filter(part => part.type === "text").map(part => part.text).join("\n");
}

export function memoryNotice(text: string, korean: boolean) {
  return korean ? `기억해 둘게요: ${text}` : `I'll remember: ${text}`;
}

export async function captureContext(db: Database, call: SetupToolCall, scope: string, operationId: string, messages: readonly ModelMessage[], turnId: string) {
  await db.begin(async tx => {
    const actor = await authorizeSetupTool(tx, call.auth, call.sessionId, { lock: true });
    const entries = await readContext(tx, actor.id, scope);
    const staged = entries.filter(row => !row.confirmed && row.operation_id.startsWith(`${turnId}:`));
    const [recorded] = await tx`
      insert into app.host_assistant_context (host_account_id, scope_key, kind, entry_key, source_input_id, operation_id, confirmed)
      values (${actor.id}, ${scope}, 'capture', ${digest(operationId)}, ${staged[0]?.source_input_id ?? null}, ${operationId}, true)
      on conflict do nothing returning entry_key
    `;
    if (!recorded) return;
    const reply = assistantText(messages);
    for (const row of staged) {
      const envelope = z.object({ memory: memorySchema, notice: z.string() }).safeParse(row.content);
      const memory = envelope.success ? envelope.data.memory : null;
      const question = questionSchema.safeParse(row.content);
      const deferred = z.object({ text: z.string() }).safeParse(row.content);
      const acknowledged = row.kind === "memory" ? memory !== null && envelope.success && reply.includes(envelope.data.notice)
        : row.kind === "question" ? question.success && reply.includes(question.data.question)
          : deferred.success && reply.includes(deferred.data.text);
      // Unacknowledged writes never become recalled facts; clear their content.
      await tx`
        update app.host_assistant_context set confirmed = ${acknowledged},
          content = ${tx.json(acknowledged ? contextObject.parse(row.content) : {})}::jsonb,
          forgotten_at = ${acknowledged ? null : new Date()}, updated_at = now()
        where host_account_id = ${actor.id} and scope_key = ${scope} and kind = ${row.kind}
          and entry_key = ${row.entry_key} and revision = ${row.revision}
      `;
    }
  });
}

export async function accountSnapshot(deps: SetupDependencies, call: SetupToolCall) {
  const actor = await authorizeSetupTool(deps.db, call.auth, call.sessionId);
  const [received, sent, zone, setup, bookings] = await Promise.all([
    listHostRequests(deps.db, actor.id), listSentRequests(deps.db, actor.id), readHostTimezone(deps.db, actor.id),
    readSetupState(deps, actor.id, { includeCalendars: false }),
    deps.db<{ ref: string; start_at: Date; end_at: Date }[]>`
      select request_id::text as ref, start_at, end_at from app.bookings where host_account_id = ${actor.id}
        and state = 'confirmed' and end_at > now() and start_at < now() + interval '7 days' order by start_at limit 100
    `,
  ]);
  const versions = await deps.db<{ request_id: string; version: number | null; revision: number }[]>`
    select r.id as request_id, r.revision, max(p.version)::int as version from app.requests r
    left join app.proposals p on p.request_id = r.id
    where r.host_account_id = ${actor.id} and r.state <> 'draft' group by r.id
  `;
  return {
    current: currentTime(zone), timezone: zone, setupStep: setup ? modelProjection(setup, true).nextAction : "connect_calendar",
    pending: received.filter(item => item.needsDecision).map(item => ({ ref: requestRef(item.requestId), state: item.state, proposed: item.proposalStart, ...versions.find(row => row.request_id === item.requestId) })),
    bookings: bookings.map(item => ({ ...item, ref: requestRef(item.ref) })),
    sent: sent.map(item => ({ ref: requestRef(item.requestId), state: item.state, proposed: item.proposalStart, booked: item.bookedStart })),
    note: "This bounded snapshot is navigation only. Use list_host_requests/read_request for details and read_schedule for the full requested period.",
  };
}

// Only exact text from this host's current input is eligible. Known request
// data is rejected even if the host quotes it. Calendar titles are additionally
// supplied by the provider's schedule read, never inferred as host preferences.
export function eligibleMemory(text: string, source: string, excluded: readonly string[]) {
  const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase();
  const value = normalize(text);
  return source.includes(text) && !/[\r\n]/u.test(text) && !excluded.some(item => item.trim().length > 1 && value.includes(normalize(item))) &&
    !/https?:\/\/|\S+@\S+|\b(?:never|always|must|only allow|do not offer)\b|절대|항상|금지|예약.*(?:불가|막아)|(?:하지|잡지)\s*마/iu.test(text);
}
