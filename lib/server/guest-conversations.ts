import { getChatMessageLengthError } from "../contracts/chat-message";
import type { DiscussionEvent } from "../contracts/discussion-events";
import { admitConversationInput } from "./conversation-admission";
import {
  AGENT_VERSION,
  ConversationInputError,
  type ConversationDependencies,
  deliverNext,
  latestSession,
  type MessageOutcome,
  type SessionRow,
  withPrincipalAuthority,
} from "./conversations";
import type { Queryable, Transaction } from "./database";
import { signInternalBearer } from "./internal-bearer";
import { sessionIdHash } from "./model-limits";
import type { MessageStreamEvent } from "eve/client";
import {
  type ConversationStatus,
  eventsOfDiscussion,
  hasTerminalEvidence,
  type RecoveryOutcome,
  type Settled,
  settled,
} from "./recovery";
import { sameProtectedInput, protectInput } from "./redaction";
import { DRAFT_LIMITS, markIdentityRequested } from "./request-start";

// The application side of a guest's conversation, the counterpart of the host
// path in conversations.ts and recovery.ts. The application route has already
// resolved the credential (the booking link's hash), so the principal here is
// verified. One requester discussion serves the guest from the first message on
// the public page, while the request is a draft, to agreement (design decision
// 2): input is redacted and admitted before it is stored, the session index row
// is written before the session's first message, and history and the live
// stream are read with an internal read bearer, so a guest's browser never
// calls /eve/v1. A draft accepts at most 30 messages.
//
// A public_intake principal names an anonymous intake from before D13. Intakes
// are no longer created, and their discussions are only read, so a request
// that came from one still shows that transcript above its thread.

export class DraftMessageLimitError extends Error {
  constructor() {
    super("The draft message limit is reached.");
    this.name = "DraftMessageLimitError";
  }
}

export type GuestPrincipal = { readonly type: "requester_request" | "public_intake"; readonly id: string };

export type GuestConversationDependencies = ConversationDependencies & {
  // Messages a draft accepts before the guest gives a name and email.
  readonly draftMessageLimit?: number;
};

// The principal's one discussion, row-locked: a request's requester discussion
// (created with the draft, or here on first use for a request from before D13).
async function lockGuestDiscussion(tx: Transaction, principal: GuestPrincipal) {
  if (principal.type === "requester_request") {
    await tx`
      insert into app.discussions (principal_type, principal_id, audience)
      values ('requester_request', ${principal.id}, 'requester')
      on conflict (principal_type, principal_id, audience, request_id) do nothing
    `;
  }

  const [row] = await tx<{ id: string }[]>`
    select id from app.discussions
    where principal_type = ${principal.type} and principal_id = ${principal.id}
      and audience = ${principal.type === "requester_request" ? "requester" : "public_intake"}
    for update
  `;

  if (!row) throw new ConversationInputError("invalid_message", "This conversation is not available.");
  return row.id;
}

export async function findGuestDiscussion(db: Queryable, principal: GuestPrincipal) {
  const [row] = await db<{ id: string }[]>`
    select id from app.discussions
    where principal_type = ${principal.type} and principal_id = ${principal.id}
      and audience = ${principal.type === "requester_request" ? "requester" : "public_intake"}
  `;
  return row?.id ?? null;
}

// Creates and indexes the discussion's next session, as createIndexedSession
// does for a host: the eve session first, then the index row under the
// discussion lock with the principal's standing rechecked.
async function createGuestSession(
  deps: ConversationDependencies,
  principal: GuestPrincipal,
  discussionId: string,
  generation: number,
): Promise<SessionRow> {
  let sessionId: string;

  try {
    sessionId = await deps.runtime.createSession(
      signInternalBearer({ discussionId, generation, kind: "create", principal }, deps.signingKey),
    );
  } catch (error) {
    const latest = await latestSession(deps.db, discussionId);

    if (latest && latest.generation >= generation) return latest;
    throw error;
  }

  return withPrincipalAuthority(deps.db, principal, async (tx) => {
    await lockGuestDiscussion(tx, principal);
    const latest = await latestSession(tx, discussionId);

    if (latest && latest.generation >= generation) return latest;

    const [row] = await tx<SessionRow[]>`
      insert into app.agent_sessions
        (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version)
      values
        (${sessionId}, ${sessionIdHash(sessionId)}, ${discussionId}, ${principal.type}, ${principal.id}, ${generation},
         ${AGENT_VERSION})
      returning session_id, discussion_id, principal_type, principal_id, generation, state, current_input_id, last_stream_index
    `;
    return row!;
  });
}

