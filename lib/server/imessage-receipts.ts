import { getChatMessageLengthError } from "../contracts/chat-message";
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
import { activeBindingOfSender, bindingContext, lockActiveBindingOfSender, receiveLinkCode, refusalSentRecently } from "./imessage-links";
import { recordOutbound } from "./imessage-outbox";
import { type JobHandler, publishJob } from "./jobs";
import { assertMessagingAdmitted } from "./messaging";
import { executeCommand, parseCommand, requestRef } from "./imessage-commands";
import { photonConfig, type PhotonConfig, photonTransport, SPECTRUM_ENDPOINT } from "./photon";
import { IMESSAGE_RECEIPT_JOB, receiptSealContext } from "./photon-receiver";
import { emailSourceHash } from "./email-receipts";
import { requesterBindingContext } from "./requester-imessage-bindings";
import { type CreationLimits } from "./request-start";
import { isRevisable, reviseClosedRequest, revisedSummary } from "./revised-requests";
import { type SetupDependencies, setupDependenciesFromEnvironment } from "./setup";
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
//   - content other than text gets one fixed reply;
//   - otherwise the bound host's message goes on to the channel (commands and
//     forwarding).
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
// where it came from (D11).
export const IMESSAGE_PREFIX = "[iMessage] ";

export const FORWARD_TEXTS = {
  tooLong: "That message is too long for Thyme. Please send a shorter one.",
  requestGone: "That request isn't available any more, so this went to your setup conversation. Send requests to choose another.",
} as const;

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
  const text = `${IMESSAGE_PREFIX}${message.text}`;
  if (getChatMessageLengthError(text)) {
    await fixedReply(tx, deps, message, "command", FORWARD_TEXTS.tooLong);
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
      text: FORWARD_TEXTS.requestGone,
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
  return forward(tx, deps, message);
};

type ReceiptRow = {
  readonly id: string;
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
  readonly senderHash: string;
  readonly spaceHash: string;
  readonly spaceType: "dm" | "group";
  readonly contentType: string;
  readonly text: string | null;
  readonly sender: string;
  readonly spaceId: string;
};

