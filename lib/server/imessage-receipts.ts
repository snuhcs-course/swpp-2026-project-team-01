import { getChatMessageLengthError } from "../contracts/chat-message";
import { IMESSAGE_PREFIX, type StoredChannel, TELEGRAM_PREFIX, WHATSAPP_PREFIX } from "../contracts/messaging-channel";
import { type NoticeDependencies, noticeDependenciesFromEnvironment } from "./booking-notices";
import { AdmissionLimitError } from "./conversation-admission";
import {
  acceptHostMessage,
  agentUrlFromEnvironment,
  ConversationClosedError,
  type ConversationDependencies,
  ConversationInputError,
  eveRuntime,
  HostRequestNotFoundError,
} from "./conversations";
import { database, type Database, type Transaction } from "./database";
import { findLinkCode } from "./email-links";
import { acceptGuestMessage, DraftMessageLimitError } from "./guest-conversations";
import { HostIneligibleError } from "./host-eligibility";
import { internalSigningKey } from "./internal-bearer";
import {
  activeBindingOfSender,
  bindingContext,
  lockActiveBindingOfSender,
  receiveLinkCode,
  refusalSentRecently,
  telegramDisplayName,
} from "./imessage-links";
import { endBlockedBinding, type ImessageSignal, recordOutbound, signalText } from "./imessage-outbox";
import { type JobHandler, publishJob } from "./jobs";
import { assertMessagingAdmitted } from "./messaging";
import { type ChannelLanguage, hostConversationLanguage, textLanguage } from "./channel-language";
import { channelReplies } from "./channel-texts";
import { answerCallback, CALLBACK_TEXTS, executeCommand, parseCommand, requestRef } from "./imessage-commands";
import { photonConfig, type PhotonConfig, photonTransport, SPECTRUM_ENDPOINT } from "./photon";
import { WHATSAPP_BUTTON_CONTENT } from "./whatsapp";
import { IMESSAGE_RECEIPT_JOB, receiptSealContext } from "./photon-receiver";
import { emailSourceHash } from "./email-receipts";
import { requesterBindingContext } from "./requester-imessage-bindings";
import { type CreationLimits } from "./request-start";
import { isRevisable, readRevisedSummary, reviseClosedRequest } from "./revised-requests";
import { type SetupDependencies, setupDependenciesFromEnvironment } from "./setup";
import { openTelegramText, parseCallbackData, type TelegramDetails, THANKS_REACTION } from "./telegram";
import { startTypingRepeats } from "./telegram-jobs";
import { openToken, sealToken, type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// The imessage_receipt job (host-imessage-channel design 7): what one stored
// Photon receipt may do. It checks messaging admission first, then opens the
// receipt's sealed text, sender and conversation and, in order:
//   - a group conversation or a reaction does nothing;
//   - an earlier receipt of the same conversation still unprocessed fails the
//     attempt, so a later message never overtakes it;
//   - a message carrying an FMAT- code is linking (imessage-links.ts) and never
//     reaches the model;
//   - a guest's message goes to a request's requester discussion
//     (guest-flow-completion design 3; guestRoute below says which);
//   - a sender with no active binding, or whose host may no longer host, gets
//     one fixed reply a day pointing to /app and no session (D10);
//   - content other than text gets one fixed reply, except a WhatsApp reply
//     button, which carries the exact command its ID names;
//   - otherwise the bound host's message goes on to the channel (commands and
//     forwarding).
// A Telegram receipt (host-telegram-channel) is linking first (telegramLinking),
// then follows the same steps, with three more kinds (design 7 to 10): a button
// tap (callback) is admitted only from the bound sender and runs the exact
// command its data names, and is answered either way; a blocking update ends
// the binding as stop does, with no reply; a "/" command is text. Telegram has
// no read mark: a forwarded message shows typing until its reply is queued, and
// a message that only says thanks gets 👍.
// The outcome is recorded with the sealed values cleared in the same write. An
// admission limit fails the attempt, so the receipt waits and retries no earlier
// than the job's backoff, and the ordering check keeps later messages behind it.

type Environment = Readonly<Record<string, string | undefined>>;

export type ReceiptOutcome = "link_received" | "link_refused" | "unlinked_reply" | "command" | "forwarded" | "replied" | "ignored";

export type ImessageReceiptDependencies = {
  readonly db: Database;
  readonly config: PhotonConfig;
  readonly tokenKey: TokenKey;
  readonly tokenKeys: readonly TokenKey[];
  // The canonical origin replies point to.
  readonly origin: string;
  // Settings review and confirmation read setup and the live calendar list.
  readonly setup: SetupDependencies;
  // A decline notifies the requester, as from the web.
  readonly notices: NoticeDependencies;
  // Free text enters the host's discussions through the same path as /app.
  readonly conversation: ConversationDependencies;
  // Bounds on revised requests (guest-flow-completion design 5).
  readonly creationLimits?: Partial<CreationLimits>;
  readonly env?: Environment;
};

function receiptDependenciesFromEnvironment(): ImessageReceiptDependencies {
  const tokenKey = tokenKeyFromEnvironment();
  const setup = setupDependenciesFromEnvironment();
  const db = database();
  return {
    config: photonConfig(),
    conversation: { db, runtime: eveRuntime(agentUrlFromEnvironment()), signingKey: internalSigningKey() },
    db,
    notices: noticeDependenciesFromEnvironment(),
    origin: setup.appOrigin,
    setup,
    tokenKey,
    tokenKeys: [tokenKey],
  };
}

// Forwarded text is marked, so the shared transcript and the assistant know
// where it came from (D11). The prefixes live in the browser-safe contract.
export { IMESSAGE_PREFIX, TELEGRAM_PREFIX, WHATSAPP_PREFIX };

const PREFIXES: Readonly<Record<StoredChannel, string>> = { imessage: IMESSAGE_PREFIX, telegram: TELEGRAM_PREFIX, whatsapp: WHATSAPP_PREFIX };

// The fixed replies are in English and Korean (channel-actions-in-words D4);
// these are the English ones.
export const FORWARD_TEXTS = {
  tooLong: channelReplies("en").tooLong,
  requestGone: channelReplies("en").requestGone,
} as const;

// The language of a reply to a bound host's message: the message's own, else
// the host's conversation.
async function hostReplyLanguage(deps: ImessageReceiptDependencies, hostAccountId: string, text: string | null): Promise<ChannelLanguage> {
  return textLanguage(text) ?? (await hostConversationLanguage(deps.db, hostAccountId));
}

// An admission budget refused the message: the receipt waits at least a minute.
export class AdmissionDeferredError extends Error {
  constructor() {
    super("An admission budget deferred this message.");
    this.name = "AdmissionDeferredError";
  }
}

async function fixedReply(tx: Transaction, deps: ImessageReceiptDependencies, message: BoundMessage, kind: "command", text: string) {
  await recordOutbound(tx, {
    bindingId: message.bindingId,
    dedupeKey: `receipt:${message.receipt.id}`,
    hostAccountId: message.hostAccountId,
    kind,
    recipient: message.recipient,
    recipientHash: message.receipt.senderHash,
    text,
    tokenKey: deps.tokenKey,
  });
}

// Free text becomes an accepted input of the selected discussion (setup, or the
// selected request's private review), keyed by the receipt so a retried job
// finds the same input, and a reply waits for the turn that serves it.
async function forward(tx: Transaction, deps: ImessageReceiptDependencies, message: BoundMessage): Promise<ReceiptOutcome> {
  const text = `${PREFIXES[message.receipt.channel]}${message.text}`;
  if (getChatMessageLengthError(text)) {
    await fixedReply(tx, deps, message, "command", channelReplies(await hostReplyLanguage(deps, message.hostAccountId, message.text)).tooLong);
    return "replied";
  }

  // A retry finds the input an earlier attempt recorded, in whichever
  // discussion it went to, so the message is never recorded twice.
  const [earlier] = await deps.db<{ request_id: string | null }[]>`
    select d.request_id from app.conversation_inputs i
    join app.discussions d on d.id = i.discussion_id
    where d.principal_type = 'host_account' and d.principal_id = ${message.hostAccountId} and i.client_input_id = ${message.receipt.id}
  `;
  let requestId = earlier ? earlier.request_id : message.selectedRequestId;
  let fellBack = false;

  for (;;) {
    try {
      await acceptHostMessage(deps.conversation, message.authUserId, { clientInputId: message.receipt.id, message: text }, requestId);
      break;
    } catch (error) {
      if (error instanceof AdmissionLimitError) throw new AdmissionDeferredError();
      if (error instanceof HostRequestNotFoundError && requestId) {
        await tx`update app.imessage_bindings set selected_request_id = null where id = ${message.bindingId} and state = 'active'`;
        requestId = null;
        fellBack = true;
        continue;
      }
      if (error instanceof HostIneligibleError) return "ignored";
      // A runtime refusal leaves the input recorded and accepted: the next
      // message or recovery delivers it, and its reply waits for that turn.
      if (error instanceof ConversationInputError && error.code === "runtime_unavailable") break;
      if (error instanceof ConversationInputError) return "ignored";
      throw error;
    }
  }

  const [input] = await deps.db<{ id: string }[]>`
    select i.id from app.conversation_inputs i
    join app.discussions d on d.id = i.discussion_id
    where d.principal_type = 'host_account' and d.principal_id = ${message.hostAccountId}
      and d.request_id is not distinct from ${requestId} and i.client_input_id = ${message.receipt.id}
  `;
  if (!input) throw new Error("The forwarded input was not recorded.");

  if (fellBack) {
    await recordOutbound(tx, {
      bindingId: message.bindingId,
      dedupeKey: `receipt:${message.receipt.id}:fallback`,
      hostAccountId: message.hostAccountId,
      kind: "command",
      recipient: message.recipient,
      recipientHash: message.receipt.senderHash,
      text: channelReplies(await hostReplyLanguage(deps, message.hostAccountId, message.text)).requestGone,
      tokenKey: deps.tokenKey,
    });
  }

  await recordOutbound(tx, {
    bindingId: message.bindingId,
    dedupeKey: `input:${input.id}`,
    hostAccountId: message.hostAccountId,
    inputId: input.id,
    kind: "turn",
    recipient: message.recipient,
    recipientHash: message.receipt.senderHash,
    requestId,
    tokenKey: deps.tokenKey,
  });
  return "forwarded";
}

// The bound host's text: an exact command runs before any model turn; anything
// else is forwarded.
export const channelProcessor: ChannelProcessor = async (tx, deps, message) => {
  const command = parseCommand(message.text);
  if (command) return executeCommand(tx, deps, message, command);
  // A button never reaches the model: one whose ID named no command does nothing.
  if (message.receipt.contentType === WHATSAPP_BUTTON_CONTENT) return "ignored";
  return forward(tx, deps, message);
};

type ReceiptRow = {
  readonly id: string;
  readonly message_id: string;
  readonly channel: StoredChannel;
  readonly sender_hash: string;
  readonly space_hash: string;
  readonly space_type: "dm" | "group";
  readonly content_type: string;
  readonly text_ciphertext: string | null;
  readonly sender_ciphertext: string | null;
  readonly space_ciphertext: string | null;
  readonly sealed_key_id: string | null;
  readonly outcome: ReceiptOutcome | null;
  readonly received_at: Date;
};

export type OpenedReceipt = {
  readonly id: string;
  // Photon's ID of the host's message, unsealed in the receipt; a signal reads and reacts to it.
  readonly messageId: string;
  readonly channel: StoredChannel;
  readonly senderHash: string;
  readonly spaceHash: string;
  readonly spaceType: "dm" | "group";
  readonly contentType: string;
  readonly text: string | null;
  readonly sender: string;
  readonly spaceId: string;
  // Telegram only: the sender's profile and a callback's locators, from the
  // sealed envelope (host-telegram-channel design 3); null on other channels.
  readonly telegram: TelegramDetails | null;
};

export function openReceipt(keys: readonly TokenKey[], row: ReceiptRow): OpenedReceipt | null {
  if (!row.sender_ciphertext || !row.space_ciphertext || !row.sealed_key_id) return null;
  const open = (ciphertext: string) => openToken(keys, { ciphertext, keyId: row.sealed_key_id! }, receiptSealContext(row.id));

  try {
    const sealed = row.text_ciphertext ? open(row.text_ciphertext) : null;
    // A Telegram receipt seals its text with the update's details as one envelope.
    const envelope = row.channel === "telegram" && sealed !== null ? openTelegramText(sealed) : null;
    if (row.channel === "telegram" && sealed !== null && !envelope) return null;
    return {
      channel: row.channel,
      contentType: row.content_type,
      id: row.id,
      messageId: row.message_id,
      sender: open(row.sender_ciphertext),
      senderHash: row.sender_hash,
      spaceHash: row.space_hash,
      spaceId: open(row.space_ciphertext),
      spaceType: row.space_type,
      telegram: envelope?.details ?? null,
      text: envelope ? envelope.text : sealed,
    };
  } catch {
    return null;
  }
}

// A receipt an admission budget refused waits this long before its next try,
// and gives up after this many tries (about four hours).
export const ADMISSION_RETRY_SECONDS = 60;
export const ADMISSION_DEFERRALS = 240;

// A receipt behind an unprocessed earlier one of its conversation checks again
// this often, at most this many times (longer than a deferral's four hours).
export const ORDER_RETRY_SECONDS = 30;
export const ORDER_WAITS = 600;

// The English fixed replies to senders; each has a Korean counterpart in
// channel-texts.ts, chosen by the message's language.
export const CHANNEL_TEXTS = {
  unlinked: channelReplies("en").unlinked.imessage,
  unlinkedWhatsApp: channelReplies("en").unlinked.whatsapp,
  unlinkedTelegram: channelReplies("en").unlinked.telegram,
  textOnly: channelReplies("en").textOnly,
  textOnlyTelegram: channelReplies("en").textOnlyTelegram,
} as const;

// A bound host's message, with what the channel needs to act as that host.
export type BoundMessage = {
  readonly receipt: OpenedReceipt;
  readonly text: string;
  readonly bindingId: string;
  readonly hostAccountId: string;
  readonly authUserId: string;
  readonly selectedRequestId: string | null;
  readonly recipient: { readonly address: string; readonly spaceId: string };
};

// Runs in the receipt job's transaction, which holds the receipt and binding
// rows: binding changes and replies use it, while decisions and forwarding run
// in their own transactions on deps.db.
export type ChannelProcessor = (tx: Transaction, deps: ImessageReceiptDependencies, message: BoundMessage) => Promise<ReceiptOutcome>;

// ---------------------------------------------------------------------------
// A guest's message (guest-flow-completion design 3)

export const GUEST_TEXTS = {
  closed: channelReplies("en").guestClosed,
  switched: channelReplies("en").guestSwitched,
  tooLong: channelReplies("en").tooLong,
} as const;

function senderLanguage(receipt: OpenedReceipt): ChannelLanguage {
  return textLanguage(receipt.text) ?? "en";
}

type GuestBinding = {
  readonly id: string;
  readonly request_id: string;
  readonly state: "active" | "unlinked" | "ended" | "moved";
  readonly moved_to_request_id: string | null;
  readonly sealed_key_id: string | null;
};

async function activeGuestBindings(tx: Transaction, senderHash: string) {
  return tx<(GuestBinding & { host_name: string | null })[]>`
    select b.id, b.request_id, b.state, b.moved_to_request_id, b.sealed_key_id, s.settings ->> 'displayName' as host_name
    from app.requester_imessage_bindings b
    join app.requests r on r.id = b.request_id
    left join app.host_settings s on s.host_account_id = r.host_account_id
    where b.sender_hash = ${senderHash} and b.state = 'active'
    order by b.created_at desc
  `;
}

// Multiple active conversations require an explicit selection. An outbound
// message in another conversation invalidates it: API acceptance does not
// establish which message reached the sender or in which order.
// Which of a sender's conversations a message names in words (#137), or null
// when it names none or more than one: "host", for a message about their own
// account as a host (호스트, host, setup, settings, 설정), or the guest binding
// whose request reference, host or role ("guest", "예약 요청") it names.
const HOST_WORDS = /호스트|설정|셋업|\bhost\b|\bsetup\b|\bsettings\b/i;
const GUEST_WORDS = /게스트|예약\s*요청|요청자|\bguest\b|\brequester\b/i;

function nameParts(name: string) {
  const normalized = name.normalize("NFKC").toLowerCase().trim();
  const parts = new Set([normalized, ...normalized.split(/\s+/)]);
  // A Korean name without spaces also goes by its given name (이은우, 은우).
  if (/^[가-힣]{3,4}$/.test(normalized)) parts.add(normalized.slice(1));
  return [...parts].filter((part) => part.length >= 2);
}

export function namedConversation<Binding extends { readonly request_id: string; readonly host_name: string | null }>(
  text: string,
  guests: readonly Binding[],
  host: boolean,
): "host" | Binding | null {
  const lower = text.normalize("NFKC").toLowerCase();
  const upper = text.toUpperCase();
  const byName = guests.filter(
    (binding) => new RegExp(`\\b${requestRef(binding.request_id)}\\b`).test(upper) || nameParts(binding.host_name ?? "").some((part) => lower.includes(part)),
  );
  const named = byName.length ? byName : guests.length === 1 && GUEST_WORDS.test(text) ? guests : [];
  const hostNamed = host && HOST_WORDS.test(text);

  if (hostNamed && named.length === 0) return "host";
  if (!hostNamed && named.length === 1) return named[0]!;
  return null;
}

type GuestRoute = { readonly binding: GuestBinding; readonly switched: boolean; readonly forward?: boolean };

async function guestRoute(tx: Transaction, receipt: OpenedReceipt): Promise<GuestRoute | "ambiguous" | null> {
  const command = receipt.text ? parseCommand(receipt.text) : null;
  const guests = await activeGuestBindings(tx, receipt.senderHash);
  const host = await activeBindingOfSender(tx, receipt.senderHash);

  if (command?.name === "request") {
    const named = guests.filter((binding) => requestRef(binding.request_id) === command.ref);
    if (named.length && host) {
      const requests = await tx<{ id: string }[]>`select id from app.requests where host_account_id = ${host.host_account_id} and state <> 'draft'`;
      if (requests.some((request) => requestRef(request.id) === command.ref)) return "ambiguous";
    }
    if (named.length === 1) return { binding: named[0]!, switched: true };
    if (named.length > 1) return "ambiguous";
    if (guests.length && !host) return "ambiguous";
  }

  if (command && host) return null;

  if (guests.length + Number(Boolean(host)) > 1) {
    const [selection] = await tx<{ id: string; binding_id: string | null; requester_binding_id: string | null; request_id: string | null }[]>`
      select id, binding_id, requester_binding_id, request_id from app.imessage_outbox
      where recipient_hash = ${receipt.senderHash} and kind = 'command'
        and (dedupe_key like 'guest-selection:%' or dedupe_key like 'host-selection:%')
      order by created_at desc, id desc limit 1
    `;
    if (selection) {
      const [changed] = await tx<{ found: boolean }[]>`
        select exists (
          select 1 from app.imessage_outbox
          where recipient_hash = ${receipt.senderHash}
            and (binding_id is not null or requester_binding_id is not null)
            -- A read mark or typing bubble is not a message and moves no selection.
            and kind <> 'signal'
            and (binding_id is distinct from ${selection.binding_id} or requester_binding_id is distinct from ${selection.requester_binding_id}
              or (binding_id is not null and request_id is distinct from ${selection.request_id}))
            and (state = 'dispatching'
              or created_at > (select created_at from app.imessage_outbox where id = ${selection.id})
              or dispatched_at > (select created_at from app.imessage_outbox where id = ${selection.id})
              or completed_at > (select created_at from app.imessage_outbox where id = ${selection.id}))
        ) or exists (
          select 1 from app.requester_imessage_bindings
          where sender_hash = ${receipt.senderHash} and state = 'active'
            and created_at > (select created_at from app.imessage_outbox where id = ${selection.id})
        ) or exists (
          select 1 from app.imessage_bindings
          where sender_hash = ${receipt.senderHash} and state = 'active'
            and linked_at > (select created_at from app.imessage_outbox where id = ${selection.id})
        ) as found
      `;
      if (changed?.found) return "ambiguous";
    }
    if (selection?.requester_binding_id) {
      const selected = guests.find((binding) => binding.id === selection.requester_binding_id);
      if (selected) return { binding: selected, switched: false };
    }
    if (selection?.binding_id && host?.id === selection.binding_id) return null;
    return "ambiguous";
  }

  if (host) return null;
  return guests[0] ? { binding: guests[0], switched: false } : null;
}

async function guestReply(
  tx: Transaction,
  deps: ImessageReceiptDependencies,
  receipt: OpenedReceipt,
  binding: Pick<GuestBinding, "id" | "request_id">,
  message: { readonly kind: "command" | "text_only"; readonly dedupeKey: string; readonly text: string },
) {
  return recordOutbound(tx, {
    dedupeKey: message.dedupeKey,
    kind: message.kind,
    recipient: { address: receipt.sender, spaceId: receipt.spaceId },
    recipientHash: receipt.senderHash,
    requestId: binding.request_id,
    requesterBindingId: binding.id,
    text: message.text,
    tokenKey: deps.tokenKey,
  });
}

// The guest's message: a switch is answered; content other than text gets one
// fixed reply; a declined, expired or withdrawn request's message starts a
// revised request (design 5, U16) and goes there, or gets the closed notice
// once when none can be made; a booked request's text is forwarded like an
// open one's (U18); text is forwarded into the request's
// requester discussion as an accepted input keyed by the receipt, and the
// turn's final text is the reply.
async function guestMessage(
  tx: Transaction,
  deps: ImessageReceiptDependencies,
  receipt: OpenedReceipt,
  route: GuestRoute,
): Promise<ReceiptOutcome> {
  // A booked request stays reachable for questions about its meeting (U18).
  const [request] = await tx<{ open: boolean; state: string; host_name: string | null }[]>`
    select (r.closed_at is null and r.expires_at > now()) or r.state = 'booked' as open, r.state,
           s.settings ->> 'displayName' as host_name
    from app.requests r left join app.host_settings s on s.host_account_id = r.host_account_id
    where r.id = ${route.binding.request_id}
  `;
  const text = receipt.contentType === "text" ? (receipt.text?.trim() ?? "") : "";

  // Revising moves the binding in its own transaction, so this one locks
  // nothing of the binding's first.
  if (!route.switched && text && request && !request.open && isRevisable(request.state) && route.binding.state === "active") {
    return revise(tx, deps, receipt, route.binding, text);
  }

  const [binding] = await tx<GuestBinding[]>`
    select id, request_id, state, moved_to_request_id, sealed_key_id from app.requester_imessage_bindings
    where id = ${route.binding.id}
    for update
  `;
  if (!binding) return "ignored";

  if (binding.state === "active") {
    // Replies go to the conversation the guest writes from.
    const space = sealToken({ id: binding.sealed_key_id!, key: keyFor(deps, binding.sealed_key_id!) }, receipt.spaceId, requesterBindingContext(binding.id));
    await tx`
      update app.requester_imessage_bindings set space_ciphertext = ${space.ciphertext}, last_inbound_at = now()
      where id = ${binding.id} and state = 'active'
    `;
  }

  const texts = channelReplies(senderLanguage(receipt));
  if (route.switched) {
    await guestReply(tx, deps, receipt, binding, { dedupeKey: `guest-selection:${receipt.id}`, kind: "command", text: texts.guestSwitched(request?.host_name ?? texts.yourHost) });
    // A message that named its conversation in words also goes on (#137).
    if (!route.forward) return "command";
  }

  if (!text) {
    await guestReply(tx, deps, receipt, binding, { dedupeKey: `receipt:${receipt.id}`, kind: "text_only", text: texts.textOnly });
    return "replied";
  }

  if (!request?.open || binding.state !== "active") return closedNotice(tx, deps, receipt, binding);
  return forwardGuest(tx, deps, receipt, binding, text);
}

// The closed notice, at most once per binding.
async function closedNotice(tx: Transaction, deps: ImessageReceiptDependencies, receipt: OpenedReceipt, binding: Pick<GuestBinding, "id" | "request_id">) {
  const { created } = await guestReply(tx, deps, receipt, binding, {
    dedupeKey: `requester-binding:${binding.id}:closed`,
    kind: "command",
    text: channelReplies(senderLanguage(receipt)).guestClosed,
  });
  return created ? ("replied" as const) : ("ignored" as const);
}

// A revised request for the declined, expired or withdrawn one, created or found, then
// its opening summary and the guest's message in its discussion. A refusal
// (the host unavailable, the chain full, the bounds) answers with the closed
// notice and creates nothing.
async function revise(tx: Transaction, deps: ImessageReceiptDependencies, receipt: OpenedReceipt, binding: GuestBinding, text: string): Promise<ReceiptOutcome> {
  const outcome = await deps.db.begin((revising) =>
    reviseClosedRequest(
      revising,
      { creationLimits: deps.creationLimits, origin: deps.origin, tokenKey: deps.tokenKey, tokenKeys: deps.tokenKeys },
      binding.request_id,
      { bindingId: binding.id, kind: "imessage" },
      (address) => emailSourceHash(deps.tokenKey, address),
    ),
  );
  if (outcome.kind === "refused" || !outcome.bindingId) return closedNotice(tx, deps, receipt, binding);

  const accepted = await acceptRevisedSummary(deps, outcome.requestId, (await readRevisedSummary(tx, binding.request_id))!);
  if (accepted !== "accepted") return accepted;
  return forwardGuest(tx, deps, receipt, { id: outcome.bindingId, request_id: outcome.requestId }, text);
}

async function acceptRevisedSummary(deps: ImessageReceiptDependencies, requestId: string, summary: string) {
  try {
    await acceptGuestMessage(deps.conversation, { id: requestId, type: "requester_request" }, { clientInputId: requestId, message: summary });
  } catch (error) {
    if (error instanceof AdmissionLimitError) throw new AdmissionDeferredError();
    if (!(error instanceof ConversationInputError) || error.code !== "runtime_unavailable") throw error;
  }
  return "accepted" as const;
}

async function forwardGuest(
  tx: Transaction,
  deps: ImessageReceiptDependencies,
  receipt: OpenedReceipt,
  binding: Pick<GuestBinding, "id" | "request_id">,
  message: string,
): Promise<ReceiptOutcome> {
  // The guest's channel marks the text, as a host's does (guest-whatsapp-link design 1).
  const text = `${PREFIXES[receipt.channel]}${message}`;
  if (getChatMessageLengthError(text)) {
    await guestReply(tx, deps, receipt, binding, { dedupeKey: `receipt:${receipt.id}`, kind: "command", text: channelReplies(senderLanguage(receipt)).tooLong });
    return "replied";
  }

  const principal = { id: binding.request_id, type: "requester_request" as const };
  try {
    await acceptGuestMessage(deps.conversation, principal, { clientInputId: receipt.id, message: text });
  } catch (error) {
    if (error instanceof ConversationClosedError) return closedNotice(tx, deps, receipt, binding);
    if (error instanceof AdmissionLimitError) throw new AdmissionDeferredError();
    if (error instanceof DraftMessageLimitError) return "ignored";
    // A runtime refusal leaves the input recorded and accepted, as for a host.
    if (!(error instanceof ConversationInputError)) throw error;
    if (error.code !== "runtime_unavailable") return "ignored";
  }

  const [input] = await deps.db<{ id: string }[]>`
    select i.id from app.conversation_inputs i
    join app.discussions d on d.id = i.discussion_id
    where d.principal_type = 'requester_request' and d.principal_id = ${binding.request_id} and d.audience = 'requester'
      and i.client_input_id = ${receipt.id}
  `;
  if (!input) throw new Error("The forwarded input was not recorded.");

  await recordOutbound(tx, {
    dedupeKey: `input:${input.id}`,
    inputId: input.id,
    kind: "turn",
    recipient: { address: receipt.sender, spaceId: receipt.spaceId },
    recipientHash: receipt.senderHash,
    requestId: binding.request_id,
    requesterBindingId: binding.id,
    tokenKey: deps.tokenKey,
  });
  return "forwarded";
}

// ---------------------------------------------------------------------------
// Telegram (host-telegram-channel design 6)

// /start, as the bot's Start button or a typed command sends it, optionally
// addressed to the bot (/start@findmeatime_bot), with its payload if any.
const START_COMMAND = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?\s*$/;

// Linking over Telegram, or null when the receipt is not about linking:
//   - a message carrying an FMAT- code (/start <code> from the t.me link, or the
//     code typed as text) goes to receiveLinkCode with the sender's display
//     name; only a Telegram attempt is completed by it, and any other attempt
//     it names is voided;
//   - /start without a code (or with a payload that is not one) from a sender
//     with no active Telegram binding gets the unlinked-sender reply, at most
//     once a day per sender and counted per channel. A linked host's /start is
//     not linking.
// A button tap or a blocking update is never linking.
export async function telegramLinking(tx: Transaction, deps: ImessageReceiptDependencies, receipt: OpenedReceipt): Promise<ReceiptOutcome | null> {
  if (receipt.contentType !== "text" && receipt.contentType !== "command") return null;
  const text = receipt.text?.trim() ?? "";
  const code = findLinkCode(text);

  if (code) {
    return receiveLinkCode(tx, { origin: deps.origin, tokenKey: deps.tokenKey }, {
      channel: "telegram",
      code,
      receiptId: receipt.id,
      sender: receipt.sender,
      senderHash: receipt.senderHash,
      senderName: telegramDisplayName(receipt.telegram?.firstName ?? null, receipt.telegram?.username ?? null),
      spaceId: receipt.spaceId,
      spaceType: receipt.spaceType,
    });
  }

  if (!START_COMMAND.test(text)) return null;
  const binding = await activeBindingOfSender(tx, receipt.senderHash);
  if (binding?.channel === "telegram") return null;
  if (await refusalSentRecently(tx, receipt.senderHash, "telegram")) return "ignored";
  await recordOutbound(tx, {
    channel: "telegram",
    dedupeKey: `receipt:${receipt.id}`,
    kind: "unlinked_sender",
    recipient: { address: receipt.sender, spaceId: receipt.spaceId },
    recipientHash: receipt.senderHash,
    text: channelReplies(senderLanguage(receipt)).unlinked.telegram,
    tokenKey: deps.tokenKey,
  });
  return "unlinked_reply";
}

export async function processReceipt(
  tx: Transaction,
  deps: ImessageReceiptDependencies,
  receipt: OpenedReceipt,
  channel: ChannelProcessor | null = channelProcessor,
): Promise<ReceiptOutcome> {
  if (receipt.channel === "telegram") {
    const linking = await telegramLinking(tx, deps, receipt);
    if (linking) return linking;
  }

  // A code is linking wherever it appears: from a group conversation it voids
  // the attempt it names, with no reply into the group.
  const code = receipt.text ? findLinkCode(receipt.text) : null;

  if (code) {
    return receiveLinkCode(tx, { origin: deps.origin, tokenKey: deps.tokenKey }, {
      channel: receipt.channel,
      code,
      receiptId: receipt.id,
      sender: receipt.sender,
      senderHash: receipt.senderHash,
      spaceId: receipt.spaceId,
      spaceType: receipt.spaceType,
    });
  }

  if (receipt.spaceType !== "dm" || ["reaction", "read", "typing"].includes(receipt.contentType)) return "ignored";

  // Guests write from iMessage or WhatsApp (guest-whatsapp-link); a Telegram
  // sender is a host or no one.
  let guest = receipt.channel === "telegram" ? null : await guestRoute(tx, receipt);
  // A sender with several conversations and no current choice (#137): a
  // message that names one in words goes there; otherwise the choice is asked
  // in the message's language, answerable in words.
  let hostByWords = false;
  if (guest === "ambiguous") {
    const guests = await activeGuestBindings(tx, receipt.senderHash);
    const host = await activeBindingOfSender(tx, receipt.senderHash);
    const named = receipt.text && !parseCommand(receipt.text) ? namedConversation(receipt.text, guests, Boolean(host)) : null;
    if (named === "host") {
      guest = null;
      hostByWords = true;
    } else if (named) {
      guest = { binding: named, forward: true, switched: true };
    } else {
      const language = textLanguage(receipt.text) ?? (host ? await hostConversationLanguage(deps.db, host.host_account_id) : "en");
      const texts = channelReplies(language);
      await recordOutbound(tx, {
        channel: receipt.channel,
        dedupeKey: `receipt:${receipt.id}`,
        kind: "command",
        recipient: { address: receipt.sender, spaceId: receipt.spaceId },
        recipientHash: receipt.senderHash,
        text: texts.picker(
          guests.map((binding) => binding.host_name ?? texts.yourHost),
          Boolean(host),
        ),
        tokenKey: deps.tokenKey,
      });
      return "replied";
    }
  }
  if (guest) return channel ? guestMessage(tx, deps, receipt, guest) : "ignored";

  const recipient = { address: receipt.sender, spaceId: receipt.spaceId };
  // The hash namespaces keep channels apart; the channel check says so again.
  const found = await lockActiveBindingOfSender(tx, receipt.senderHash);
  const binding = found?.channel === receipt.channel ? found : null;
  const [host] = binding
    ? await tx<{ status: string; auth_user_id: string | null }[]>`
        select a.status, i.auth_user_id from app.host_accounts a
        left join app.google_identities i on i.host_account_id = a.id
        where a.id = ${binding.host_account_id}
      `
    : [];

  if (!binding || host?.status !== "active" || !host.auth_user_id) {
    // Someone who blocked the bot gets nothing; a tap from anyone else is
    // answered, but never decides anything (D8).
    if (receipt.contentType === "blocked") return "ignored";
    if (receipt.contentType === "callback") {
      await answerCallback(tx, deps.tokenKey, receipt, recipient, CALLBACK_TEXTS.notLinked);
      return "unlinked_reply";
    }
    if (await refusalSentRecently(tx, receipt.senderHash, receipt.channel)) return "ignored";
    await recordOutbound(tx, {
      channel: receipt.channel,
      dedupeKey: `receipt:${receipt.id}`,
      kind: "unlinked_sender",
      recipient,
      recipientHash: receipt.senderHash,
      text: channelReplies(senderLanguage(receipt)).unlinked[receipt.channel],
      tokenKey: deps.tokenKey,
    });
    return "unlinked_reply";
  }

  // The host blocked the bot (design 9): the binding ends as stop ends it, and
  // nothing is sent, since Telegram would refuse it.
  if (receipt.contentType === "blocked") {
    await endBlockedBinding(tx, binding.id);
    return "command";
  }

  // The conversation the host writes from is where replies go; a fallback
  // binding learns it from the host's first message.
  const space = sealToken({ id: binding.sealed_key_id, key: keyFor(deps, binding.sealed_key_id) }, receipt.spaceId, bindingContext(binding.id));
  await tx`
    update app.imessage_bindings set space_ciphertext = ${space.ciphertext}, last_inbound_at = now()
    where id = ${binding.id} and state = 'active'
  `;

  const bound = {
    authUserId: host.auth_user_id,
    bindingId: binding.id,
    hostAccountId: binding.host_account_id,
    receipt,
    recipient,
    selectedRequestId: binding.selected_request_id,
  };

  // A button tap runs the command its data names, never its label (D8); data
  // that names none is answered and does nothing.
  if (receipt.contentType === "callback") {
    const command = parseCallbackData(receipt.text);
    if (!command || !channel) {
      await answerCallback(tx, deps.tokenKey, receipt, recipient, null);
      return "ignored";
    }
    return executeCommand(tx, deps, { ...bound, text: receipt.text! }, command);
  }

  // A WhatsApp reply button arrives as the exact command its ID names (D17); a
  // Telegram "/" command is text like any other.
  const button = receipt.channel === "whatsapp" && receipt.contentType === WHATSAPP_BUTTON_CONTENT;
  const textual = receipt.contentType === "text" || button || (receipt.channel === "telegram" && receipt.contentType === "command");
  if (!textual || !receipt.text?.trim()) {
    await recordOutbound(tx, {
      bindingId: binding.id,
      dedupeKey: `receipt:${receipt.id}`,
      hostAccountId: binding.host_account_id,
      kind: "text_only",
      recipient,
      recipientHash: receipt.senderHash,
      text: channelReplies(await hostConversationLanguage(deps.db, binding.host_account_id))[receipt.channel === "telegram" ? "textOnlyTelegram" : "textOnly"],
      tokenKey: deps.tokenKey,
    });
    return "replied";
  }

  if (!channel) return "ignored";

  // A message that only says thanks is marked read and gets a tapback, and
  // starts no turn (D21, design 18; on WhatsApp a ❤️ reaction, D16).
  if (!button && receipt.channel !== "telegram" && isOnlyThanks(receipt.text)) {
    await recordSignal(tx, deps, receipt, binding, recipient, { messageId: receipt.messageId, reaction: THANKS_TAPBACK, typing: false });
    return "replied";
  }
  // Telegram's counterpart is a 👍 reaction on the host's message (task 4.2).
  if (receipt.channel === "telegram" && isOnlyThanks(receipt.text) && receipt.telegram?.messageId) {
    await recordSignal(tx, deps, receipt, binding, recipient, { messageId: receipt.telegram.messageId, reaction: THANKS_REACTION, typing: false });
    return "replied";
  }

  // The host named their own conversation in words (#137): it is selected, as
  // setup would select it, and the message goes on to Thyme.
  if (hostByWords) {
    await recordOutbound(tx, {
      bindingId: binding.id,
      dedupeKey: `host-selection:${receipt.id}`,
      hostAccountId: binding.host_account_id,
      kind: "command",
      recipient,
      recipientHash: receipt.senderHash,
      requestId: binding.selected_request_id,
      text: channelReplies(await hostReplyLanguage(deps, binding.host_account_id, receipt.text)).hostSelected,
      tokenKey: deps.tokenKey,
    });
  }

  const outcome = await channel(tx, deps, { ...bound, text: receipt.text.trim() });

  // Telegram shows typing while the turn runs: once now and every few seconds
  // until its reply is queued (design 8). A bot cannot mark a message read.
  if (receipt.channel === "telegram" && outcome === "forwarded") {
    await recordSignal(tx, deps, receipt, binding, recipient, { messageId: null, reaction: null, typing: true });
    const [turn] = await tx<{ id: string }[]>`
      select o.id from app.imessage_outbox o
      join app.conversation_inputs i on o.kind = 'turn' and o.dedupe_key = 'input:' || i.id::text
      join app.discussions d on d.id = i.discussion_id
      where d.principal_type = 'host_account' and d.principal_id = ${binding.host_account_id} and i.client_input_id = ${receipt.id}
    `;
    if (turn) await startTypingRepeats(tx, receipt.id, turn.id);
  }
  if (receipt.channel === "telegram") return outcome;

  // Every other message is marked read, and shows typing when it started a
  // turn, whose reply comes later; a command's reply is immediate, and rows of
  // one transaction have no order, so it gets the read mark only (D20; on
  // WhatsApp D15, where Meta ends the indicator when the reply arrives).
  await recordSignal(tx, deps, receipt, binding, recipient, { messageId: receipt.messageId, reaction: null, typing: outcome === "forwarded" });
  return outcome;
}

// One best-effort signal about the host's message (D20, design 18).
async function recordSignal(
  tx: Transaction,
  deps: ImessageReceiptDependencies,
  receipt: OpenedReceipt,
  binding: { readonly id: string; readonly host_account_id: string },
  recipient: { readonly address: string; readonly spaceId: string },
  signal: ImessageSignal,
) {
  await recordOutbound(tx, {
    bindingId: binding.id,
    dedupeKey: `receipt:${receipt.id}:signal`,
    hostAccountId: binding.host_account_id,
    kind: "signal",
    recipient,
    recipientHash: receipt.senderHash,
    text: signalText(signal),
    tokenKey: deps.tokenKey,
  });
}

// The native "love" tapback (Spectrum's Emoji.love), and WhatsApp's ❤️ reaction.
export const THANKS_TAPBACK = "❤️";

// A message that is nothing but thanks, in English or Korean, with any
// punctuation or emoji around it. "ok", "yes" and 👍 are not thanks: they can
// answer a question Thyme asked, so they still reach the conversation.
export function isOnlyThanks(text: string | null) {
  if (!text) return false;
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^(?:(?:many )?thanks?(?: (?:a lot|so much|again|very much))?|thank (?:you|u)(?: (?:so much|very much|again))?|thx|ty|tysm|고마워요?|고맙습니다|감사(?:해요|합니다|해)?|땡큐)$/u.test(words);
}

function keyFor(deps: ImessageReceiptDependencies, keyId: string) {
  const key = deps.tokenKeys.find((candidate) => candidate.id === keyId) ?? deps.tokenKey;
  return key.key;
}

// Records the outcome with the sealed values cleared, and brings forward the
// jobs of the conversation's later receipts that wait behind this one.
async function record(q: Transaction | Database, receiptId: string, outcome: ReceiptOutcome) {
  const [row] = await q<{ space_hash: string }[]>`
    update app.imessage_receipts
    set outcome = ${outcome}, processed_at = now(), text_ciphertext = null, sender_ciphertext = null, space_ciphertext = null
    where id = ${receiptId} and outcome is null
    returning space_hash
  `;
  if (!row) return;
  await q`
    update app.jobs set run_after = now(), updated_at = now()
    where kind = ${IMESSAGE_RECEIPT_JOB} and state = 'pending' and run_after > now()
      and payload ->> 'receiptId' in (
        select id::text from app.imessage_receipts where space_hash = ${row.space_hash} and outcome is null
      )
  `;
}

export function createImessageReceiptHandler(load: () => ImessageReceiptDependencies = receiptDependenciesFromEnvironment): JobHandler {
  const handler: JobHandler = async (tx, job) => {
    const receiptId = typeof job.payload.receiptId === "string" ? job.payload.receiptId : null;
    if (!receiptId) return { outcome: "missing", receiptId };

    const deps = load();
    // A denied environment reads no receipt and touches no conversation.
    assertMessagingAdmitted(photonTransport(deps.config, deps.env).endpoint, deps.env);

    const [row] = await tx<ReceiptRow[]>`
      select id, message_id, channel, sender_hash, space_hash, space_type, content_type, text_ciphertext, sender_ciphertext, space_ciphertext,
             sealed_key_id, outcome, received_at
      from app.imessage_receipts where id = ${receiptId}
      for update
    `;
    if (!row) return { outcome: "missing", receiptId };
    if (row.outcome) return { outcome: row.outcome, receiptId };
    const [earlier] = await tx<{ id: string }[]>`
      select id from app.imessage_receipts
      where space_hash = ${row.space_hash} and outcome is null and id <> ${row.id}
        and (received_at, id) < (${row.received_at}, ${row.id})
      limit 1
    `;
    if (earlier) {
      // Waiting spends no attempt: a new job checks again later, and the earlier
      // receipt's completion brings it forward.
      const waits = typeof job.payload.waits === "number" ? job.payload.waits : 0;
      if (waits >= ORDER_WAITS) {
        await record(tx, row.id, "ignored");
        return { outcome: "ignored", receiptId };
      }
      await publishJob(tx, {
        dedupeKey: `receipt:${row.id}:wait:${waits + 1}`,
        kind: IMESSAGE_RECEIPT_JOB,
        maxAttempts: job.maxAttempts,
        payload: { ...job.payload, receiptId: row.id, waits: waits + 1 },
        runAfter: new Date(Date.now() + ORDER_RETRY_SECONDS * 1000),
      });
      return { outcome: "waiting", receiptId };
    }

    const opened = openReceipt(deps.tokenKeys, row);
    let outcome: ReceiptOutcome;

    try {
      outcome = opened ? await processReceipt(tx, deps, opened, channelProcessor) : "ignored";
    } catch (error) {
      if (!(error instanceof AdmissionDeferredError)) throw error;
      // Retried no earlier than a minute later by a new job, so the job's own
      // shorter backoff does not apply; later messages still wait behind it.
      const deferrals = typeof job.payload.deferrals === "number" ? job.payload.deferrals : 0;
      if (deferrals >= ADMISSION_DEFERRALS) {
        await record(tx, row.id, "ignored");
        return { outcome: "ignored", receiptId };
      }
      await publishJob(tx, {
        dedupeKey: `receipt:${row.id}:deferred:${deferrals + 1}`,
        kind: IMESSAGE_RECEIPT_JOB,
        maxAttempts: job.maxAttempts,
        payload: { deferrals: deferrals + 1, receiptId: row.id },
        runAfter: new Date(Date.now() + ADMISSION_RETRY_SECONDS * 1000),
      });
      return { outcome: "deferred", receiptId };
    }

    await record(tx, row.id, outcome);
    return { outcome, receiptId };
  };

  // Attempts spent: the receipt is recorded as ignored, its text cleared.
  handler.onExhausted = async (tx, job) => {
    const receiptId = typeof job.payload.receiptId === "string" ? job.payload.receiptId : null;
    if (receiptId) await record(tx, receiptId, "ignored");
  };

  handler.messagingEndpoint = () => {
    try {
      const deps = load();
      return photonTransport(deps.config, deps.env).endpoint;
    } catch {
      return SPECTRUM_ENDPOINT;
    }
  };

  return handler;
}
