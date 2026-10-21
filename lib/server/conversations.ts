import { parseCookieHeader } from "@supabase/ssr";
import { Client, ClientError, type MessageStreamEvent } from "eve/client";
import { getChatMessageLengthError } from "../contracts/chat-message";
import type { Actor } from "./commands";
import { type AdmissionOptions, admitConversationInput } from "./conversation-admission";
import type { Database, Transaction } from "./database";
import { deploymentEnvironment } from "./deployment";
import { HostIneligibleError, withActiveHostAccount, withEligibleHost } from "./host-eligibility";
import { messageFingerprint, signInternalBearer } from "./internal-bearer";
import { sessionIdHash } from "./model-limits";
import { protectInput, redactCredentials, sameProtectedInput } from "./redaction";

// The application side of a host conversation (design decision 7). Only this
// module creates eve sessions and sends messages: the browser posts to the
// message route, which records the accepted input and then reaches the agent
// service with a 60-second internal bearer. The session index row is written
// before the session's first message, and the input is the session's current
// accepted input before it is sent, so every model call is attributable.

export const AGENT_VERSION = "phase-1";

// A send whose outcome was unknown counts as never delivered once no session
// has reported receiving it this long after it was sent. An accepted message
// reaches an idle session at once, and its 60-second bearer is long expired.
export const UNDELIVERED_AFTER_SECONDS = 300;

// No turn runs this long, so an input its session received this long ago whose
// turn end the index never recorded (the hook's write failed) is reconciled
// against the runtime's own record.
export const TURN_OVERDUE_AFTER_SECONDS = 20 * 60;

// The agent service, as the web service reaches it.
export type ConversationRuntime = {
  createSession(bearer: string): Promise<string>;
  // Resolves once the agent accepted the message. An HTTP refusal rejects with
  // eve's ClientError; any other rejection leaves the outcome unknown.
  sendMessage(sessionId: string, bearer: string, message: string): Promise<void>;
  // Reads a session's recorded events with the browser's own Supabase session
  // cookie, which the agent checks against the session index.
  readEvents(
    sessionId: string,
    cookie: string,
    options: { readonly startIndex: number; readonly follow: boolean; readonly signal?: AbortSignal },
  ): AsyncIterable<MessageStreamEvent>;
  // Reads a session's recorded events with an internal read bearer for it.
  readRecordedEvents(sessionId: string, bearer: string, signal: AbortSignal): AsyncIterable<MessageStreamEvent>;
};

// A send still unanswered after this long is abandoned with an unknown outcome,
// so it never holds the message route or the session-owner hook open.
export const SEND_TIMEOUT_MS = 25_000;

export function eveRuntime(baseUrl: string, { sendTimeoutMs = SEND_TIMEOUT_MS } = {}): ConversationRuntime {
  const client = (bearer: string) => new Client({ auth: { bearer }, host: baseUrl, redirect: "error" });

  return {
    async createSession(bearer) {
      const { session } = await client(bearer).sessions.create();
      return session.state.sessionId;
    },
    async sendMessage(sessionId, bearer, message) {
      // Accepted once the POST returns; the stream is followed separately. A
      // timeout is an unknown outcome, like a dropped connection.
      await client(bearer).sessions.attach(sessionId).send(message, { signal: AbortSignal.timeout(sendTimeoutMs) });
    },
    readEvents(sessionId, cookie, { follow, signal, startIndex }) {
      return new Client({ headers: { cookie: supabaseSessionCookie(cookie) }, host: baseUrl, redirect: "error" }).sessions
        .attach(sessionId)
        .stream({ follow, signal, startIndex });
    },
    readRecordedEvents(sessionId, bearer, signal) {
      // From the start: an active session stores no stream position (the index
      // records last_stream_index only when a generation retires), and this read
      // runs only for a turn overdue by 20 minutes, under a 10-second timeout.
      return client(bearer).sessions.attach(sessionId).stream({ follow: false, signal, startIndex: 0 });
    },
  };
}

