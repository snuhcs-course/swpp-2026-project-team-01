import type { MessageStreamEvent } from "eve/client";
import type { RequestLanguage } from "../contracts/request";
import {
  AGENTMAIL_API_URL,
  type AgentMailConfig,
  agentMailConfigFromEnvironment,
  agentMailTransport,
  type AgentMailTransport,
  type ReplyOutcome,
} from "./agentmail";
import { agentUrlFromEnvironment, type ConversationRuntime, eveRuntime } from "./conversations";
import { database, type Database, type Transaction } from "./database";
import { type EmailKind, noticeStillCurrent } from "./email-delivery";
import { type EmailParameters, type EmailSecrets, isEmailTemplate, renderEmail } from "./email-templates";
import { signInternalBearer, internalSigningKey } from "./internal-bearer";
import { type JobHandler, publishJob } from "./jobs";
import { assertMessagingAdmitted } from "./messaging";
import { redactCredentials } from "./redaction";
import { openToken, sealToken, type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// Replies the product inbox sends into a requester's thread
// (requester-email-channel design 6 and 7, D8). recordReply stores a reply in
// the caller's transaction and publishes its email_reply job. A turn reply
// waits for the turn that served its forwarded message: the session-owner hook
// brings its job forward when that turn ends, and the job otherwise retries
// until it does. The job then:
//   1. freezes the text: the turn's final assistant text, redacted, with the
//      footer (a fixed fallback when the turn produced none or its session
//      failed for good), a fixed reply as recorded; a notice is rendered from its
//      template and sealed booking link at each send and stores no text;
//   2. suppresses a reply whose thread was unlinked, and a notice no longer
//      current;
//   3. moves the reply to dispatching and commits before the network call;
//   4. replies to the recorded message with Idempotency-Key equal to the reply
//      ID, recording accepted with the provider's message ID or rejected on a
//      refusal. An uncertain outcome leaves it dispatching for the next attempt,
//      which sends the same text under the same key while the first dispatch is
//      under 23 hours old; after that, or on a key conflict, it is recorded
//      uncertain and never sent again. Every final state clears the text and
//      the sealed secret.

export const EMAIL_REPLY_JOB = "email_reply";
// AgentMail keeps an Idempotency-Key for 24 hours; retries stop an hour before.
export const REPLY_RETRY_HOURS = 23;
// Attempts double from 20 seconds, so 12 span about three hours: enough for a
// turn queued behind others and for a provider outage.
export const REPLY_ATTEMPTS = 12;
// A turn reply's first attempt; the turn end usually brings it forward.
export const TURN_REPLY_DELAY_SECONDS = 30;
export const MAX_REPLY_CHARS = 20_000;

export type ReplyKind = "turn" | "link_confirmation" | "start_refusal" | "closed" | "too_long" | "unprocessed" | "notice";
export type ReplyState = "waiting" | "queued" | "dispatching" | "accepted" | "rejected" | "uncertain" | "suppressed";

export type RecordReply = {
  readonly kind: ReplyKind;
  // One reply per (kind, dedupeKey): a retried recording returns the existing one.
  readonly dedupeKey: string;
  readonly requestId: string | null;
  readonly bindingId: string | null;
  readonly inboxId: string;
  readonly replyToMessageId: string;
  readonly language: RequestLanguage;
  // A turn reply names its input and waits for its turn.
  readonly inputId?: string;
  // A fixed reply's text.
  readonly text?: string;
  // A notice's template and parameters, with its secrets sealed.
  readonly template?: EmailKind;
  readonly parameters?: EmailParameters;
  readonly secrets?: EmailSecrets;
  readonly tokenKey?: TokenKey;
};

export function replySecretContext(replyId: string) {
  return `email_reply:${replyId}`;
}

export async function recordReply(tx: Transaction, reply: RecordReply): Promise<{ id: string; created: boolean }> {
  const [existing] = await tx<{ id: string }[]>`
    select id from app.email_replies where kind = ${reply.kind} and dedupe_key = ${reply.dedupeKey}
  `;
  if (existing) return { created: false, id: existing.id };

  const [row] = await tx<{ id: string }[]>`select gen_random_uuid() as id`;
  const id = row!.id;
  const sealed = reply.secrets && reply.tokenKey ? sealToken(reply.tokenKey, JSON.stringify(reply.secrets), replySecretContext(id)) : null;
  const [created] = await tx<{ id: string }[]>`
    insert into app.email_replies
      (id, kind, dedupe_key, request_id, binding_id, inbox_id, reply_to_message_id, input_id, template, language,
       parameters, text, secret_ciphertext, secret_key_id, state)
    values
      (${id}, ${reply.kind}, ${reply.dedupeKey}, ${reply.requestId}, ${reply.bindingId}, ${reply.inboxId},
       ${reply.replyToMessageId}, ${reply.inputId ?? null}, ${reply.template ?? null}, ${reply.language},
       ${tx.json((reply.parameters ?? {}) as Parameters<typeof tx.json>[0])}, ${reply.text ?? null},
       ${sealed?.ciphertext ?? null}, ${sealed?.keyId ?? null}, ${reply.kind === "turn" ? "waiting" : "queued"})
    on conflict (kind, dedupe_key) do nothing
    returning id
  `;

  if (!created) {
    const [raced] = await tx<{ id: string }[]>`
      select id from app.email_replies where kind = ${reply.kind} and dedupe_key = ${reply.dedupeKey}
    `;
    return { created: false, id: raced!.id };
  }

  await publishJob(tx, {
    dedupeKey: `reply:${id}`,
    kind: EMAIL_REPLY_JOB,
    maxAttempts: REPLY_ATTEMPTS,
    payload: { replyId: id },
    ...(reply.kind === "turn" ? { runAfter: new Date(Date.now() + TURN_REPLY_DELAY_SECONDS * 1000) } : {}),
  });
  return { created: true, id };
}

// From the session-owner hook when a turn ends: the replies waiting on inputs
// that session completed, or on any input of a session that failed for good,
// are due now, so the next worker run sends them.
export async function wakeTurnReplies(db: Database, sessionId: string) {
  await db`
    update app.jobs j set run_after = now(), updated_at = now()
    from app.email_replies e
    join app.conversation_inputs i on i.id = e.input_id
    join app.agent_sessions s on s.session_id = i.session_id
    where i.session_id = ${sessionId} and (i.state = 'completed' or s.state = 'failed') and e.state = 'waiting'
      and j.kind = ${EMAIL_REPLY_JOB} and j.state = 'pending' and j.payload ->> 'replyId' = e.id::text
  `;
}

// ---------------------------------------------------------------------------
// Texts

const FOOTER: Readonly<Record<RequestLanguage, string>> = {
  en: "To pick a time or agree to one, open the booking link Find Me a Time emailed you. Replies to this thread reach the assistant.",
  ko: "시간을 고르거나 동의하려면 Find Me a Time이 이메일로 보낸 예약 링크를 여세요. 이 스레드에 답장하면 어시스턴트에게 전달됩니다.",
};

const FALLBACK: Readonly<Record<RequestLanguage, string>> = {
  en: "I could not finish a reply. Please write again, or continue at your booking link.",
  ko: "답변을 마치지 못했습니다. 다시 보내 주시거나 예약 링크에서 이어 가 주세요.",
};

export function withFooter(text: string, language: RequestLanguage) {
  const body = text.trim().slice(0, MAX_REPLY_CHARS);
  return `${body}\n\n--\n${FOOTER[language]}`;
}

// The turn's final assistant text: the message.completed texts that end a step
// with something other than tool calls, among the events the input's delivery
// owns, in order.
export function turnReplyText(events: readonly MessageStreamEvent[], deliveryIds: readonly string[]) {
  const owned = new Set(deliveryIds);
  const texts = events
    .filter((event) => event.meta.deliveryIds?.some((id) => owned.has(id)))
    .filter((event) => event.type === "message.completed")
    .map((event) => event.data as { message?: string; finishReason?: string })
    .filter((data) => data.finishReason !== "tool-calls" && typeof data.message === "string" && data.message.trim())
    .map((data) => data.message!.trim());

  return texts.length > 0 ? texts.join("\n\n") : null;
}

// ---------------------------------------------------------------------------
// The job

export type EmailReplyDependencies = {
  // Its own connection: dispatching commits before the send, outside the job's
  // transaction.
  readonly db: Database;
  readonly config: AgentMailConfig;
  readonly tokenKeys: readonly TokenKey[];
  readonly runtime: ConversationRuntime;
  readonly signingKey: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly transport?: AgentMailTransport;
};

function replyDependenciesFromEnvironment(): EmailReplyDependencies {
  return {
    config: agentMailConfigFromEnvironment(),
    db: database(),
    runtime: eveRuntime(agentUrlFromEnvironment()),
    signingKey: internalSigningKey(),
    tokenKeys: [tokenKeyFromEnvironment()],
  };
}

type ReplyRow = {
  readonly id: string;
  readonly kind: ReplyKind;
  readonly request_id: string | null;
  readonly binding_id: string | null;
  readonly inbox_id: string;
  readonly reply_to_message_id: string;
  readonly input_id: string | null;
  readonly template: string | null;
  readonly language: RequestLanguage;
  readonly parameters: EmailParameters;
  readonly text: string | null;
  readonly secret_ciphertext: string | null;
  readonly secret_key_id: string | null;
  readonly state: ReplyState;
  readonly expired: boolean;
};

// Final states clear the text and the sealed secret in the same write.
async function finish(
  tx: Transaction | Database,
  replyId: string,
  from: ReplyState,
  to: "accepted" | "rejected" | "uncertain" | "suppressed",
  evidence: Record<string, unknown>,
  providerMessageId: string | null = null,
) {
  const rows = await tx`
    update app.email_replies
    set state = ${to}, evidence = ${tx.json(evidence as Parameters<typeof tx.json>[0])}, provider_message_id = ${providerMessageId},
        text = null, secret_ciphertext = null, secret_key_id = null, completed_at = now(), updated_at = now()
    where id = ${replyId} and state = ${from}
  `;
  return rows.count > 0;
}

// A notice's text, rendered from its template and sealed secrets, or null.
function renderNotice(deps: EmailReplyDependencies, reply: ReplyRow) {
  if (!reply.template || !isEmailTemplate(reply.template) || !reply.secret_ciphertext || !reply.secret_key_id) return null;

  try {
    const secrets = JSON.parse(
      openToken(deps.tokenKeys, { ciphertext: reply.secret_ciphertext, keyId: reply.secret_key_id }, replySecretContext(reply.id)),
    ) as EmailSecrets;
    return renderEmail(reply.template, reply.language, reply.parameters, secrets).text;
  } catch {
    return null;
  }
}

// The turn is not over yet: the attempt fails and the job tries again later.
export class TurnNotEndedError extends Error {
  constructor() {
    super("The turn that serves this message has not ended.");
    this.name = "TurnNotEndedError";
  }
}

// The text of a turn reply, read from the session's recorded events.
async function turnText(deps: EmailReplyDependencies, reply: ReplyRow) {
  const [input] = await deps.db<
    {
      state: string;
      delivery_ids: string[];
      session_id: string | null;
      discussion_id: string;
      generation: number | null;
      principal_id: string | null;
      principal_type: string | null;
      session_state: string | null;
    }[]
  >`
    select i.state, i.delivery_ids, i.session_id, i.discussion_id, s.generation, s.principal_id, s.principal_type,
           s.state as session_state
    from app.conversation_inputs i left join app.agent_sessions s on s.session_id = i.session_id
    where i.id = ${reply.input_id!}
  `;

  if (!input) return { done: true as const, text: null };
  // A session that failed for good ends no turn: the fallback answers instead.
  if (input.session_state === "failed") return { done: true as const, text: null };
  if (input.state !== "completed") throw new TurnNotEndedError();
  if (!input.session_id || input.delivery_ids.length === 0) return { done: true as const, text: null };

  const bearer = signInternalBearer(
    {
      discussionId: input.discussion_id,
      generation: input.generation!,
      kind: "read",
      principal: { id: input.principal_id!, type: input.principal_type as "requester_request" },
      sessionId: input.session_id,
    },
    deps.signingKey,
  );
  const events: MessageStreamEvent[] = [];

  for await (const event of deps.runtime.readRecordedEvents(input.session_id, bearer, AbortSignal.timeout(10_000))) {
    events.push(event);
  }

  return { done: true as const, text: turnReplyText(events, input.delivery_ids) };
}

export type ReplyJobOutcome = { readonly replyId: string | null; readonly state: ReplyState | "missing" };

export function createEmailReplyHandler(load: () => EmailReplyDependencies = replyDependenciesFromEnvironment): JobHandler {
  const handler: JobHandler = async (tx, job): Promise<ReplyJobOutcome> => {
    const replyId = typeof job.payload.replyId === "string" ? job.payload.replyId : null;
    if (!replyId) return { replyId, state: "missing" };

    const deps = load();
    const transport = deps.transport ?? agentMailTransport(deps.config, deps.env);
    // A denied environment touches no reply state.
    assertMessagingAdmitted(transport.endpoint, deps.env);
    const select = (q: Transaction | Database) => q<ReplyRow[]>`
      select id, kind, request_id, binding_id, inbox_id, reply_to_message_id, input_id, template, language, parameters,
             text, secret_ciphertext, secret_key_id, state,
             coalesce(first_dispatched_at < now() - make_interval(hours => ${REPLY_RETRY_HOURS}), false) as expired
      from app.email_replies where id = ${replyId}
      for update
    `;

    // A turn reply's text is read before anything is locked: reading the
    // session can take seconds.
    const [peek] = await deps.db<{ kind: ReplyKind; state: ReplyState }[]>`
      select kind, state from app.email_replies where id = ${replyId}
    `;
    if (!peek) return { replyId, state: "missing" };

    let readText: string | null | undefined;

    if (peek.kind === "turn" && peek.state === "waiting") {
      const [row] = await select(deps.db);
      readText = row ? (await turnText(deps, row)).text : null;
    }

    // Phase 1, committed before any network call.
    const claim = await deps.db.begin(async (claimTx) => {
      const [reply] = await select(claimTx);
      if (!reply) return { state: "missing" as const };

      if (reply.state === "dispatching") {
        if (reply.expired) {
          await finish(claimTx, reply.id, "dispatching", "uncertain", { reason: "retry_horizon" });
          return { state: "uncertain" as const };
        }
        // Sent again below with the same key and the same text: a notice is
        // rendered again from its sealed parameters, which gives the same text.
        assertMessagingAdmitted(transport.endpoint, deps.env);
        const again = reply.kind === "notice" ? renderNotice(deps, reply) : reply.text;
        if (again === null) {
          await finish(claimTx, reply.id, "dispatching", "uncertain", { reason: "unrenderable" });
          return { state: "uncertain" as const };
        }
        return { reply, state: "dispatching" as const, text: again };
      }

      if (reply.state !== "waiting" && reply.state !== "queued") return { state: reply.state };

      if (reply.binding_id) {
        const [binding] = await claimTx<{ state: string }[]>`select state from app.email_threads where id = ${reply.binding_id}`;
        if (binding?.state !== "active") {
          await finish(claimTx, reply.id, reply.state, "suppressed", { reason: "thread_unlinked" });
          return { state: "suppressed" as const };
        }
      }

      if (reply.kind === "notice" && reply.request_id && reply.template && isEmailTemplate(reply.template)) {
        if (!(await noticeStillCurrent(claimTx, reply.template, reply.request_id, reply.parameters))) {
          await finish(claimTx, reply.id, reply.state, "suppressed", { reason: "notice_not_current" });
          return { state: "suppressed" as const };
        }
      }

      // Denied environments fail the attempt before dispatching; nothing is
      // marked and nothing falls back.
      assertMessagingAdmitted(transport.endpoint, deps.env);

      let text: string;

      if (reply.kind === "turn") {
        if (readText === undefined) throw new TurnNotEndedError();
        // The model's text is redacted like any input, so no link or code leaves.
        text = withFooter(redactCredentials(readText ?? FALLBACK[reply.language], { bareUuids: true }), reply.language);
      } else if (reply.kind === "notice") {
        const rendered = renderNotice(deps, reply);
        if (rendered === null) {
          await finish(claimTx, reply.id, reply.state, "rejected", { reason: "unrenderable" });
          return { state: "rejected" as const };
        }
        text = rendered;
      } else {
        text = reply.text ?? "";
      }

      // A notice keeps only its sealed parameters until a final state, so no
      // usable booking link is stored while it may be sent again.
      await claimTx`
        update app.email_replies
        set state = 'dispatching', text = ${reply.kind === "notice" ? null : text},
            first_dispatched_at = coalesce(first_dispatched_at, now()), updated_at = now()
        where id = ${reply.id}
      `;
      return { reply, state: "dispatching" as const, text };
    });

    if (claim.state !== "dispatching") return { replyId, state: claim.state };

    let outcome: ReplyOutcome;

    try {
      outcome = await transport.reply(claim.reply.inbox_id, claim.reply.reply_to_message_id, claim.text, claim.reply.id);
    } catch {
      outcome = { httpStatus: null, reason: "lost_response", status: "uncertain" };
    }

    if (outcome.status === "accepted") {
      await finish(tx, replyId, "dispatching", "accepted", { threadId: outcome.threadId }, outcome.messageId);
      return { replyId, state: "accepted" };
    }

    if (outcome.status === "rejected") {
      await finish(tx, replyId, "dispatching", "rejected", { httpStatus: outcome.httpStatus });
      return { replyId, state: "rejected" };
    }

    if (outcome.reason === "conflict") {
      await finish(tx, replyId, "dispatching", "uncertain", { httpStatus: outcome.httpStatus, reason: "conflict" });
      return { replyId, state: "uncertain" };
    }

    // Uncertain: the next attempt sends the same text under the same key.
    throw new Error(`Reply outcome uncertain (${outcome.reason}).`);
  };

  // Attempts spent: a reply that may have gone out is uncertain; one that never
  // left (its turn never ended, or the environment denied it) is suppressed.
  handler.onExhausted = async (tx, job) => {
    const replyId = typeof job.payload.replyId === "string" ? job.payload.replyId : null;
    if (!replyId) return;
    await finish(tx, replyId, "dispatching", "uncertain", { reason: "attempts_exhausted" });
    await finish(tx, replyId, "waiting", "suppressed", { reason: "attempts_exhausted" });
    await finish(tx, replyId, "queued", "suppressed", { reason: "attempts_exhausted" });
  };

  handler.messagingEndpoint = () => {
    try {
      const deps = load();
      return (deps.transport ?? agentMailTransport(deps.config, deps.env)).endpoint;
    } catch {
      return AGENTMAIL_API_URL;
    }
  };

  return handler;
}
