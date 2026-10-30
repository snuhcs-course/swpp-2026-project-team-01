import { createHmac } from "node:crypto";
import { getChatMessageLengthError } from "../contracts/chat-message";
import { isUsableHandle, normalizeHandle } from "../contracts/handles";
import type { RequestLanguage } from "../contracts/request";
import { isValidTimeZone } from "../contracts/timezone";
import {
  AGENTMAIL_API_URL,
  type AgentMailConfig,
  agentMailConfigFromEnvironment,
  agentMailTransport,
  type AgentMailTransport,
  newText,
  type ReceivedMessage,
  senderAddress,
  senderAuthenticated,
  senderHash,
  senderName,
  startsThread,
} from "./agentmail";
import { AdmissionLimitError } from "./conversation-admission";
import { agentUrlFromEnvironment, ConversationClosedError, ConversationInputError, eveRuntime } from "./conversations";
import { CommandError } from "./commands";
import { database, type Database, type Transaction } from "./database";
import { bindByCode, findLinkCode, voidPendingCode } from "./email-links";
import { recordReply } from "./email-replies";
import { acceptGuestMessage, DraftMessageLimitError, type GuestConversationDependencies } from "./guest-conversations";
import { internalSigningKey } from "./internal-bearer";
import type { JobHandler } from "./jobs";
import { findReadyHostByHandle } from "./readiness";
import { assertMessagingAdmitted } from "./messaging";
import { lockOpenRequest } from "./request-guard";
import { admitCreation, CREATION_LIMITS, type CreationLimits, identifyDraft, insertDraftRequest } from "./request-start";
import { isRevisable, reviseClosedRequest, revisedSummary } from "./revised-requests";
import { appOriginsFromEnvironment } from "./same-origin";
import { type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// The email_receipt job (requester-email-channel design 3 and 5): what one
// stored AgentMail receipt may do. The job reads the message with the runtime
// key and checks it against the receipt's locators, then, in order:
//   - a message from the product inbox itself, or whose sender AgentMail did not
//     authenticate for the From domain (D5), does nothing;
//   - a message carrying a link code is never forwarded: it binds its thread
//     only as the Continue by email card wrote it (email-links.ts);
//   - a message in a bound thread from the bound address is forwarded into the
//     request's own requester discussion as an accepted input keyed by the
//     receipt, so a retried job finds the same input, and gets a reply when its
//     turn ends; another sender's message does nothing (D3), a closed request's
//     thread gets one closed notice;
//   - a new thread whose subject names a ready host starts a request (D6), and
//     one that names none gets one fixed reply;
//   - anything else does nothing.
// Admission limits and an unreachable AgentMail fail the attempt, so the receipt
// is retried with backoff rather than dropped (D11).

type Environment = Readonly<Record<string, string | undefined>>;

export type EmailReceiptDependencies = {
  // Its own connection: binding and creation commit before the input is
  // accepted through the conversation path, which uses its own transactions.
  readonly db: Database;
  readonly config: AgentMailConfig;
  readonly conversation: GuestConversationDependencies;
  readonly tokenKey: TokenKey;
  // The canonical origin the creation email's links point at.
  readonly origin: string;
  readonly creationLimits?: Partial<CreationLimits>;
  readonly env?: Environment;
  readonly transport?: AgentMailTransport;
};

function receiptDependenciesFromEnvironment(): EmailReceiptDependencies {
  const db = database();
  return {
    config: agentMailConfigFromEnvironment(),
    conversation: { db, runtime: eveRuntime(agentUrlFromEnvironment()), signingKey: internalSigningKey() },
    db,
    origin: appOriginsFromEnvironment().appOrigin,
    tokenKey: tokenKeyFromEnvironment(),
  };
}

export type ReceiptOutcome = "forwarded" | "linked" | "started" | "replied" | "ignored";

type Receipt = {
  readonly id: string;
  readonly inbox_id: string;
  readonly thread_id: string;
  readonly message_id: string;
  readonly outcome: ReceiptOutcome | null;
};

type Binding = {
  readonly id: string;
  readonly request_id: string;
  readonly origin: "started" | "linked";
  readonly sender_hash: string;
  readonly bound_by_receipt_id: string;
};

// Fixed replies, in the message's language.
export const FIXED_REPLIES = {
  closed: {
    en: "This request is closed, so this thread no longer reaches the assistant. Your booking link shows its final status.",
    ko: "이 요청은 종료되어 이 스레드는 더 이상 어시스턴트에게 전달되지 않습니다. 예약 링크에서 최종 상태를 볼 수 있습니다.",
  },
  limited: {
    en: "Find Me a Time cannot start another request from this address right now. Try again later.",
    ko: "지금은 이 주소로 요청을 더 시작할 수 없습니다. 나중에 다시 시도해 주세요.",
  },
  unprocessed: {
    en: "Your request is created, but this message could not reach the assistant. Please write again, or continue at the booking link we emailed you.",
    ko: "요청은 만들어졌지만 이 메시지는 어시스턴트에게 전달되지 못했습니다. 다시 보내 주시거나 이메일로 받은 예약 링크에서 이어 가 주세요.",
  },
  tooLong: {
    en: "This message is too long for the assistant. Please send a shorter one.",
    ko: "이 메시지는 어시스턴트가 받기에 너무 깁니다. 더 짧게 보내 주세요.",
  },
  unknownHost: {
    en: "Find Me a Time could not tell which host you want to meet. Open the host's page and use its email link, which puts the host's @handle in the subject.",
    ko: "어느 호스트와 만나려는지 알 수 없습니다. 호스트 페이지의 이메일 링크를 사용해 주세요. 제목에 호스트의 @핸들이 들어갑니다.",
  },
} as const satisfies Record<string, Record<RequestLanguage, string>>;

const HANGUL = /[가-힣]/;

export function messageLanguage(text: string): RequestLanguage {
  return HANGUL.test(text) ? "ko" : "en";
}

// The first @handle in the subject that names a usable handle.
export function subjectHandles(subject: string | null | undefined) {
  return [...(subject ?? "").matchAll(/(?:^|[\s(<[])@([A-Za-z0-9][A-Za-z0-9_-]{0,62})/g)]
    .map((match) => normalizeHandle(match[1]!))
    .filter(isUsableHandle);
}

export function carriesLinkCode(text: string) {
  return findLinkCode(text) !== null;
}

// The keyed hash a sender address counts under for the creation bounds.
export function emailSourceHash(key: TokenKey, address: string) {
  const derived = createHmac("sha256", key.key).update("find-me-a-time/email-source/v1").digest();
  return createHmac("sha256", derived).update(address.toLowerCase(), "utf8").digest("hex");
}

async function activeBinding(db: Database | Transaction, inboxId: string, threadId: string) {
  const [row] = await db<Binding[]>`
    select id, request_id, origin, sender_hash, bound_by_receipt_id from app.email_threads
    where inbox_id = ${inboxId} and thread_id = ${threadId} and state = 'active'
  `;
  return row ?? null;
}

async function reply(
  deps: EmailReceiptDependencies,
  receipt: Receipt,
  kind: "start_refusal" | "closed" | "too_long",
  text: string,
  language: RequestLanguage,
  binding: Binding | null,
) {
  await deps.db.begin((tx) =>
    recordReply(tx, {
      bindingId: binding?.id ?? null,
      dedupeKey: `receipt:${receipt.id}`,
      inboxId: receipt.inbox_id,
      kind,
      language,
      replyToMessageId: receipt.message_id,
      requestId: binding?.request_id ?? null,
      text,
    }),
  );
  return "replied" as const;
}

// Forwards the message's text into the request's discussion and records the
// reply its turn will produce. The message that started a request carries its
// subject too.
async function forward(
  deps: EmailReceiptDependencies,
  receipt: Receipt,
  message: ReceivedMessage,
  binding: Binding,
  first: boolean,
): Promise<ReceiptOutcome> {
  const body = newText(message);
  const text = first && message.subject?.trim() ? `Subject: ${message.subject.trim()}\n\n${body}` : body;
  const language = messageLanguage(`${message.subject ?? ""} ${body}`);

  if (!text.trim()) return "ignored";
  if (getChatMessageLengthError(text)) return reply(deps, receipt, "too_long", FIXED_REPLIES.tooLong[language], language, binding);

  const principal = { id: binding.request_id, type: "requester_request" as const };

  try {
    await acceptGuestMessage(deps.conversation, principal, { clientInputId: receipt.id, message: text });
  } catch (error) {
    if (error instanceof ConversationClosedError) {
      // A declined or expired request continues as a revised request
      // (guest-flow-completion design 5); a refusal gets the closed notice.
      const revised = await revise(deps, receipt, binding);
      if (revised) return forward(deps, receipt, message, { ...binding, request_id: revised }, false);

      // The notice and its record commit together, so a retry never loses it.
      return deps.db.begin(async (tx) => {
        const [notice] = await tx<{ id: string }[]>`
          update app.email_threads set closed_notice_at = now()
          where id = ${binding.id} and closed_notice_at is null
          returning id
        `;
        if (!notice) return "ignored" as const;
        await recordReply(tx, {
          bindingId: binding.id,
          dedupeKey: `receipt:${receipt.id}`,
          inboxId: receipt.inbox_id,
          kind: "closed",
          language,
          replyToMessageId: receipt.message_id,
          requestId: binding.request_id,
          text: FIXED_REPLIES.closed[language],
        });
        return "replied" as const;
      });
    }

    // Admission limits retry the receipt later. A runtime refusal leaves the
    // input recorded and accepted: the next message or recovery delivers it, and
    // its reply waits for that turn. Any other refusal of the message itself
    // (a retry conflict, a draft at its cap) will not change on retry.
    if (error instanceof AdmissionLimitError) throw error;
    if (error instanceof DraftMessageLimitError) return "ignored";
    if (error instanceof ConversationInputError && error.code !== "runtime_unavailable") return "ignored";
    if (!(error instanceof ConversationInputError)) throw error;
  }

  const [input] = await deps.db<{ id: string }[]>`
    select i.id from app.conversation_inputs i
    join app.discussions d on d.id = i.discussion_id
    where d.principal_type = 'requester_request' and d.principal_id = ${binding.request_id} and d.audience = 'requester'
      and i.client_input_id = ${receipt.id}
  `;

  if (!input) throw new Error("The forwarded input was not recorded.");

  const [request] = await deps.db<{ language: string | null }[]>`
    select details ->> 'language' as language from app.requests where id = ${binding.request_id}
  `;

  await deps.db.begin(async (tx) => {
    await recordReply(tx, {
      bindingId: binding.id,
      dedupeKey: `input:${input.id}`,
      inboxId: receipt.inbox_id,
      inputId: input.id,
      kind: "turn",
      language: request?.language === "ko" ? "ko" : "en",
      replyToMessageId: receipt.message_id,
      requestId: binding.request_id,
    });
    await tx`
      update app.email_threads set last_message_id = ${receipt.message_id}
      where id = ${binding.id} and state = 'active'
    `;
  });

  return "forwarded";
}

// The revised request the thread now belongs to, with its opening summary
// recorded, or null when the closed request is not revisable or was refused.
async function revise(deps: EmailReceiptDependencies, receipt: Receipt, binding: Binding) {
  const [earlier] = await deps.db<{ id: string; state: string; details: Parameters<typeof revisedSummary>[0]["details"] }[]>`
    select id, state, details from app.requests where id = ${binding.request_id}
  `;
  if (!earlier || !isRevisable(earlier.state)) return null;

  const outcome = await deps.db.begin((tx) =>
    reviseClosedRequest(
      tx,
      { creationLimits: deps.creationLimits, origin: deps.origin, tokenKey: deps.tokenKey, tokenKeys: [deps.tokenKey] },
      earlier.id,
      { kind: "email", messageId: receipt.message_id, receiptId: receipt.id, threadId: binding.id },
      (address) => emailSourceHash(deps.tokenKey, address),
    ),
  );
  if (outcome.kind === "refused") return null;

  try {
    await acceptGuestMessage(
      deps.conversation,
      { id: outcome.requestId, type: "requester_request" },
      { clientInputId: outcome.requestId, message: revisedSummary(earlier) },
    );
  } catch (error) {
    if (!(error instanceof ConversationInputError) || error.code !== "runtime_unavailable") throw error;
  }
  return outcome.requestId;
}

// A new thread naming a ready host starts an identified request (D6) and binds
// the thread to it, in one transaction; the first message is then forwarded.
async function start(
  deps: EmailReceiptDependencies,
  receipt: Receipt,
  message: ReceivedMessage,
  address: string,
): Promise<ReceiptOutcome> {
  const language = messageLanguage(`${message.subject ?? ""} ${newText(message)}`);
  let host: { hostAccountId: string } | null = null;

  for (const handle of subjectHandles(message.subject)) {
    host = await findReadyHostByHandle(deps.db, handle);
    if (host) break;
  }

  if (!host) return reply(deps, receipt, "start_refusal", FIXED_REPLIES.unknownHost[language], language, null);

  let binding: Binding | null;

  try {
    binding = await deps.db.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`app.email_thread:${receipt.inbox_id}:${receipt.thread_id}`}, 0))`;
      const existing = await activeBinding(tx, receipt.inbox_id, receipt.thread_id);
      if (existing) return existing.bound_by_receipt_id === receipt.id ? existing : null;

      await admitCreation(tx, emailSourceHash(deps.tokenKey, address), { ...CREATION_LIMITS, ...deps.creationLimits });

      const [settings] = await tx<{ timezone: string | null }[]>`
        select settings ->> 'timezone' as timezone from app.host_settings where host_account_id = ${host!.hostAccountId}
      `;
      const timezone = settings?.timezone && isValidTimeZone(settings.timezone) ? settings.timezone : "UTC";
      const requestId = await insertDraftRequest(tx, {
        hostAccountId: host!.hostAccountId,
        language,
        sourceHash: emailSourceHash(deps.tokenKey, address),
        timezone,
        tokenKey: deps.tokenKey,
      });
      const request = await lockOpenRequest(tx, requestId);
      await identifyDraft(
        tx,
        request,
        { email: address, language, name: senderName(message.from) ?? address.slice(0, address.indexOf("@")), timezone },
        { origin: deps.origin, tokenKey: deps.tokenKey },
      );

      const [created] = await tx<Binding[]>`
        insert into app.email_threads (request_id, inbox_id, thread_id, origin, sender_hash, bound_by_receipt_id, last_message_id)
        values (${requestId}, ${receipt.inbox_id}, ${receipt.thread_id}, 'started', ${senderHash(deps.tokenKey, address)},
                ${receipt.id}, ${receipt.message_id})
        returning id, request_id, origin, sender_hash, bound_by_receipt_id
      `;
      return created!;
    });
  } catch (error) {
    if (error instanceof CommandError && error.category === "rate_limited") {
      return reply(deps, receipt, "start_refusal", FIXED_REPLIES.limited[language], language, null);
    }
    // A host that stopped taking requests meanwhile is an unknown host.
    if (error instanceof CommandError && error.category === "forbidden") {
      return reply(deps, receipt, "start_refusal", FIXED_REPLIES.unknownHost[language], language, null);
    }
    throw error;
  }

  if (!binding) return "ignored";

  const outcome = await forward(deps, receipt, message, binding, true);
  return outcome === "forwarded" ? "started" : outcome;
}

// Decides what an authenticated read of the receipt's message does.
export async function processReceivedMessage(
  deps: EmailReceiptDependencies,
  receipt: Receipt,
  message: ReceivedMessage,
): Promise<ReceiptOutcome> {
  const address = senderAddress(message.from);

  if (!address || address === deps.config.inboxId) return "ignored";

  if (autoSubmitted(message)) return "ignored";

  const text = `${message.subject ?? ""}\n${newText(message)}`;
  const authenticated = senderAuthenticated(message);
  const binding = await activeBinding(deps.db, receipt.inbox_id, receipt.thread_id);
  const code = findLinkCode(text);

  // A code binds only an unbound thread. In a bound thread a reply's subject or
  // quoted text often repeats the code that linked it; a different pending code
  // seen there is voided, and the text is forwarded with codes redacted.
  if (code && !binding) return linkByCode(deps, receipt, message, code, address, authenticated);
  if (binding?.bound_by_receipt_id === receipt.id && binding.origin === "linked") return "linked";
  if (code) await voidPendingCode(deps.db, code);
  if (!authenticated) return "ignored";

  if (binding) {
    // The message that bound this thread, seen again by a retry: a linking
    // message is never forwarded; a starting one is forwarded once.
    if (binding.bound_by_receipt_id === receipt.id) {
      if (binding.origin === "linked") return "linked";
      const outcome = await forward(deps, receipt, message, binding, true);
      return outcome === "forwarded" ? "started" : outcome;
    }

    return binding.sender_hash === senderHash(deps.tokenKey, address) ? forward(deps, receipt, message, binding, false) : "ignored";
  }

  if (startsThread(message)) return start(deps, receipt, message, address);

  // A reply that arrived before the thread's first message was processed waits
  // for it, rather than being ignored for good.
  const [earlier] = await deps.db<{ id: string }[]>`
    select id from app.email_receipts
    where inbox_id = ${receipt.inbox_id} and thread_id = ${receipt.thread_id} and outcome is null and id <> ${receipt.id}
      and received_at <= (select received_at from app.email_receipts where id = ${receipt.id})
    limit 1
  `;
  if (earlier) throw new Error("An earlier message of this thread is not processed yet.");

  return "ignored";
}

// Auto-replies and bulk mail never reach the assistant, so an out-of-office
// answer cannot start a reply loop.
export function autoSubmitted(message: ReceivedMessage) {
  const headers = Object.fromEntries(Object.entries(message.headers ?? {}).map(([name, value]) => [name.toLowerCase(), String(value).toLowerCase()]));
  const auto = headers["auto-submitted"];
  return Boolean((auto && auto !== "no") || /^(bulk|junk|list|auto_reply)$/.test(headers.precedence ?? "") || headers["x-autoreply"] || headers["x-autorespond"]);
}

// A message carrying a link code binds only as Continue by email wrote it
// (email-links.ts), and is never forwarded either way.
function linkByCode(
  deps: EmailReceiptDependencies,
  receipt: Receipt,
  message: ReceivedMessage,
  code: string,
  address: string,
  authenticated: boolean,
): Promise<ReceiptOutcome> {
  return bindByCode(deps.db, deps.tokenKey, receipt, message, code, address, authenticated);
}

export function createEmailReceiptHandler(load: () => EmailReceiptDependencies = receiptDependenciesFromEnvironment): JobHandler {
  const handler: JobHandler = async (tx, job) => {
    const receiptId = typeof job.payload.receiptId === "string" ? job.payload.receiptId : null;
    if (!receiptId) return { outcome: "missing", receiptId };

    const deps = load();
    const transport = deps.transport ?? agentMailTransport(deps.config, deps.env);
    // A denied environment reads no receipt and touches no conversation.
    assertMessagingAdmitted(transport.endpoint, deps.env);

    const [receipt] = await tx<Receipt[]>`
      select id, inbox_id, thread_id, message_id, outcome from app.email_receipts where id = ${receiptId}
    `;
    if (!receipt) return { outcome: "missing", receiptId };
    if (receipt.outcome) return { outcome: receipt.outcome, receiptId };

    const read = await transport.getMessage(receipt.inbox_id, receipt.message_id);

    if (read.status === "unavailable") throw new Error("AgentMail did not return the message.");

    const outcome =
      read.status === "found" &&
      read.message.inbox_id.toLowerCase() === receipt.inbox_id.toLowerCase() &&
      read.message.thread_id === receipt.thread_id &&
      read.message.message_id === receipt.message_id
        ? await processReceivedMessage(deps, receipt, read.message)
        : "ignored";

    await tx`
      update app.email_receipts set outcome = ${outcome}, processed_at = now()
      where id = ${receipt.id} and outcome is null
    `;
    return { outcome, receiptId };
  };

  // Attempts spent (AgentMail or admission unavailable for hours): the receipt
  // is recorded as ignored so it shows as handled, and a thread this message
  // already bound by starting a request gets one fixed reply instead of silence.
  handler.onExhausted = async (tx, job) => {
    const receiptId = typeof job.payload.receiptId === "string" ? job.payload.receiptId : null;
    if (!receiptId) return;

    const [receipt] = await tx<Receipt[]>`
      update app.email_receipts set outcome = 'ignored', processed_at = now()
      where id = ${receiptId} and outcome is null
      returning id, inbox_id, thread_id, message_id, outcome
    `;
    if (!receipt) return;

    const [binding] = await tx<(Binding & { language: string | null })[]>`
      select t.id, t.request_id, t.origin, t.sender_hash, t.bound_by_receipt_id, r.details ->> 'language' as language
      from app.email_threads t join app.requests r on r.id = t.request_id
      where t.bound_by_receipt_id = ${receipt.id} and t.origin = 'started' and t.state = 'active'
    `;
    if (!binding) return;

    const language = binding.language === "ko" ? "ko" : "en";
    await recordReply(tx, {
      bindingId: binding.id,
      dedupeKey: `receipt:${receipt.id}`,
      inboxId: receipt.inbox_id,
      kind: "unprocessed",
      language,
      replyToMessageId: receipt.message_id,
      requestId: binding.request_id,
      text: FIXED_REPLIES.unprocessed[language],
    });
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