// Only the Supabase session cookie (and its chunks) reaches the agent: it needs
// the access token, and nothing else the browser holds.
export function supabaseSessionCookie(cookie: string) {
  return parseCookieHeader(cookie)
    .filter(({ name }) => /^sb-.+-auth-token(\.\d+)?$/.test(name))
    .map(({ name, value }) => `${name}=${value ?? ""}`)
    .join("; ");
}

// Production reaches the agent only over HTTPS, since requests carry the
// browser's session cookie and internal bearers.
export function agentUrlFromEnvironment(env: Readonly<Record<string, string | undefined>> = process.env) {
  const url = env.EVE_AGENT_URL || env.APP_ORIGIN;

  if (!url) {
    throw new Error("EVE_AGENT_URL or APP_ORIGIN must be set.");
  }

  const parsed = new URL(url);

  if (deploymentEnvironment(env) === "production" && parsed.protocol !== "https:") {
    throw new Error("The agent URL must be https in production.");
  }

  return parsed.origin;
}

export type ConversationDependencies = {
  readonly db: Database;
  readonly runtime: ConversationRuntime;
  readonly signingKey: string;
  // Admission limits and the service window's key; the contract numbers and the
  // shared service window by default.
  readonly admission?: AdmissionOptions;
};

export type MessageOutcome =
  | { readonly status: "sent"; readonly inputId: string }
  // Recorded, and delivered when the turn in flight ends.
  | { readonly status: "queued"; readonly inputId: string }
  // Recorded, and continued by recovery: the discussion's runtime has failed.
  | { readonly status: "recovery_required"; readonly inputId: string };

export class ConversationInputError extends Error {
  readonly code: "invalid_message" | "retry_conflict" | "runtime_unavailable";

  constructor(code: ConversationInputError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConversationInputError";
    this.code = code;
  }
}

export type SessionRow = {
  readonly session_id: string;
  readonly discussion_id: string;
  readonly principal_id: string;
  readonly generation: number;
  readonly state: "active" | "failed" | "retired";
  readonly current_input_id: string | null;
  readonly last_stream_index: number | null;
};

export const fingerprint = messageFingerprint;

// The host's setup discussion, created on first use and row-locked, which
// serializes accepting input, creating sessions and recovery for it.
export async function lockSetupDiscussion(tx: Transaction, hostAccountId: string) {
  await tx`
    insert into app.discussions (principal_type, principal_id, audience)
    values ('host_account', ${hostAccountId}, 'host_setup')
    on conflict (principal_type, principal_id, audience) do nothing
  `;
  const [discussion] = await tx<{ id: string }[]>`
    select id from app.discussions
    where principal_type = 'host_account' and principal_id = ${hostAccountId} and audience = 'host_setup'
    for update
  `;
  return discussion!.id;
}

export async function latestSession(tx: Transaction | Database, discussionId: string) {
  const [row] = await tx<SessionRow[]>`
    select session_id, discussion_id, principal_id, generation, state, current_input_id, last_stream_index
    from app.agent_sessions
    where discussion_id = ${discussionId}
    order by generation desc
    limit 1
  `;
  return row ?? null;
}

// Creates and indexes the discussion's next session. The eve session is created
// outside any transaction; the index row is written under the discussion lock
// with the authority rechecked. A concurrent creator that wins leaves this eve
// session parked with no message, which costs nothing; one that indexed first
// makes the agent refuse this create, and its session is the answer.
export async function createIndexedSession(
  deps: ConversationDependencies,
  authUserId: string,
  discussionId: string,
  generation: number,
) {
  const hostAccountId = await withEligibleHost(deps.db, authUserId, async (_tx, id) => id);
  let sessionId: string;

  try {
    sessionId = await deps.runtime.createSession(
      signInternalBearer(
        { discussionId, generation, kind: "create", principal: { id: hostAccountId, type: "host_account" } },
        deps.signingKey,
      ),
    );
  } catch (error) {
    const latest = await latestSession(deps.db, discussionId);

    if (latest && latest.generation >= generation) return latest;
    throw error;
  }

  return withEligibleHost(deps.db, authUserId, async (tx, id) => {
    await lockSetupDiscussion(tx, id);
    const latest = await latestSession(tx, discussionId);

    if (latest && latest.generation >= generation) {
      return latest;
    }

    const [row] = await tx<SessionRow[]>`
      insert into app.agent_sessions
        (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version)
      values
        (${sessionId}, ${sessionIdHash(sessionId)}, ${discussionId}, 'host_account', ${id}, ${generation},
         ${AGENT_VERSION})
      returning session_id, discussion_id, principal_id, generation, state, current_input_id, last_stream_index
    `;
    return row!;
  });
}

