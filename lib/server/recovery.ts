import { isCurrentTurnBoundaryEvent, type MessageStreamEvent } from "eve/client";
import {
  AGENT_VERSION,
  type ConversationDependencies,
  deliverNext,
  latestSession,
  lockSetupDiscussion,
  type SessionRow,
} from "./conversations";
import type { DiscussionEvent } from "../contracts/discussion-events";
import type { Database } from "./database";
import { HostIneligibleError, readHostStanding, withEligibleHost } from "./host-eligibility";
import { signInternalBearer } from "./internal-bearer";
import { sessionIdHash } from "./model-limits";

// Discussion history across runtime generations, and explicit terminal recovery
// (conversation-access: explicit terminal runtime recovery; recovery fences
// retired execution; recovery preserves accepted work and history).
//
// A discussion's cursor counts events across its generations in order: a retired
// generation contributes its stored events (copied when it was retired), and the
// current generation continues from there. A cursor taken before recovery stays
// meaningful afterwards, and no raw runtime session ID reaches the browser.

async function findSetupDiscussion(db: Database, hostAccountId: string) {
  const [row] = await db<{ id: string }[]>`
    select id from app.discussions
    where principal_type = 'host_account' and principal_id = ${hostAccountId} and audience = 'host_setup'
  `;
  return row?.id ?? null;
}

async function eligibleHost(db: Database, authUserId: string) {
  const standing = await readHostStanding(db, authUserId);

  if (!standing.eligible || !standing.hostAccountId) {
    throw new HostIneligibleError(standing.nextAction ?? "sign_in");
  }

  return standing.hostAccountId;
}

const FAILURE_EVENTS = new Set(["step.failed", "turn.failed", "session.failed"]);

// Provider error details never reach the browser.
export function audienceSafe(event: MessageStreamEvent): MessageStreamEvent {
  if (!FAILURE_EVENTS.has(event.type) || !("data" in event)) return event;

  const { details: _details, ...data } = event.data as Record<string, unknown>;
  return { ...event, data: { ...data, message: "The assistant could not finish this reply." } } as MessageStreamEvent;
}

export type ConversationStatus = {
  readonly generation: number | null;
  readonly state: "none" | "active" | "failed";
  readonly pendingInputs: number;
};

export async function conversationStatus(db: Database, authUserId: string): Promise<ConversationStatus> {
  const hostAccountId = await eligibleHost(db, authUserId);
  const discussionId = await findSetupDiscussion(db, hostAccountId);
  const latest = discussionId ? await latestSession(db, discussionId) : null;

  if (!discussionId || !latest) {
    return { generation: null, pendingInputs: 0, state: "none" };
  }

  const [pending] = await db<{ count: number }[]>`
    select count(*)::int as count from app.conversation_inputs
    where discussion_id = ${discussionId} and state <> 'completed'
  `;

  return {
    generation: latest.generation,
    pendingInputs: pending!.count,
    state: latest.state === "failed" ? "failed" : "active",
  };
}

// How long a received message waits for its receipt while a re-sent input's
// receipt is still uncommitted: the session-owner hook records it just after eve
// records the event, so a live reader can see the event first.
const RECEIPT_WAIT_MS = 2_000;