function openReceipt(keys: readonly TokenKey[], row: ReceiptRow): OpenedReceipt | null {
  if (!row.sender_ciphertext || !row.space_ciphertext || !row.sealed_key_id) return null;
  const open = (ciphertext: string) => openToken(keys, { ciphertext, keyId: row.sealed_key_id! }, receiptSealContext(row.id));

  try {
    return {
      contentType: row.content_type,
      id: row.id,
      sender: open(row.sender_ciphertext),
      senderHash: row.sender_hash,
      spaceHash: row.space_hash,
      spaceId: open(row.space_ciphertext),
      spaceType: row.space_type,
      text: row.text_ciphertext ? open(row.text_ciphertext) : null,
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

export const CHANNEL_TEXTS = {
  unlinked: "This number isn't linked to a Find Me a Time host. Sign in at findmeatime.com/app and choose Connect iMessage.",
  textOnly: "I can read text messages only.",
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
  closed: "This request is closed, so messages here no longer reach Thyme. Your booking page, linked in your email, shows its final status.",
  switched: (host: string) => `Now talking about your request with ${host}.`,
  tooLong: "That message is too long for Thyme. Please send a shorter one.",
} as const;

type GuestBinding = {
  readonly id: string;
  readonly request_id: string;
  readonly state: "active" | "unlinked" | "ended" | "moved";
  readonly moved_to_request_id: string | null;
  readonly sealed_key_id: string | null;
};

async function guestBindingById(tx: Transaction, id: string) {
  const [row] = await tx<GuestBinding[]>`
    select id, request_id, state, moved_to_request_id, sealed_key_id from app.requester_imessage_bindings where id = ${id}
  `;
  return row ?? null;
}

async function activeGuestBindings(tx: Transaction, senderHash: string) {
  return tx<GuestBinding[]>`
    select id, request_id, state, moved_to_request_id, sealed_key_id from app.requester_imessage_bindings
    where sender_hash = ${senderHash} and state = 'active'
    order by created_at desc
  `;
}

// Which guest binding, if any, a message from this sender is for:
//   1. `request <ref>` naming one of the sender's guest requests switches to it
//      (until the host side's conversational selection lands);
//   2. any other exact command from a linked host is the host's;
//   3. otherwise the last message the line sent this sender decides: a guest
//      message's binding (following a move to the revised request), unless the
//      guest unlinked it; a host message, the host path;
//   4. with neither, the host binding if there is one, else the most recent
//      guest binding; null means the host path, which answers a sender with no
//      binding at all with the unlinked reply.
async function guestRoute(tx: Transaction, receipt: OpenedReceipt): Promise<{ binding: GuestBinding; switched: boolean } | null> {
  const command = receipt.text ? parseCommand(receipt.text) : null;
  const guests = await activeGuestBindings(tx, receipt.senderHash);

  if (command?.name === "request") {
    const named = guests.find((binding) => requestRef(binding.request_id) === command.ref);
    if (named) return { binding: named, switched: true };
  }

  const host = await activeBindingOfSender(tx, receipt.senderHash);
  if (command && host) return null;

  const [last] = await tx<{ binding_id: string | null; requester_binding_id: string | null }[]>`
    select binding_id, requester_binding_id from app.imessage_outbox
    where recipient_hash = ${receipt.senderHash} and (binding_id is not null or requester_binding_id is not null)
    order by created_at desc, id desc
    limit 1
  `;

  if (last?.requester_binding_id) {
    let binding = await guestBindingById(tx, last.requester_binding_id);
    for (let hops = 0; binding?.state === "moved" && binding.moved_to_request_id && hops < 10; hops += 1) {
      const [next] = await tx<GuestBinding[]>`
        select id, request_id, state, moved_to_request_id, sealed_key_id from app.requester_imessage_bindings
        where request_id = ${binding.moved_to_request_id} and sender_hash = ${receipt.senderHash}
        order by created_at desc limit 1
      `;
      binding = next ?? null;
    }
    if (binding && binding.state !== "unlinked" && binding.state !== "moved") return { binding, switched: false };
  } else if (last?.binding_id && host) {
    return null;
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
// fixed reply; a declined or expired request's message starts a revised
// request (design 5) and goes there; any other closed request's binding
// answers once with the closed notice; text is forwarded into the request's
// requester discussion as an accepted input keyed by the receipt, and the
// turn's final text is the reply.
async function guestMessage(
  tx: Transaction,
  deps: ImessageReceiptDependencies,
  receipt: OpenedReceipt,
  route: { binding: GuestBinding; switched: boolean },
): Promise<ReceiptOutcome> {
  const [request] = await tx<{ open: boolean; state: string; host_name: string | null }[]>`
    select r.closed_at is null and r.expires_at > now() as open, r.state, s.settings ->> 'displayName' as host_name
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

  if (route.switched) {
    await guestReply(tx, deps, receipt, binding, { dedupeKey: `receipt:${receipt.id}`, kind: "command", text: GUEST_TEXTS.switched(request?.host_name ?? "your host") });
    return "command";
  }

  if (!text) {
    await guestReply(tx, deps, receipt, binding, { dedupeKey: `receipt:${receipt.id}`, kind: "text_only", text: CHANNEL_TEXTS.textOnly });
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
    text: GUEST_TEXTS.closed,
  });
  return created ? ("replied" as const) : ("ignored" as const);
}

// A revised request for the declined or expired one, created or found, then
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

  const [earlier] = await tx<{ id: string; state: string; details: Parameters<typeof revisedSummary>[0]["details"] }[]>`
    select id, state, details from app.requests where id = ${binding.request_id}
  `;
  const accepted = await acceptRevisedSummary(deps, outcome.requestId, revisedSummary(earlier!));
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
  const text = `${IMESSAGE_PREFIX}${message}`;
  if (getChatMessageLengthError(text)) {
    await guestReply(tx, deps, receipt, binding, { dedupeKey: `receipt:${receipt.id}`, kind: "command", text: GUEST_TEXTS.tooLong });
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

export async function processReceipt(
  tx: Transaction,
  deps: ImessageReceiptDependencies,
  receipt: OpenedReceipt,
  channel: ChannelProcessor | null = channelProcessor,
): Promise<ReceiptOutcome> {
  // A code is linking wherever it appears: from a group conversation it voids
  // the attempt it names, with no reply into the group.
  const code = receipt.text ? findLinkCode(receipt.text) : null;

  if (code) {
    return receiveLinkCode(tx, { origin: deps.origin, tokenKey: deps.tokenKey }, {
      code,
      receiptId: receipt.id,
      sender: receipt.sender,
      senderHash: receipt.senderHash,
      spaceId: receipt.spaceId,
      spaceType: receipt.spaceType,
    });
  }

  if (receipt.spaceType !== "dm" || ["reaction", "read", "typing"].includes(receipt.contentType)) return "ignored";

  const guest = await guestRoute(tx, receipt);
  if (guest) return channel ? guestMessage(tx, deps, receipt, guest) : "ignored";

  const recipient = { address: receipt.sender, spaceId: receipt.spaceId };
  const binding = await lockActiveBindingOfSender(tx, receipt.senderHash);
  const [host] = binding
    ? await tx<{ status: string; auth_user_id: string | null }[]>`
        select a.status, i.auth_user_id from app.host_accounts a
        left join app.google_identities i on i.host_account_id = a.id
        where a.id = ${binding.host_account_id}
      `
    : [];

  if (!binding || host?.status !== "active" || !host.auth_user_id) {
    if (await refusalSentRecently(tx, receipt.senderHash)) return "ignored";
    await recordOutbound(tx, {
      dedupeKey: `receipt:${receipt.id}`,
      kind: "unlinked_sender",
      recipient,
      recipientHash: receipt.senderHash,
      text: CHANNEL_TEXTS.unlinked,
      tokenKey: deps.tokenKey,
    });
    return "unlinked_reply";
  }

  // The conversation the host writes from is where replies go; a fallback
  // binding learns it from the host's first message.
  const space = sealToken({ id: binding.sealed_key_id, key: keyFor(deps, binding.sealed_key_id) }, receipt.spaceId, bindingContext(binding.id));
  await tx`
    update app.imessage_bindings set space_ciphertext = ${space.ciphertext}, last_inbound_at = now()
    where id = ${binding.id} and state = 'active'
  `;

  if (receipt.contentType !== "text" || !receipt.text?.trim()) {
    await recordOutbound(tx, {
      bindingId: binding.id,
      dedupeKey: `receipt:${receipt.id}`,
      hostAccountId: binding.host_account_id,
      kind: "text_only",
      recipient,
      recipientHash: receipt.senderHash,
      text: CHANNEL_TEXTS.textOnly,
      tokenKey: deps.tokenKey,
    });
    return "replied";
  }

  if (!channel) return "ignored";

  return channel(tx, deps, {
    authUserId: host.auth_user_id,
    bindingId: binding.id,
    hostAccountId: binding.host_account_id,
    receipt,
    recipient,
    selectedRequestId: binding.selected_request_id,
    text: receipt.text.trim(),
  });
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
      select id, sender_hash, space_hash, space_type, content_type, text_ciphertext, sender_ciphertext, space_ciphertext,
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
