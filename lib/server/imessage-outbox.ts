import type { MessageStreamEvent } from "eve/client";
import type { MessagingChannel } from "../contracts/messaging-channel";
import { agentUrlFromEnvironment, type ConversationRuntime, eveRuntime } from "./conversations";
import { database, type Database, type Transaction } from "./database";
import { turnReplyText } from "./email-replies";
import { internalSigningKey, signInternalBearer } from "./internal-bearer";
import { type JobHandler, publishJob } from "./jobs";
import { assertMessagingAdmitted } from "./messaging";
import { type PhotonConfig, photonConfig, type PhotonContent, type PhotonRecipient, type PhotonTransport, photonTransport, SPECTRUM_ENDPOINT } from "./photon";
import { requestRef } from "./imessage-refs";
import { redactCredentials } from "./redaction";
import { openToken, sealToken, type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// Every message the iMessage line sends (host-imessage-channel design 3 and 9,
// D9). recordOutbound stores one row in the caller's transaction, with the
// recipient and the text sealed, and publishes its imessage_send job. A turn
// reply waits for the turn that served its forwarded message: the session-owner
// hook brings its job forward when that turn ends, and the job otherwise retries
// until it does. The job then:
//   1. freezes the text: the turn's final assistant text, redacted and capped
//      (a fixed fallback when the turn produced none or its session failed for
//      good), or the recorded text;
//   2. suppresses a host-private message whose binding is no longer active;
//   3. moves the row to dispatching and commits before the network call;
//   4. sends once: accepted and rejected are final; unavailable (nothing left)
//      returns the row to queued with its frozen text and fails the attempt; uncertain is final and
//      never sent again. A row found dispatching by a later attempt means a send
//      began and its answer was lost, so it becomes uncertain.
// Every final state clears the sealed recipient and text.
// Rows carry their channel (host-whatsapp-channel design 4 and 9): a row that
// names a binding or a link attempt takes its channel unless the caller gives
// one, and the transport sends it on that platform. A template row (WhatsApp
// only) sends its template with the sealed text as the one body parameter.
// WhatsApp's 24-hour window (design 7 and 8, D8, D9): free-form WhatsApp text is
// dispatched only while the host's last message is at most 23 hours 50 minutes
// old (a reply with no binding counts from when it was recorded, right after the
// message it answers); otherwise, or when Meta refuses it as outside the window,
// the row ends with category window_closed and is never sent as text. A closed
// window's summary of a new request, a proposal awaiting approval or a booking
// outcome queues one template instead, at most one per host per 12 hours and at
// most the daily limit per line.

export const IMESSAGE_SEND_JOB = "imessage_send";
// A refusal before sending retries with backoff; five attempts span about five minutes.
export const SEND_ATTEMPTS = 5;
// A turn reply's attempts: doubling from 20 seconds, 8 span about 40 minutes,
// past the 30 minutes a turn reply may wait (design 9).
export const TURN_REPLY_ATTEMPTS = 8;
export const TURN_REPLY_DELAY_SECONDS = 20;
export const TURN_REPLY_WAIT_MINUTES = 30;
export const MAX_TURN_REPLY_CHARS = 2_000;

// The window a free-form WhatsApp message must fall in at dispatch (D8).
export const WHATSAPP_WINDOW_MINUTES = 23 * 60 + 50;
export const TEMPLATE_HOST_HOURS = 12;
export const TEMPLATE_DAILY_LIMIT = 50;

// The template for each summary the window closed on (design 8); other summaries get none.
export const TEMPLATE_FOR_NOTICE: Readonly<Record<string, string>> = {
  awaiting_approval: "fmat_proposal_waiting",
  booking_confirmed: "fmat_booking_update",
  booking_failed: "fmat_booking_update",
  new_request: "fmat_request_received",
};

export function templateDailyLimit(env: Readonly<Record<string, string | undefined>> = process.env) {
  const value = Number(env.PHOTON_WHATSAPP_TEMPLATE_DAILY_LIMIT);
  return Number.isInteger(value) && value >= 0 && env.PHOTON_WHATSAPP_TEMPLATE_DAILY_LIMIT?.trim() ? value : TEMPLATE_DAILY_LIMIT;
}

export type OutboxKind =
  | "link_received"
  | "link_refused"
  | "linked"
  | "fallback_code"
  | "unlinked_sender"
  | "text_only"
  | "command"
  | "turn"
  | "notice"
  | "contact_card"
  | "template";

export type OutboxState = "waiting" | "queued" | "dispatching" | "accepted" | "failed" | "uncertain" | "suppressed";

export type RecordOutbound = {
  readonly kind: OutboxKind;
  // The platform; by default the binding's or the link attempt's, else iMessage.
  readonly channel?: MessagingChannel;
  // A template row's template (WhatsApp only).
  readonly templateName?: string;
  // One message per (kind, dedupeKey): a retried recording returns the existing one.
  readonly dedupeKey: string;
  readonly recipient: PhotonRecipient;
  // The keyed hash of the recipient's address.
  readonly recipientHash: string;
  readonly tokenKey: TokenKey;
  readonly hostAccountId?: string | null;
  // Set for a host-private message, which is suppressed once the binding ends.
  readonly bindingId?: string | null;
  readonly linkId?: string | null;
  readonly requestId?: string | null;
  // A turn reply names its input and waits for its turn.
  readonly inputId?: string;
  // The frozen text; none for a turn reply or a contact card.
  readonly text?: string;
  // Records the message as already suppressed with this category, sending
  // nothing, so it still counts toward the send limits.
  readonly suppressedAs?: string;
};

export function outboxSealContext(outboxId: string) {
  return `imessage_outbox:${outboxId}`;
}

export async function recordOutbound(tx: Transaction, message: RecordOutbound): Promise<{ id: string; created: boolean }> {
  const [existing] = await tx<{ id: string }[]>`
    select id from app.imessage_outbox where kind = ${message.kind} and dedupe_key = ${message.dedupeKey}
  `;
  if (existing) return { created: false, id: existing.id };

  const [row] = await tx<{ id: string }[]>`select gen_random_uuid() as id`;
  const id = row!.id;
  const context = outboxSealContext(id);
  const suppressed = message.suppressedAs ?? null;
  const recipient = suppressed ? null : sealToken(message.tokenKey, JSON.stringify(message.recipient), context);
  const text = suppressed || message.text === undefined ? null : sealToken(message.tokenKey, message.text, context);
  const turn = message.kind === "turn";
  const channel = message.channel ?? (await ownerChannel(tx, message));

  const [created] = await tx<{ id: string }[]>`
    insert into app.imessage_outbox
      (id, channel, kind, template_name, dedupe_key, host_account_id, binding_id, link_id, request_id, input_id, recipient_hash,
       recipient_ciphertext, text_ciphertext, sealed_key_id, state, failure_category, completed_at)
    values
      (${id}, ${channel}, ${message.kind}, ${message.templateName ?? null}, ${message.dedupeKey}, ${message.hostAccountId ?? null}, ${message.bindingId ?? null},
       ${message.linkId ?? null}, ${message.requestId ?? null}, ${message.inputId ?? null}, ${message.recipientHash},
       ${recipient?.ciphertext ?? null}, ${text?.ciphertext ?? null}, ${message.tokenKey.id},
       ${suppressed ? "suppressed" : turn ? "waiting" : "queued"}, ${suppressed},
       ${suppressed ? new Date() : null})
    on conflict (kind, dedupe_key) do nothing
    returning id
  `;

  if (!created) {
    const [raced] = await tx<{ id: string }[]>`
      select id from app.imessage_outbox where kind = ${message.kind} and dedupe_key = ${message.dedupeKey}
    `;
    return { created: false, id: raced!.id };
  }

  if (suppressed) return { created: true, id };

  await publishJob(tx, {
    dedupeKey: `outbox:${id}`,
    kind: IMESSAGE_SEND_JOB,
    maxAttempts: turn ? TURN_REPLY_ATTEMPTS : SEND_ATTEMPTS,
    payload: { outboxId: id },
    ...(turn ? { runAfter: new Date(Date.now() + TURN_REPLY_DELAY_SECONDS * 1000) } : {}),
  });
  return { created: true, id };
}

async function ownerChannel(tx: Transaction, message: RecordOutbound): Promise<MessagingChannel> {
  if (message.bindingId) {
    const [binding] = await tx<{ channel: MessagingChannel }[]>`select channel from app.imessage_bindings where id = ${message.bindingId}`;
    if (binding) return binding.channel;
  }
  if (message.linkId) {
    const [link] = await tx<{ channel: MessagingChannel }[]>`select channel from app.imessage_links where id = ${message.linkId}`;
    if (link) return link.channel;
  }
  return "imessage";
}

// From the session-owner hook when a turn ends: the replies waiting on inputs
// that session completed, or on any input of a session that failed for good, are
// due now, so the next worker run sends them.
export async function wakeImessageReplies(db: Database, sessionId: string) {
  await db`
    update app.jobs j set run_after = now(), updated_at = now()
    from app.imessage_outbox o
    join app.conversation_inputs i on i.id = o.input_id
    join app.agent_sessions s on s.session_id = i.session_id
    where i.session_id = ${sessionId} and (i.state = 'completed' or s.state = 'failed') and o.state = 'waiting'
      and j.kind = ${IMESSAGE_SEND_JOB} and j.state = 'pending' and j.payload ->> 'outboxId' = o.id::text
  `;
}

export const TURN_FALLBACK = "I couldn't finish that. You can continue in Find Me a Time on the web.";

// A turn's text as iMessage sends it: redacted like any input, so no link or
// code leaves, and capped with a pointer to the web.
export function imessageTurnText(text: string | null, origin: string) {
  if (!text) return TURN_FALLBACK;
  const redacted = redactCredentials(text, { bareUuids: true }).trim();
  const chars = Array.from(redacted);
  if (chars.length <= MAX_TURN_REPLY_CHARS) return redacted;
  return `${chars.slice(0, MAX_TURN_REPLY_CHARS - 80).join("").trimEnd()}…\n\nThe rest is in Find Me a Time: ${origin.replace(/\/+$/, "")}/app`;
}

// ---------------------------------------------------------------------------
// The job

export type ImessageSendDependencies = {
  // Its own connection: dispatching commits before the send, outside the job's
  // transaction.
  readonly db: Database;
  readonly config: PhotonConfig;
  readonly tokenKeys: readonly TokenKey[];
  readonly runtime: ConversationRuntime;
  readonly signingKey: string;
  // The canonical origin a capped turn reply points to.
  readonly origin: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly transport?: PhotonTransport;
  // Template notices per WhatsApp line per rolling 24 hours (PHOTON_WHATSAPP_TEMPLATE_DAILY_LIMIT).
  readonly templateDailyLimit?: number;
};

function sendDependenciesFromEnvironment(): ImessageSendDependencies {
  return {
    config: photonConfig(),
    db: database(),
    origin: process.env.APP_ORIGIN?.trim() || "https://findmeatime.com",
    runtime: eveRuntime(agentUrlFromEnvironment()),
    signingKey: internalSigningKey(),
    templateDailyLimit: templateDailyLimit(),
    tokenKeys: [tokenKeyFromEnvironment()],
  };
}

type OutboxRow = {
  readonly id: string;
  readonly channel: MessagingChannel;
  readonly kind: OutboxKind;
  readonly template_name: string | null;
  readonly dedupe_key: string;
  readonly host_account_id: string | null;
  readonly request_id: string | null;
  // Recorded within the WhatsApp window of now (a reply without a binding).
  readonly fresh: boolean;
  readonly binding_id: string | null;
  readonly input_id: string | null;
  readonly recipient_ciphertext: string | null;
  readonly text_ciphertext: string | null;
  readonly sealed_key_id: string | null;
  readonly state: OutboxState;
  readonly stale: boolean;
};

async function finish(
  q: Transaction | Database,
  outboxId: string,
  from: OutboxState,
  to: "accepted" | "failed" | "uncertain" | "suppressed",
  details: { readonly category?: string; readonly providerMessageId?: string | null } = {},
) {
  const rows = await q`
    update app.imessage_outbox
    set state = ${to}, failure_category = ${details.category ?? null}, provider_message_id = ${details.providerMessageId ?? null},
        recipient_ciphertext = null, text_ciphertext = null, completed_at = now(), updated_at = now()
    where id = ${outboxId} and state = ${from}
  `;
  return rows.count > 0;
}

function open(deps: ImessageSendDependencies, row: OutboxRow, ciphertext: string | null) {
  if (!ciphertext || !row.sealed_key_id) return null;
  try {
    return openToken(deps.tokenKeys, { ciphertext, keyId: row.sealed_key_id }, outboxSealContext(row.id));
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

// The final text of the turn that served a reply's input, from the session's
// recorded events; null when the turn produced none or its session failed.
async function turnText(deps: ImessageSendDependencies, inputId: string) {
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
    where i.id = ${inputId}
  `;

  if (!input || input.session_state === "failed") return null;
  if (input.state !== "completed") throw new TurnNotEndedError();
  if (!input.session_id || input.delivery_ids.length === 0) return null;

  const bearer = signInternalBearer(
    {
      discussionId: input.discussion_id,
      generation: input.generation!,
      kind: "read",
      principal: { id: input.principal_id!, type: input.principal_type as "host_account" },
      sessionId: input.session_id,
    },
    deps.signingKey,
  );
  const events: MessageStreamEvent[] = [];

  for await (const event of deps.runtime.readRecordedEvents(input.session_id, bearer, AbortSignal.timeout(10_000))) {
    events.push(event);
  }

  return turnReplyText(events, input.delivery_ids);
}

export type SendJobOutcome = { readonly outboxId: string | null; readonly state: OutboxState | "missing" };

export function createImessageSendHandler(load: () => ImessageSendDependencies = sendDependenciesFromEnvironment): JobHandler {
  const handler: JobHandler = async (tx, job): Promise<SendJobOutcome> => {
    const outboxId = typeof job.payload.outboxId === "string" ? job.payload.outboxId : null;
    if (!outboxId) return { outboxId, state: "missing" };

    const deps = load();
    const transport = deps.transport ?? photonTransport(deps.config, deps.env);
    // A denied environment touches no outbound state.
    assertMessagingAdmitted(transport.endpoint, deps.env);
    const select = (q: Transaction | Database) => q<OutboxRow[]>`
      select id, channel, kind, template_name, dedupe_key, host_account_id, request_id, binding_id, input_id, recipient_ciphertext,
             text_ciphertext, sealed_key_id, state,
             created_at < now() - make_interval(mins => ${TURN_REPLY_WAIT_MINUTES}) as stale,
             created_at > now() - make_interval(mins => ${WHATSAPP_WINDOW_MINUTES}) as fresh
      from app.imessage_outbox where id = ${outboxId}
      for update
    `;

    // A turn reply's text is read before anything is locked: reading the
    // session can take seconds.
    const [peek] = await deps.db<{ kind: OutboxKind; state: OutboxState; input_id: string | null; stale: boolean }[]>`
      select kind, state, input_id, created_at < now() - make_interval(mins => ${TURN_REPLY_WAIT_MINUTES}) as stale
      from app.imessage_outbox where id = ${outboxId}
    `;
    if (!peek) return { outboxId, state: "missing" };

    let readText: string | null | undefined;

    if (peek.kind === "turn" && peek.state === "waiting" && peek.input_id) {
      try {
        readText = await turnText(deps, peek.input_id);
      } catch (error) {
        if (!(error instanceof TurnNotEndedError)) throw error;
        // A turn that has not ended within the wait gets no reply.
        if (peek.stale) {
          await finish(deps.db, outboxId, "waiting", "suppressed", { category: "turn_not_ended" });
          return { outboxId, state: "suppressed" };
        }
        throw error;
      }
    }

    // Phase 1, committed before any network call.
    const claim = await deps.db.begin(async (claimTx) => {
      const [row] = await select(claimTx);
      if (!row) return { state: "missing" as const };

      // An earlier attempt began this send and lost its answer.
      if (row.state === "dispatching") {
        await finish(claimTx, row.id, "dispatching", "uncertain", { category: "lost_answer" });
        return { state: "uncertain" as const };
      }

      if (row.state !== "waiting" && row.state !== "queued") return { state: row.state };

      let inWindow = row.fresh;

      if (row.binding_id) {
        const [binding] = await claimTx<{ state: string; in_window: boolean }[]>`
          select state, coalesce(last_inbound_at > now() - make_interval(mins => ${WHATSAPP_WINDOW_MINUTES}), false) as in_window
          from app.imessage_bindings where id = ${row.binding_id}
        `;
        if (binding?.state !== "active") {
          await finish(claimTx, row.id, row.state, "suppressed", { category: "unlinked" });
          return { state: "suppressed" as const };
        }
        inWindow = binding.in_window;
      }

      // Free-form WhatsApp text outside the window is never sent (D8).
      if (row.channel === "whatsapp" && row.kind !== "template" && !inWindow) {
        await finish(claimTx, row.id, row.state, "suppressed", { category: WINDOW_CLOSED });
        await queueTemplate(claimTx, deps, row);
        return { state: "suppressed" as const };
      }

      // Denied environments fail the attempt before dispatching; nothing is
      // marked and nothing falls back.
      assertMessagingAdmitted(transport.endpoint, deps.env);

      const recipientJson = open(deps, row, row.recipient_ciphertext);
      if (!recipientJson) {
        await finish(claimTx, row.id, row.state, "failed", { category: "unreadable" });
        return { state: "failed" as const };
      }

      let text: string | null = null;

      if (row.kind === "turn" && row.state === "waiting") {
        if (readText === undefined) throw new TurnNotEndedError();
        text = imessageTurnText(readText, deps.origin);
      } else if (row.kind !== "contact_card") {
        // Every other message, a turn reply already frozen by an attempt that
        // found Photon unavailable included, sends its recorded text.
        text = open(deps, row, row.text_ciphertext);
        if (text === null) {
          await finish(claimTx, row.id, row.state, "failed", { category: "unreadable" });
          return { state: "failed" as const };
        }
      }

      const context = outboxSealContext(row.id);
      const frozen = text === null ? null : sealToken({ id: row.sealed_key_id!, key: keyOf(deps, row.sealed_key_id!) }, text, context);
      await claimTx`
        update app.imessage_outbox
        set state = 'dispatching', text_ciphertext = coalesce(${frozen?.ciphertext ?? null}, text_ciphertext),
            dispatched_at = now(), updated_at = now()
        where id = ${row.id}
      `;
      return { recipient: JSON.parse(recipientJson) as PhotonRecipient, row, state: "dispatching" as const, text };
    });

    if (claim.state !== "dispatching") return { outboxId, state: claim.state };

    let result;

    try {
      result = await transport.send({
        channel: claim.row.channel,
        content: contentOf(claim.row, claim.text),
        idempotencyKey: claim.row.id,
        recipient: claim.recipient,
      });
    } catch {
      result = { status: "uncertain" as const };
    }

    if (result.status === "accepted") {
      await finish(tx, outboxId, "dispatching", "accepted", { providerMessageId: result.messageId });
      return { outboxId, state: "accepted" };
    }

    if (result.status === "rejected") {
      await finish(tx, outboxId, "dispatching", "failed", { category: result.category });
      if (result.category === WINDOW_CLOSED && claim.row.kind !== "template") await queueTemplate(tx, deps, claim.row);
      return { outboxId, state: "failed" };
    }

    if (result.status === "unavailable") {
      // Nothing was sent: the row goes back to the queue on its own connection,
      // since the job's transaction rolls back with the failed attempt.
      await deps.db`
        update app.imessage_outbox set state = 'queued', failure_category = 'unavailable', updated_at = now()
        where id = ${outboxId} and state = 'dispatching'
      `;
      throw new Error("Photon was unavailable before sending.");
    }

    await finish(tx, outboxId, "dispatching", "uncertain", { category: "lost_answer" });
    return { outboxId, state: "uncertain" };
  };

  // Attempts spent: a message that never left (its turn never ended, Photon
  // stayed unavailable, or the environment denied it) is failed; one found
  // dispatching may have gone out, so it is uncertain.
  handler.onExhausted = async (tx, job) => {
    const outboxId = typeof job.payload.outboxId === "string" ? job.payload.outboxId : null;
    if (!outboxId) return;
    await finish(tx, outboxId, "dispatching", "uncertain", { category: "attempts_exhausted" });
    await finish(tx, outboxId, "waiting", "suppressed", { category: "attempts_exhausted" });
    await finish(tx, outboxId, "queued", "failed", { category: "attempts_exhausted" });
  };

  handler.messagingEndpoint = () => {
    try {
      const deps = load();
      return (deps.transport ?? photonTransport(deps.config, deps.env)).endpoint;
    } catch {
      return SPECTRUM_ENDPOINT;
    }
  };

  return handler;
}

export const WINDOW_CLOSED = "window_closed";

// The summary a closed window stopped becomes one template (design 8): only for
// the events that have one, only to an active WhatsApp binding, and only within
// the per-host and per-line limits. Its one parameter is the request reference;
// it carries no meeting detail. Keyed by the summary, so a retry queues it once.
async function queueTemplate(
  q: Transaction | Database,
  deps: ImessageSendDependencies,
  row: Pick<OutboxRow, "kind" | "dedupe_key" | "binding_id" | "host_account_id" | "request_id">,
) {
  if (row.kind !== "notice" || !row.binding_id || !row.host_account_id || !row.request_id) return;
  const event = row.dedupe_key.split(":")[1] ?? "";
  const templateName = TEMPLATE_FOR_NOTICE[event];
  if (!templateName) return;

  const [binding] = await q<
    { id: string; sender_hash: string; sender_ciphertext: string | null; space_ciphertext: string | null; sealed_key_id: string }[]
  >`
    select id, sender_hash, sender_ciphertext, space_ciphertext, sealed_key_id from app.imessage_bindings
    where id = ${row.binding_id} and state = 'active' and channel = 'whatsapp'
  `;
  if (!binding?.sender_ciphertext) return;

  await q`select pg_advisory_xact_lock(hashtextextended('app.whatsapp_templates', 0))`;
  const [counts] = await q<{ host: number; line: number }[]>`
    select count(*) filter (where host_account_id = ${row.host_account_id} and created_at > now() - make_interval(hours => ${TEMPLATE_HOST_HOURS}))::int as host,
           count(*)::int as line
    from app.imessage_outbox where kind = 'template' and created_at > now() - interval '24 hours'
  `;
  if (counts!.host > 0 || counts!.line >= (deps.templateDailyLimit ?? TEMPLATE_DAILY_LIMIT)) return;

  const open = (ciphertext: string) => openToken(deps.tokenKeys, { ciphertext, keyId: binding.sealed_key_id }, `imessage_binding:${binding.id}`);
  const address = open(binding.sender_ciphertext);
  const tokenKey = deps.tokenKeys.find((key) => key.id === binding.sealed_key_id) ?? deps.tokenKeys[0]!;

  await recordOutbound(q as Transaction, {
    bindingId: binding.id,
    channel: "whatsapp",
    dedupeKey: `template:${row.dedupe_key}`,
    hostAccountId: row.host_account_id,
    kind: "template",
    recipient: { address, spaceId: binding.space_ciphertext ? open(binding.space_ciphertext) : address },
    recipientHash: binding.sender_hash,
    requestId: row.request_id,
    templateName,
    text: requestRef(row.request_id),
    tokenKey,
  });
}

// Templates are registered in en_US (design 8); the sealed text is the request reference.
export const TEMPLATE_LANGUAGE = "en_US";

function contentOf(row: Pick<OutboxRow, "kind" | "template_name">, text: string | null): PhotonContent {
  if (row.kind === "template" && row.template_name) {
    return { kind: "template", languageCode: TEMPLATE_LANGUAGE, name: row.template_name, params: text === null ? [] : [text] };
  }
  return text === null ? { kind: "contact_card" } : { kind: "text", text };
}

function keyOf(deps: ImessageSendDependencies, keyId: string) {
  const key = deps.tokenKeys.find((candidate) => candidate.id === keyId);
  if (!key) throw new Error("The outbox row was sealed with an unknown key.");
  return key.key;
}
