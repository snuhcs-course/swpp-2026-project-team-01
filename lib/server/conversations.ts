import { createHash } from "node:crypto";
import { Client, type MessageStreamEvent } from "eve/client";
import { z } from "zod";
import { getChatMessageLengthError } from "../contracts/chat-message";
import { type Actor, CommandError, type CommandDefinition, runCommand } from "./commands";
import type { Database, Transaction } from "./database";
import { lockHostStanding, withEligibleHost } from "./host-eligibility";
import { signInternalBearer } from "./internal-bearer";
import { sessionIdHash } from "./model-limits";

// The application side of a host conversation (design decision 7). Only this
// module creates eve sessions and sends messages: the browser posts to the
// message route, which records the accepted input and then reaches the agent
// service with a 60-second internal bearer. The session index row is written
// before the session's first message, and the input is the session's current
// accepted input before it is sent, so every model call is attributable.

export const AGENT_VERSION = "phase-1";

// The agent service, as the web service reaches it.
export type ConversationRuntime = {
  createSession(bearer: string): Promise<string>;
  sendMessage(sessionId: string, bearer: string, message: string): Promise<void>;
  // Reads a session's recorded events with the browser's own Supabase session
  // cookie, which the agent checks against the session index.
  readEvents(
    sessionId: string,
    cookie: string,
    options: { readonly startIndex: number; readonly follow: boolean; readonly signal?: AbortSignal },
  ): AsyncIterable<MessageStreamEvent>;
};

export function eveRuntime(baseUrl: string): ConversationRuntime {
  const client = (bearer: string) => new Client({ auth: { bearer }, host: baseUrl, redirect: "error" });

  return {
    async createSession(bearer) {
      const { session } = await client(bearer).sessions.create();
      return session.state.sessionId;
    },
    async sendMessage(sessionId, bearer, message) {
      // Accepted once the POST returns; the stream is followed separately.
      await client(bearer).sessions.attach(sessionId).send(message);
    },
    readEvents(sessionId, cookie, { follow, signal, startIndex }) {
      return new Client({ headers: { cookie }, host: baseUrl, redirect: "error" }).sessions
        .attach(sessionId)
        .stream({ follow, signal, startIndex });
    },
  };
}

export function agentUrlFromEnvironment() {
  const url = process.env.EVE_AGENT_URL || process.env.APP_ORIGIN;

  if (!url) {
    throw new Error("EVE_AGENT_URL or APP_ORIGIN must be set.");
  }

  return new URL(url).origin;
}

export type ConversationDependencies = {
  readonly db: Database;
  readonly runtime: ConversationRuntime;
  readonly signingKey: string;
};

export type MessageOutcome =
  | { readonly status: "sent"; readonly inputId: string }
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

export function fingerprint(message: string) {
  return createHash("sha256").update(message, "utf8").digest("base64url");
}

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
// session parked with no message, which costs nothing.
export async function createIndexedSession(
  deps: ConversationDependencies,
  authUserId: string,
  discussionId: string,
  generation: number,
  options: { readonly currentInputId?: string | null; readonly beforeInsert?: (tx: Transaction) => Promise<void> } = {},
) {
  const hostAccountId = await withEligibleHost(deps.db, authUserId, async (_tx, id) => id);
  const sessionId = await deps.runtime.createSession(
    signInternalBearer(
      { discussionId, generation, kind: "create", principal: { id: hostAccountId, type: "host_account" } },
      deps.signingKey,
    ),
  );

  return withEligibleHost(deps.db, authUserId, async (tx, id) => {
    await lockSetupDiscussion(tx, id);
    const latest = await latestSession(tx, discussionId);

    if (latest && latest.generation >= generation) {
      return latest;
    }

    await options.beforeInsert?.(tx);
    const [row] = await tx<SessionRow[]>`
      insert into app.agent_sessions
        (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version,
         current_input_id)
      values
        (${sessionId}, ${sessionIdHash(sessionId)}, ${discussionId}, 'host_account', ${id}, ${generation},
         ${AGENT_VERSION}, ${options.currentInputId ?? null})
      returning session_id, discussion_id, principal_id, generation, state, current_input_id, last_stream_index
    `;
    return row!;
  });
}

// Opens the host's setup discussion as an application command: the actor comes
// from the verified Supabase session, the shared guard is rechecked under the
// account's share lock, and the fixed retry key makes every later visit a replay.
function openSetupDiscussion(authUserId: string): CommandDefinition<Record<string, never>, { discussionId: string }> {
  return {
    input: z.strictObject({}),
    operation: "open_setup_discussion",
    async run(tx, { actor }) {
      const standing = await lockHostStanding(tx, authUserId);

      if (!standing.eligible || standing.hostAccountId !== actor.id) {
        throw new CommandError("forbidden");
      }

      return { discussionId: await lockSetupDiscussion(tx, actor.id) };
    },
  };
}