// The /app visit: a signed-in, eligible host gets an authorized empty setup
// session (generation 1, indexed, with no accepted input, so no model call can
// be attributed to it yet). The browser never creates it. Eligibility is
// rechecked on every visit, under the account's share lock, so a host suspended
// since an earlier visit gets nothing. Null when the host may not host or the
// actor is not the signed-in host.
export async function openSetupSession(
  deps: ConversationDependencies,
  authUserId: string,
  actor: Actor,
): Promise<SessionRow | null> {
  let discussionId: string | null;

  try {
    discussionId = await withEligibleHost(deps.db, authUserId, async (tx, id) =>
      id === actor.id ? lockSetupDiscussion(tx, id) : null,
    );
  } catch (error) {
    if (error instanceof HostIneligibleError) return null;
    throw error;
  }

  if (!discussionId) return null;

  return (await latestSession(deps.db, discussionId)) ?? createIndexedSession(deps, authUserId, discussionId, 1);
}

type AcceptedInput = {
  readonly discussionId: string;
  readonly hostAccountId: string;
  readonly inputId: string;
  readonly message: string;
  readonly state: "accepted" | "sent" | "completed";
};

// Records the input under the discussion lock: redacted before it is stored
// (design decision 14), with only an HMAC of the original's fingerprint kept for
// retries, and charged against the host and service admission windows. An exact
// retry returns the saved input without a charge; a changed one conflicts, even
// when only a removed secret differs.
async function recordInput(
  deps: ConversationDependencies,
  authUserId: string,
  input: { readonly clientInputId: string; readonly message: string },
): Promise<AcceptedInput> {
  return withEligibleHost(deps.db, authUserId, async (tx, hostAccountId) => {
    const discussionId = await lockSetupDiscussion(tx, hostAccountId);
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

      return { discussionId, hostAccountId, inputId: existing.id, message: existing.message, state: existing.state };
    }

    await admitConversationInput(tx, { key: hostAccountId, scope: "host" }, deps.admission);
    const protectedInput = protectInput(deps.signingKey, input.message);
    const [created] = await tx<{ id: string }[]>`
      insert into app.conversation_inputs (discussion_id, client_input_id, fingerprint, protected_fingerprint, message)
      values (${discussionId}, ${input.clientInputId}, ${protectedInput.fingerprint}, ${protectedInput.protectedFingerprint},
              ${protectedInput.message})
      returning id
    `;

    return { discussionId, hostAccountId, inputId: created!.id, message: protectedInput.message, state: "accepted" };
  });
}

