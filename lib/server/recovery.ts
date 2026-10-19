import { isCurrentTurnBoundaryEvent, type MessageStreamEvent } from "eve/client";
import {
  AGENT_VERSION,
  type ConversationDependencies,
  deliverInput,
  latestSession,
  lockSetupDiscussion,
  type SessionRow,
} from "./conversations";
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

// Events of the host's discussion from `cursor`. With `follow`, the current
// generation is followed to the end of its current turn.
export async function* discussionEvents(
  deps: Pick<ConversationDependencies, "db" | "runtime">,
  authUserId: string,
  cookie: string,
  cursor: number,
  options: { readonly follow: boolean; readonly signal?: AbortSignal },
): AsyncGenerator<MessageStreamEvent> {
  const hostAccountId = await eligibleHost(deps.db, authUserId);
  const discussionId = await findSetupDiscussion(deps.db, hostAccountId);

  if (!discussionId) return;

  const sessions = await deps.db<Pick<SessionRow, "session_id" | "state" | "last_stream_index">[]>`
    select session_id, state, last_stream_index from app.agent_sessions
    where discussion_id = ${discussionId}
    order by generation
  `;
  let offset = 0;

  for (const session of sessions) {
    if (session.state === "retired") {
      const count = session.last_stream_index ?? 0;

      if (cursor < offset + count) {
        const stored = await deps.db<{ event: MessageStreamEvent }[]>`
          select event from app.agent_session_events
          where session_id = ${session.session_id} and stream_index >= ${cursor - offset}
          order by stream_index
        `;
        for (const row of stored) yield audienceSafe(row.event);
      }

      offset += count;
      continue;
    }

    const events = deps.runtime.readEvents(session.session_id, cookie, {
      follow: options.follow,
      signal: options.signal,
      startIndex: Math.max(0, cursor - offset),
    });

    for await (const event of events) {
      yield audienceSafe(event);
      if (options.follow && isCurrentTurnBoundaryEvent(event)) return;
    }
  }
}

// Delivers the discussion's accepted, undelivered inputs to its live generation,
// oldest first, each with its original identity.
async function deliverPending(deps: ConversationDependencies, authUserId: string, discussionId: string) {
  const successor = await latestSession(deps.db, discussionId);

  if (!successor || successor.state !== "active") return;

  const pending = await deps.db<{ id: string; message: string }[]>`
    select id, message from app.conversation_inputs
    where discussion_id = ${discussionId} and state = 'accepted'
    order by accepted_at, id
  `;

  for (const input of pending) {
    try {
      await deliverInput(deps, authUserId, successor, input.id, input.message);
    } catch {
      // Left accepted for the next retry.
      return;
    }
  }
}

export type RecoveryOutcome =
  | { readonly status: "recovered"; readonly generation: number }
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

function settled(latest: SessionRow | null, observedGeneration: number): RecoveryOutcome | null {
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

  if (early) {
    // An exact retry after the transition delivers what the first attempt could not.
    if (early.status === "recovered") await deliverPending(deps, authUserId, discussionId!);
    return early;
  }

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
    if (decided.status === "recovered") await deliverPending(deps, authUserId, discussionId!);
    return decided;
  }

  // One transition wins: authority, the discussion and its current generation are
  // rechecked under their locks after the asynchronous reads above.
  const transition = await withEligibleHost(deps.db, authUserId, async (tx, lockedHostId) => {
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
      set state = 'accepted', session_id = null, sent_at = null
      where discussion_id = ${discussionId!} and state <> 'completed'
    `;

    return { generation, status: "recovered" } as const;
  });

  if (transition.status === "recovered") {
    await deliverPending(deps, authUserId, discussionId!);
  }

  return transition;
}