// Recognizes inputs recovery sent again. Each delivery ID maps to its input;
// the first message.received of an input is shown, and a later one (in a
// successor generation) is the re-sent copy.
async function redeliveryFilter(db: Database, discussionId: string) {
  const inputOf = new Map<string, string>();
  const remember = (inputs: readonly { id: string; delivery_ids: string[] }[]) => {
    for (const input of inputs) for (const id of input.delivery_ids) inputOf.set(id, input.id);
  };
  remember(await db<{ id: string; delivery_ids: string[] }[]>`
    select id, delivery_ids from app.conversation_inputs
    where discussion_id = ${discussionId} and cardinality(delivery_ids) > 1
  `);
  const shown = new Set<string>();

  // Looks up delivery IDs not seen yet, waiting briefly while an input that was
  // delivered before is in flight with its new receipt unrecorded.
  const lookUp = async (deliveryIds: readonly string[]) => {
    const deadline = Date.now() + RECEIPT_WAIT_MS;

    for (;;) {
      const found = await db<{ id: string; delivery_ids: string[] }[]>`
        select id, delivery_ids from app.conversation_inputs
        where discussion_id = ${discussionId} and delivery_ids && ${deliveryIds as string[]}::text[]
      `;
      remember(found);

      if (found.length > 0 || Date.now() >= deadline) return;

      const [unrecorded] = await db<{ found: boolean }[]>`
        select true as found from app.conversation_inputs
        where discussion_id = ${discussionId} and state = 'sent' and cardinality(delivery_ids) > 0
          and received_session_id is distinct from session_id
        limit 1
      `;

      if (!unrecorded) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };

  return async (event: MessageStreamEvent): Promise<DiscussionEvent> => {
    if (event.type !== "message.received") return event;

    const deliveryIds = event.meta.deliveryIds ?? [];

    if (deliveryIds.length > 0 && !deliveryIds.some((id) => inputOf.has(id))) await lookUp(deliveryIds);

    const ids = deliveryIds.flatMap((id) => inputOf.get(id) ?? []);

    if (ids.length > 0 && ids.every((id) => shown.has(id))) {
      return { data: {}, meta: event.meta, type: "app.input.redelivered" };
    }

    for (const id of ids) shown.add(id);
    return event;
  };
}

// Events of the host's discussion from `cursor`. With `follow`, the current
// generation is followed to the end of its current turn.
export async function* discussionEvents(
  deps: Pick<ConversationDependencies, "db" | "runtime">,
  authUserId: string,
  cookie: string,
  cursor: number,
  options: { readonly follow: boolean; readonly signal?: AbortSignal; readonly idleMs?: number },
): AsyncGenerator<DiscussionEvent> {
  const hostAccountId = await eligibleHost(deps.db, authUserId);
  const discussionId = await findSetupDiscussion(deps.db, hostAccountId);

  if (!discussionId) return;

  yield* eventsOfDiscussion(
    deps.db,
    discussionId,
    (session, read) => deps.runtime.readEvents(session.session_id, cookie, read),
    cursor,
    options,
  );
}

// Reads one live generation's recorded events, from a start index, following or not.
export type GenerationReader = (
  session: Pick<SessionRow, "session_id" | "discussion_id" | "generation" | "principal_id" | "principal_type">,
  options: { readonly startIndex: number; readonly follow: boolean; readonly signal: AbortSignal },
) => AsyncIterable<MessageStreamEvent>;

// Events of any discussion from `cursor`, across its generations: retired ones
// from their stored copies, the live one through `read`, which carries the
// caller's own credential for the runtime (a host's cookie, or an internal read
// bearer for a requester or intake). With `follow`, the current generation is
// followed to the end of its current turn.
export async function* eventsOfDiscussion(
  db: ConversationDependencies["db"],
  discussionId: string,
  read: GenerationReader,
  cursor: number,
  options: { readonly follow: boolean; readonly signal?: AbortSignal; readonly idleMs?: number },
): AsyncGenerator<DiscussionEvent> {
  const sessions = await db<
    Pick<SessionRow, "session_id" | "state" | "last_stream_index" | "discussion_id" | "generation" | "principal_id" | "principal_type">[]
  >`
    select session_id, state, last_stream_index, discussion_id, generation, principal_id, principal_type
    from app.agent_sessions
    where discussion_id = ${discussionId}
    order by generation
  `;
  const served = await redeliveryFilter(db, discussionId);
  let offset = 0;

  for (const session of sessions) {
    if (session.state === "retired") {
      const count = session.last_stream_index ?? 0;
      // Earlier received messages are read even behind the cursor, so a re-sent
      // input is recognized wherever reading starts.
      const stored = await db<{ event: MessageStreamEvent; stream_index: number }[]>`
        select event, stream_index from app.agent_session_events
        where session_id = ${session.session_id}
          and (stream_index >= ${cursor - offset} or event->>'type' = 'message.received')
        order by stream_index
      `;

      for (const row of stored) {
        const event = await served(audienceSafe(row.event));
        if (row.stream_index >= cursor - offset) yield event;
      }

      offset += count;
      continue;
    }

    // Following ends at the current turn's boundary, or when the runtime stays
    // silent for the idle bound: an idle session may have no turn coming.
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const events = read(session, {
      follow: options.follow,
      signal,
      startIndex: Math.max(0, cursor - offset),
    })[Symbol.asyncIterator]();

    try {
      for (;;) {
        const next = options.follow
          ? await withinIdleBound(events.next(), options.idleMs ?? FOLLOW_IDLE_MS)
          : await events.next();

        if (next === "idle" || next.done) return;
        yield await served(audienceSafe(next.value));
        if (options.follow && isCurrentTurnBoundaryEvent(next.value)) return;
      }
    } finally {
      controller.abort();
      await events.return?.().catch(() => {});
    }
  }
}

// How long a followed stream may stay silent before following ends.
export const FOLLOW_IDLE_MS = 60_000;

async function withinIdleBound<T>(next: Promise<T>, ms: number): Promise<T | "idle"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = new Promise<"idle">((resolve) => (timer = setTimeout(() => resolve("idle"), ms)));
  next.catch(() => {});

  try {
    return await Promise.race([next, idle]);
  } finally {
    clearTimeout(timer);
  }
}