// Delivers the discussion's oldest accepted input to its live generation, when
// no input is in flight there: one input at a time, so the session's current
// accepted input never changes while a turn runs and every model call is
// attributed to the input whose turn it is. Later input waits as accepted and is
// delivered when the turn ends (the session-owner hook calls this again), or by
// the next message or recovery. Authority, the discussion and its generation are
// rechecked under their locks. With `fromSessionId`, only that session's turn
// end may deliver, so a retired generation delivers nothing. Returns the
// delivered input's ID, or null when nothing was delivered.
export async function deliverNext(
  deps: ConversationDependencies,
  hostAccountId: string,
  discussionId: string,
  options: { readonly fromSessionId?: string; readonly reconciled?: boolean; readonly skipInputId?: string } = {},
): Promise<string | null> {
  const claim = await withActiveHostAccount(deps.db, hostAccountId, async (tx) => {
    await tx`select id from app.discussions where id = ${discussionId} for update`;
    const session = await latestSession(tx, discussionId);

    if (!session || session.state !== "active") return null;
    if (options.fromSessionId && options.fromSessionId !== session.session_id) return null;

    // An input whose send outcome was unknown, that this session has not
    // reported receiving long after its bearer expired, never arrived: it is
    // accepted again and delivered below, in order. Delivery IDs from a retired
    // generation prove nothing about this delivery.
    await tx`
      update app.conversation_inputs set state = 'accepted', session_id = null, sent_at = null, received_session_id = null
      where session_id = ${session.session_id} and state = 'sent'
        and received_session_id is distinct from ${session.session_id}
        and sent_at < clock_timestamp() - make_interval(secs => ${UNDELIVERED_AFTER_SECONDS})
    `;
    const [inFlight] = await tx<{ id: string; delivery_ids: string[]; overdue: boolean }[]>`
      select id, delivery_ids,
        received_session_id = session_id
          and sent_at < clock_timestamp() - make_interval(secs => ${TURN_OVERDUE_AFTER_SECONDS}) as overdue
      from app.conversation_inputs where session_id = ${session.session_id} and state = 'sent' limit 1
    `;

    if (inFlight) {
      return inFlight.overdue && !options.reconciled
        ? { overdue: { deliveryIds: inFlight.delivery_ids, inputId: inFlight.id }, session }
        : null;
    }

    const [next] = await tx<{ id: string; message: string }[]>`
      select id, message from app.conversation_inputs
      where discussion_id = ${discussionId} and state = 'accepted' and id::text <> ${options.skipInputId ?? ""}
      order by accepted_at, id
      limit 1
    `;

    if (!next) return null;

    await tx`
      update app.conversation_inputs set state = 'sent', session_id = ${session.session_id}, sent_at = clock_timestamp()
      where id = ${next.id}
    `;
    await tx`
      update app.agent_sessions set current_input_id = ${next.id}, updated_at = now()
      where session_id = ${session.session_id}
    `;
    return { input: next, session };
  });

  if (!claim) return null;

  if (claim.overdue) {
    const ended = await reconcileTurnEnd(deps, claim.session, claim.overdue);
    return ended ? deliverNext(deps, hostAccountId, discussionId, { ...options, reconciled: true }) : null;
  }

  const { session } = claim;
  // Redaction is idempotent, so an input stored before it existed is protected
  // here before its first delivery, and a stored protected one is unchanged.
  const input = { ...claim.input, message: redactCredentials(claim.input.message) };
  const bearer = signInternalBearer(
    {
      discussionId: session.discussion_id,
      generation: session.generation,
      inputId: input.id,
      kind: "send",
      messageFingerprint: messageFingerprint(input.message),
      principal: { id: session.principal_id, type: "host_account" },
      sessionId: session.session_id,
    },
    deps.signingKey,
  );

  try {
    await deps.runtime.sendMessage(session.session_id, bearer, input.message);
  } catch (error) {
    // A timeout, a reset connection or a server error may follow acceptance, so
    // the input stays sent: never sent twice, completed by its turn's end or
    // continued by recovery if it arrived, and accepted again above if it never did.
    if (!(error instanceof ClientError) || error.status >= 500) return input.id;

    // Refused: not delivered, so an exact retry may send it again.
    await deps.db`
      update app.conversation_inputs set state = 'accepted', session_id = null, sent_at = null, received_session_id = null
      where id = ${input.id} and state = 'sent'
    `;

    // Input another tab queued behind it would otherwise wait for a turn end
    // that is not coming: it is delivered now, once.
    if (!options.skipInputId) {
      await deliverNext(deps, hostAccountId, discussionId, { ...options, skipInputId: input.id }).catch(() => null);
    }

    throw new ConversationInputError("runtime_unavailable", "The assistant is unavailable. Try again.", { cause: error });
  }

  return input.id;
}