// Opens the principal's session when the page loads, creating generation 1 if
// none exists, and delivers any input already accepted for it (a new request's
// application-authored summary). Null when the discussion does not exist.
export async function openGuestSession(deps: ConversationDependencies, principal: GuestPrincipal) {
  const discussionId = await findGuestDiscussion(deps.db, principal);

  if (!discussionId) return null;

  const session = (await latestSession(deps.db, discussionId)) ?? (await createGuestSession(deps, principal, discussionId, 1));

  if (session.state === "active") await deliverNext(deps, principal, discussionId);
  return session;
}

type AcceptedInput = { readonly discussionId: string; readonly inputId: string; readonly state: "accepted" | "sent" | "completed" };

async function recordGuestInput(
  deps: GuestConversationDependencies,
  principal: GuestPrincipal,
  input: { readonly clientInputId: string; readonly message: string },
): Promise<AcceptedInput> {
  return withPrincipalAuthority(deps.db, principal, async (tx) => {
    const discussionId = await lockGuestDiscussion(tx, principal);
    const [existing] = await tx<
      { id: string; fingerprint: string; message: string; protected_fingerprint: string | null; state: AcceptedInput["state"] }[]
    >`
      select id, fingerprint, protected_fingerprint, message, state from app.conversation_inputs
      where discussion_id = ${discussionId} and client_input_id = ${input.clientInputId}
    `;

    if (existing) {
      if (!sameProtectedInput(existing, deps.signingKey, input.message)) {
        throw new ConversationInputError("retry_conflict", "This message conflicts with an earlier one.");
      }

      return { discussionId, inputId: existing.id, state: existing.state };
    }

    // withPrincipalAuthority share-locked the request; a draft has a cap.
    const [count] = await tx<{ count: number; draft: boolean }[]>`
      select (select state = 'draft' from app.requests where id = ${principal.id}) as draft,
             (select count(*)::int from app.conversation_inputs where discussion_id = ${discussionId}) as count
    `;

    if (count!.draft && count!.count >= (deps.draftMessageLimit ?? DRAFT_LIMITS.messages)) throw new DraftMessageLimitError();

    await admitConversationInput(tx, { key: principal.id, scope: "request" }, deps.admission);
    const protectedInput = protectInput(deps.signingKey, input.message, { bareUuids: true });
    const [created] = await tx<{ id: string }[]>`
      insert into app.conversation_inputs (discussion_id, client_input_id, fingerprint, protected_fingerprint, message)
      values (${discussionId}, ${input.clientInputId}, ${protectedInput.fingerprint}, ${protectedInput.protectedFingerprint},
              ${protectedInput.message})
      returning id
    `;

    return { discussionId, inputId: created!.id, state: "accepted" };
  });
}

// POST /api/requests/start (the first message) and
// /api/requests/{bookingId}/messages: the guest counterpart of acceptHostMessage.
export async function acceptGuestMessage(
  deps: GuestConversationDependencies,
  principal: GuestPrincipal,
  input: { readonly clientInputId: string; readonly message: string },
): Promise<MessageOutcome> {
  const message = input.message.trim();
  const lengthError = message ? getChatMessageLengthError(message) : "Write a message first.";

  if (lengthError) throw new ConversationInputError("invalid_message", lengthError);

  let accepted: AcceptedInput;

  try {
    accepted = await recordGuestInput(deps, principal, { clientInputId: input.clientInputId, message });
  } catch (error) {
    // At the cap, the thread calls for the identity card to keep going.
    if (error instanceof DraftMessageLimitError) await markIdentityRequested(deps.db, principal.id);
    throw error;
  }

  if (accepted.state !== "accepted") return { inputId: accepted.inputId, status: "sent" };

  const session =
    (await latestSession(deps.db, accepted.discussionId)) ??
    (await createGuestSession(deps, principal, accepted.discussionId, 1));

  if (session.state !== "active") return { inputId: accepted.inputId, status: "recovery_required" };

  await deliverNext(deps, principal, accepted.discussionId);

  const [row] = await deps.db<{ state: AcceptedInput["state"] }[]>`
    select state from app.conversation_inputs where id = ${accepted.inputId}
  `;
  return { inputId: accepted.inputId, status: row?.state === "accepted" ? "queued" : "sent" };
}