// Delivers the discussion's oldest undelivered input to its live generation with
// its original identity; the rest follow one turn at a time. True when a turn is
// coming for the browser to follow: an input is now in flight.
async function deliverPending(deps: ConversationDependencies, hostAccountId: string, discussionId: string) {
  try {
    await deliverNext(deps, hostAccountId, discussionId);
  } catch {
    // Left accepted for the next retry.
  }

  const [inFlight] = await deps.db<{ found: boolean }[]>`
    select true as found from app.conversation_inputs i
    join app.agent_sessions s on s.session_id = i.session_id and s.state = 'active'
    where i.discussion_id = ${discussionId} and i.state = 'sent'
    limit 1
  `;
  return Boolean(inFlight);
}

export type RecoveryOutcome =
  // delivered: an input is in flight on the successor, so a turn is coming.
  | { readonly status: "recovered"; readonly generation: number; readonly delivered: boolean }
  // The observed generation is not the current one.
  | { readonly status: "stale"; readonly generation: number | null }
  // The runtime gave no terminal evidence: active, not failed, or uncertain.
  | { readonly status: "not_failed" }
  // The runtime could not be inspected in time.
  | { readonly status: "unavailable" };

// Reads a session's whole recorded stream, or fails when it does not finish in time.
async function inspect(runtime: ConversationDependencies["runtime"], sessionId: string, cookie: string, ms: number) {
  const controller = new AbortController();
  const expired = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error("Runtime inspection timed out.")));
  });
  const timer = setTimeout(() => controller.abort(), ms);
  const collected = (async () => {
    const events: MessageStreamEvent[] = [];
    for await (const event of runtime.readEvents(sessionId, cookie, { follow: false, signal: controller.signal, startIndex: 0 })) {
      events.push(event);
    }
    return events;
  })();
  collected.catch(() => {});

  try {
    return await Promise.race([collected, expired]);
  } finally {
    clearTimeout(timer);
  }
}

function hasTerminalEvidence(events: readonly MessageStreamEvent[]) {
  return events.some(
    (event) =>
      event.type === "session.failed" ||
      (event.type === "turn.failed" && (event.data as { terminal?: boolean }).terminal === true),
  );
}

type Settled =
  | { readonly status: "recovered"; readonly generation: number }
  | Exclude<RecoveryOutcome, { readonly status: "recovered" }>;