// The /app visit: a signed-in, eligible host gets an authorized empty setup
// session (generation 1, indexed, with no accepted input, so no model call can
// be attributed to it yet). The browser never creates it. Null when the command
// was refused; its failure is already logged with a correlation identifier.
export async function openSetupSession(
  deps: ConversationDependencies,
  authUserId: string,
  actor: Actor,
): Promise<SessionRow | null> {
  const opened = await runCommand({ authenticate: async () => actor, db: deps.db }, openSetupDiscussion(authUserId), {
    input: {},
    resourceId: "host_setup",
    retryKey: "open_setup_discussion",
  });

  if (!opened.ok) return null;

  return (
    (await latestSession(deps.db, opened.result.discussionId)) ??
    createIndexedSession(deps, authUserId, opened.result.discussionId, 1)
  );
}

type AcceptedInput = {
  readonly discussionId: string;
  readonly hostAccountId: string;
  readonly inputId: string;
  readonly message: string;
  readonly state: "accepted" | "sent" | "completed";
};

async function recordInput(
  db: Database,
  authUserId: string,
  input: { readonly clientInputId: string; readonly message: string },
): Promise<AcceptedInput> {
  return withEligibleHost(db, authUserId, async (tx, hostAccountId) => {
    const discussionId = await lockSetupDiscussion(tx, hostAccountId);
    const print = fingerprint(input.message);
    const [existing] = await tx<{ id: string; fingerprint: string; message: string; state: AcceptedInput["state"] }[]>`
      select id, fingerprint, message, state from app.conversation_inputs
      where discussion_id = ${discussionId} and client_input_id = ${input.clientInputId}
    `;

    if (existing) {
      if (existing.fingerprint !== print) {
        throw new ConversationInputError("retry_conflict", "This message conflicts with an earlier one.");
      }

      return { discussionId, hostAccountId, inputId: existing.id, message: existing.message, state: existing.state };
    }

    const [created] = await tx<{ id: string }[]>`
      insert into app.conversation_inputs (discussion_id, client_input_id, fingerprint, message)
      values (${discussionId}, ${input.clientInputId}, ${print}, ${input.message})
      returning id
    `;

    return { discussionId, hostAccountId, inputId: created!.id, message: input.message, state: "accepted" };
  });
}

// Makes the input the session's current accepted input and delivers it. The
// session must still be the discussion's live generation; a failed or replaced
// session is left alone and the input stays accepted for recovery.
export async function deliverInput(
  deps: ConversationDependencies,
  authUserId: string,
  session: SessionRow,
  inputId: string,
  message: string,
): Promise<boolean> {
  const delivered = await withEligibleHost(deps.db, authUserId, async (tx, hostAccountId) => {
    const discussionId = await lockSetupDiscussion(tx, hostAccountId);
    const latest = await latestSession(tx, discussionId);

    if (!latest || latest.session_id !== session.session_id || latest.state !== "active") {
      return false;
    }

    // Exactly one caller moves an input from accepted to sent.
    const claimed = await tx`
      update app.conversation_inputs set state = 'sent', session_id = ${session.session_id}, sent_at = clock_timestamp()
      where id = ${inputId} and state = 'accepted'
    `;

    if (claimed.count !== 1) return false;

    await tx`
      update app.agent_sessions set current_input_id = ${inputId}, updated_at = now()
      where session_id = ${session.session_id}
    `;
    return true;
  });

  if (!delivered) return false;

  const bearer = signInternalBearer(
    {
      discussionId: session.discussion_id,
      generation: session.generation,
      inputId,
      kind: "send",
      principal: { id: session.principal_id, type: "host_account" },
      sessionId: session.session_id,
    },
    deps.signingKey,
  );

  try {
    await deps.runtime.sendMessage(session.session_id, bearer, message);
  } catch (error) {
    // Not delivered: an exact retry may send it again.
    await deps.db`
      update app.conversation_inputs set state = 'accepted', session_id = null, sent_at = null
      where id = ${inputId} and state = 'sent'
    `;
    throw new ConversationInputError("runtime_unavailable", "The assistant is unavailable. Try again.", { cause: error });
  }

  return true;
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

  const accepted = await recordInput(deps.db, authUserId, { clientInputId: input.clientInputId, message });

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

  if (await deliverInput(deps, authUserId, session, accepted.inputId, accepted.message)) {
    return { inputId: accepted.inputId, status: "sent" };
  }

  // A concurrent exact retry delivered it, or the generation failed meanwhile.
  const [current] = await deps.db<{ state: string }[]>`
    select state from app.conversation_inputs where id = ${accepted.inputId}
  `;
  return { inputId: accepted.inputId, status: current?.state === "accepted" ? "recovery_required" : "sent" };
}