// Records, from the runtime's own record, the end of the turn that served the
// session's overdue input (its delivery IDs name the turn), as the session-owner
// hook would have. Concurrent deliveries may both find the same overdue input,
// so each write acts only while that input is still the session's current one in
// flight: once another caller has reconciled it and delivered the next input,
// nothing here touches the turn now running. True when this call completed it.
async function reconcileTurnEnd(
  deps: ConversationDependencies,
  session: SessionRow,
  overdue: { readonly deliveryIds: readonly string[]; readonly inputId: string },
) {
  const bearer = signInternalBearer(
    {
      discussionId: session.discussion_id,
      generation: session.generation,
      kind: "read",
      principal: { id: session.principal_id, type: "host_account" },
      sessionId: session.session_id,
    },
    deps.signingKey,
  );
  let end: MessageStreamEvent | undefined;

  try {
    for await (const event of deps.runtime.readRecordedEvents(session.session_id, bearer, AbortSignal.timeout(10_000))) {
      const ownsTurn = event.meta.deliveryIds?.some((id) => overdue.deliveryIds.includes(id));

      if (event.type === "session.failed" || (ownsTurn && TURN_ENDS.has(event.type))) end = event;
    }
  } catch {
    // Unreadable now; the next delivery tries again.
    return false;
  }

  if (!end) return false;

  if (end.type === "session.failed" || (end.type === "turn.failed" && end.data.terminal)) {
    await deps.db`
      update app.agent_sessions s set state = 'failed', updated_at = now()
      from app.conversation_inputs i
      where i.id = ${overdue.inputId} and i.session_id = s.session_id and s.session_id = ${session.session_id}
        and s.state = 'active' and s.current_input_id = i.id and i.state = 'sent'
    `;
    return false;
  }

  const completed = await deps.db`
    update app.conversation_inputs i
    set state = 'completed', completed_at = now()
    from app.agent_sessions s
    where i.id = ${overdue.inputId} and i.session_id = s.session_id and s.session_id = ${session.session_id}
      and s.state = 'active' and s.current_input_id = i.id and i.state = 'sent'
  `;
  return completed.count > 0;
}

const TURN_ENDS = new Set(["turn.completed", "turn.failed", "turn.cancelled"]);

// The turn-end side of delivery, from the session-owner hook: delivers the
// session's discussion's next input when the session is still its live generation.
export async function deliverNextAfterTurn(deps: ConversationDependencies, sessionId: string) {
  const [session] = await deps.db<{ discussion_id: string; principal_id: string; principal_type: string }[]>`
    select discussion_id, principal_id, principal_type from app.agent_sessions where session_id = ${sessionId}
  `;

  if (session?.principal_type !== "host_account") return null;

  return deliverNext(deps, session.principal_id, session.discussion_id, { fromSessionId: sessionId });
}

async function inputOutcome(db: Database, inputId: string): Promise<MessageOutcome> {
  const [row] = await db<{ state: AcceptedInput["state"] }[]>`
    select state from app.conversation_inputs where id = ${inputId}
  `;
  return { inputId, status: row?.state === "accepted" ? "queued" : "sent" };
}

// POST /api/chat/messages: authenticate (by the caller), check eligibility,
// record the accepted input, create the session on first use, then send.
export async function acceptHostMessage(
  deps: ConversationDependencies,
  authUserId: string,
  input: { readonly clientInputId: string; readonly message: string },
): Promise<MessageOutcome> {
  const message = input.message.trim();
  const lengthError = message ? getChatMessageLengthError(message) : "Write a message first.";

  if (lengthError) {
    throw new ConversationInputError("invalid_message", lengthError);
  }

  const accepted = await recordInput(deps, authUserId, { clientInputId: input.clientInputId, message });

  // An exact retry of an input already delivered returns its receipt.
  if (accepted.state !== "accepted") {
    return { inputId: accepted.inputId, status: "sent" };
  }

  let session = await latestSession(deps.db, accepted.discussionId);

  if (!session) {
    session = await createIndexedSession(deps, authUserId, accepted.discussionId, 1);
  }

  if (session.state !== "active") {
    return { inputId: accepted.inputId, status: "recovery_required" };
  }

  await deliverNext(deps, accepted.hostAccountId, accepted.discussionId);

  // Delivered now, by a concurrent sender, or still waiting behind the turn in
  // flight; a generation that failed meanwhile leaves it for recovery.
  const outcome = await inputOutcome(deps.db, accepted.inputId);

  if (outcome.status === "queued" && (await latestSession(deps.db, accepted.discussionId))?.state !== "active") {
    return { inputId: accepted.inputId, status: "recovery_required" };
  }

  return outcome;
}