export async function guestConversationStatus(db: Queryable, principal: GuestPrincipal): Promise<ConversationStatus> {
  const discussionId = await findGuestDiscussion(db, principal);
  const latest = discussionId ? await latestSession(db, discussionId) : null;

  if (!discussionId || !latest) return { generation: null, pendingInputs: 0, state: "none" };

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

// The guest discussion's events from `cursor`, read with an internal read
// bearer for each live generation. The agent refuses the read once the request
// closed (or, for an intake from before D13, unless the request it became is
// open).
export async function* guestDiscussionEvents(
  deps: Pick<ConversationDependencies, "db" | "runtime" | "signingKey">,
  principal: GuestPrincipal,
  cursor: number,
  options: { readonly follow: boolean; readonly signal?: AbortSignal; readonly idleMs?: number },
): AsyncGenerator<DiscussionEvent> {
  const discussionId = await findGuestDiscussion(deps.db, principal);

  if (!discussionId) return;

  yield* eventsOfDiscussion(
    deps.db,
    discussionId,
    (session, read) =>
      deps.runtime.readRecordedEvents(
        session.session_id,
        signInternalBearer(
          {
            discussionId: session.discussion_id,
            generation: session.generation,
            kind: "read",
            principal: { id: session.principal_id, type: session.principal_type },
            sessionId: session.session_id,
          },
          deps.signingKey,
        ),
        read.signal,
        { follow: read.follow, startIndex: read.startIndex },
      ),
    cursor,
    options,
  );
}

// ---------------------------------------------------------------------------
// Recovery

// POST /api/requests/{bookingId}/recover: the requester's counterpart of the
// host workspace's recovery (recovery.ts, recoverDiscussion). It replaces a
// generation whose recorded stream shows a terminal failure with at most one
// successor for the same discussion, keeping its history and continuing its
// unfinished input; the recovery identity is the discussion and the observed
// generation, so an exact retry returns the transition's status. The failed
// session is read with an internal read bearer, since the browser holds no
// credential the agent could check.
export async function recoverGuestDiscussion(
  deps: ConversationDependencies,
  principal: GuestPrincipal,
  observedGeneration: number,
  options: { readonly inspectTimeoutMs?: number } = {},
): Promise<RecoveryOutcome> {
  const discussionId = await findGuestDiscussion(deps.db, principal);
  const observed = discussionId ? await latestSession(deps.db, discussionId) : null;

  const answer = async (outcome: Settled): Promise<RecoveryOutcome> => {
    if (outcome.status !== "recovered") return outcome;

    try {
      await deliverNext(deps, principal, discussionId!);
    } catch {
      // Left accepted for the next retry.
    }

    const [inFlight] = await deps.db<{ found: boolean }[]>`
      select true as found from app.conversation_inputs i
      join app.agent_sessions s on s.session_id = i.session_id and s.state = 'active'
      where i.discussion_id = ${discussionId!} and i.state = 'sent'
      limit 1
    `;
    return { ...outcome, delivered: Boolean(inFlight) };
  };

  const early = settled(observed, observedGeneration);
  if (early) return answer(early);

  let recorded: MessageStreamEvent[];

  try {
    const bearer = signInternalBearer(
      { discussionId: discussionId!, generation: observed!.generation, kind: "read", principal, sessionId: observed!.session_id },
      deps.signingKey,
    );
    recorded = [];
    for await (const event of deps.runtime.readRecordedEvents(
      observed!.session_id,
      bearer,
      AbortSignal.timeout(options.inspectTimeoutMs ?? 10_000),
    )) {
      recorded.push(event);
    }
  } catch {
    return { status: "unavailable" };
  }

  if (!hasTerminalEvidence(recorded)) return { status: "not_failed" };

  const generation = observedGeneration + 1;
  let successorId: string;

  try {
    successorId = await deps.runtime.createSession(
      signInternalBearer({ discussionId: discussionId!, generation, kind: "create", principal }, deps.signingKey),
    );
  } catch (error) {
    const decided = settled(await latestSession(deps.db, discussionId!), observedGeneration);
    if (!decided) throw error;
    return answer(decided);
  }

  const transition = await withPrincipalAuthority(deps.db, principal, async (tx): Promise<Settled> => {
    await lockGuestDiscussion(tx, principal);
    const latest = await latestSession(tx, discussionId!);
    const decided = settled(latest, observedGeneration);

    if (decided) return decided;
    if (latest!.session_id !== observed!.session_id) return { status: "not_failed" };

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
        (${successorId}, ${sessionIdHash(successorId)}, ${discussionId!}, ${principal.type}, ${principal.id}, ${generation},
         ${AGENT_VERSION})
    `;
    await tx`
      update app.conversation_inputs
      set state = 'accepted', session_id = null, sent_at = null, received_session_id = null
      where discussion_id = ${discussionId!} and state <> 'completed'
    `;

    return { generation, status: "recovered" };
  });

  return answer(transition);
}