function settled(latest: SessionRow | null, observedGeneration: number): Settled | null {
  if (!latest) return { generation: null, status: "stale" };
  if (latest.generation === observedGeneration + 1) return { generation: latest.generation, status: "recovered" };
  if (latest.generation !== observedGeneration) return { generation: latest.generation, status: "stale" };
  return null;
}

// POST /api/chat/recover: replaces a confirmed failed generation with at most one
// successor for the same discussion. The recovery identity is the discussion and
// the observed generation, so an exact retry returns the transition's status.
export async function recoverDiscussion(
  deps: ConversationDependencies,
  authUserId: string,
  cookie: string,
  observedGeneration: number,
  options: { readonly inspectTimeoutMs?: number } = {},
): Promise<RecoveryOutcome> {
  const hostAccountId = await eligibleHost(deps.db, authUserId);
  const discussionId = await findSetupDiscussion(deps.db, hostAccountId);
  const observed = discussionId ? await latestSession(deps.db, discussionId) : null;
  const early = settled(observed, observedGeneration);

  // After a transition, an exact retry delivers what the first attempt could not.
  const answer = async (outcome: Settled): Promise<RecoveryOutcome> =>
    outcome.status === "recovered"
      ? { ...outcome, delivered: await deliverPending(deps, hostAccountId, discussionId!) }
      : outcome;

  if (early) return answer(early);

  // Terminal evidence comes from the runtime's own record, which also covers a
  // failure recorded before the session-owner hook existed.
  let recorded: MessageStreamEvent[];

  try {
    recorded = await inspect(deps.runtime, observed!.session_id, cookie, options.inspectTimeoutMs ?? 10_000);
  } catch {
    return { status: "unavailable" };
  }

  if (!hasTerminalEvidence(recorded)) {
    return { status: "not_failed" };
  }

  const generation = observedGeneration + 1;
  let successorId: string;

  try {
    successorId = await deps.runtime.createSession(
      signInternalBearer(
        { discussionId: discussionId!, generation, kind: "create", principal: { id: hostAccountId, type: "host_account" } },
        deps.signingKey,
      ),
    );
  } catch (error) {
    // A concurrent recovery that already indexed the successor makes the agent
    // refuse this create; its transition is the answer.
    const decided = settled(await latestSession(deps.db, discussionId!), observedGeneration);

    if (!decided) throw error;
    return answer(decided);
  }

  // One transition wins: authority, the discussion and its current generation are
  // rechecked under their locks after the asynchronous reads above.
  const transition = await withEligibleHost(deps.db, authUserId, async (tx, lockedHostId): Promise<Settled> => {
    await lockSetupDiscussion(tx, lockedHostId);
    const latest = await latestSession(tx, discussionId!);
    const decided = settled(latest, observedGeneration);

    if (decided) return decided;
    if (latest!.session_id !== observed!.session_id) return { status: "not_failed" } as const;

    if (recorded.length > 0) {
      await tx`
        insert into app.agent_session_events (session_id, stream_index, event)
        select ${observed!.session_id}, e.ordinality - 1, e.value
        from jsonb_array_elements(${tx.json(recorded as never)}::jsonb) with ordinality as e(value, ordinality)
      `;
    }

    await tx`
      update app.agent_sessions
      set state = 'retired', last_stream_index = ${recorded.length}, current_input_id = null, updated_at = now()
      where session_id = ${observed!.session_id}
    `;
    await tx`
      insert into app.agent_sessions
        (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version)
      values
        (${successorId}, ${sessionIdHash(successorId)}, ${discussionId!}, 'host_account', ${lockedHostId},
         ${generation}, ${AGENT_VERSION})
    `;
    // Input the failed generation never finished continues with its identity.
    await tx`
      update app.conversation_inputs
      set state = 'accepted', session_id = null, sent_at = null, received_session_id = null
      where discussion_id = ${discussionId!} and state <> 'completed'
    `;

    return { generation, status: "recovered" } as const;
  });

  return answer(transition);
}
