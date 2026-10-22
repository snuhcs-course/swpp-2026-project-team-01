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
import { bindByCode, findLinkCode } from "./email-links";
import { recordReply } from "./email-replies";
import { acceptGuestMessage, type GuestConversationDependencies } from "./guest-conversations";
import { internalSigningKey } from "./internal-bearer";
import type { JobHandler } from "./jobs";
import { findReadyHostByHandle } from "./readiness";
import { assertMessagingAdmitted } from "./messaging";
import { LINK_CODE } from "./redaction";
import { lockOpenRequest } from "./request-guard";
import { admitCreation, CREATION_LIMITS, type CreationLimits, createDraftRequest, identifyDraft } from "./request-start";
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
  return new RegExp(LINK_CODE.source, "i").test(text);
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
      const [first] = await deps.db<{ id: string }[]>`
        update app.email_threads set closed_notice_at = now()
        where id = ${binding.id} and closed_notice_at is null
        returning id
      `;
      return first ? reply(deps, receipt, "closed", FIXED_REPLIES.closed[language], language, binding) : "ignored";
    }

    // Admission limits retry the receipt later. A runtime refusal leaves the
    // input recorded and accepted: the next message or recovery delivers it, and
    // its reply waits for that turn.
    if (error instanceof AdmissionLimitError) throw error;
    if (!(error instanceof ConversationInputError && error.code === "runtime_unavailable")) throw error;
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
      const { requestId } = await createDraftRequest(tx, {
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

  const text = `${message.subject ?? ""}\n${newText(message)}`;
  const authenticated = senderAuthenticated(message);

  if (carriesLinkCode(text)) return linkByCode(deps, receipt, message, address, authenticated);
  if (!authenticated) return "ignored";

  const binding = await activeBinding(deps.db, receipt.inbox_id, receipt.thread_id);

  if (binding) {
    // The message that started this thread's request, seen again by a retry.
    if (binding.bound_by_receipt_id === receipt.id) {
      const outcome = await forward(deps, receipt, message, binding, true);
      return outcome === "forwarded" ? "started" : outcome;
    }

    return binding.sender_hash === senderHash(deps.tokenKey, address) ? forward(deps, receipt, message, binding, false) : "ignored";
  }

  return startsThread(message) ? start(deps, receipt, message, address) : "ignored";
}

// A message carrying a link code binds only as Continue by email wrote it
// (email-links.ts), and is never forwarded either way.
async function linkByCode(
  deps: EmailReceiptDependencies,
  receipt: Receipt,
  message: ReceivedMessage,
  address: string,
  authenticated: boolean,
): Promise<ReceiptOutcome> {
  const code = findLinkCode(`${message.subject ?? ""}\n${newText(message)}`);
  return code ? bindByCode(deps.db, deps.tokenKey, receipt, message, code, address, authenticated) : "ignored";
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
