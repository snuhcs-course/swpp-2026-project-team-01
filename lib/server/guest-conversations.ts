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
import { INTAKE_LIMITS, IntakeLimitError } from "./intakes";
import { signInternalBearer } from "./internal-bearer";
import { sessionIdHash } from "./model-limits";
import { type ConversationStatus, eventsOfDiscussion } from "./recovery";
import { sameProtectedInput, protectInput } from "./redaction";

// The application side of a requester's and an anonymous intake's conversation,
// the counterparts of the host path in conversations.ts and recovery.ts. The
// application route has already resolved the credential (the booking link's hash
// or the intake token's), so the principal here is verified. Each discussion
// has its own audience (requester or public_intake); input is redacted and
// admitted before it is stored, the session index row is written before the
// session's first message, and history and the live stream are read with an
// internal read bearer, so a requester's browser never calls /eve/v1.

export type GuestPrincipal = { readonly type: "requester_request" | "public_intake"; readonly id: string };

export type GuestConversationDependencies = ConversationDependencies & {
  // Messages one intake accepts before the visitor continues.
  readonly intakeMessageLimit?: number;
};

// The principal's one discussion, row-locked: a request's requester discussion
// (created with the request, or here on first use), an intake's own.
async function lockGuestDiscussion(tx: Transaction, principal: GuestPrincipal) {
  if (principal.type === "requester_request") {
    await tx`
      insert into app.discussions (principal_type, principal_id, audience)
      values ('requester_request', ${principal.id}, 'requester')
      on conflict (principal_type, principal_id, audience) do nothing
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

    if (principal.type === "public_intake") {
      const [count] = await tx<{ count: number }[]>`
        select count(*)::int as count from app.conversation_inputs where discussion_id = ${discussionId}
      `;

      if (count!.count >= (deps.intakeMessageLimit ?? INTAKE_LIMITS.messages)) throw new IntakeLimitError("messages");
    }

    await admitConversationInput(
      tx,
      { key: principal.id, scope: principal.type === "public_intake" ? "intake" : "request" },
      deps.admission,
    );
    const protectedInput = protectInput(deps.signingKey, input.message);
    const [created] = await tx<{ id: string }[]>`
      insert into app.conversation_inputs (discussion_id, client_input_id, fingerprint, protected_fingerprint, message)
      values (${discussionId}, ${input.clientInputId}, ${protectedInput.fingerprint}, ${protectedInput.protectedFingerprint},
              ${protectedInput.message})
      returning id
    `;

    return { discussionId, inputId: created!.id, state: "accepted" };
  });
}

// POST /api/intake/{handle}/messages and /api/requests/{bookingId}/messages: the
// guest counterpart of acceptHostMessage.
export async function acceptGuestMessage(
  deps: GuestConversationDependencies,
  principal: GuestPrincipal,
  input: { readonly clientInputId: string; readonly message: string },
): Promise<MessageOutcome> {
  const message = input.message.trim();
  const lengthError = message ? getChatMessageLengthError(message) : "Write a message first.";

  if (lengthError) throw new ConversationInputError("invalid_message", lengthError);

  const accepted = await recordGuestInput(deps, principal, { clientInputId: input.clientInputId, message });

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
// closed (or, for an intake, unless it is open or has continued into a request).
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
