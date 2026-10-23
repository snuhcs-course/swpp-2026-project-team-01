import { type NoticeDependencies, noticeDependenciesFromEnvironment } from "./booking-notices";
import { database, type Database, type Transaction } from "./database";
import { findLinkCode } from "./email-links";
import { activeBindingOfSender, bindingContext, receiveLinkCode, refusalSentRecently } from "./imessage-links";
import { recordOutbound } from "./imessage-outbox";
import type { JobHandler } from "./jobs";
import { assertMessagingAdmitted } from "./messaging";
import { executeCommand, parseCommand } from "./imessage-commands";
import { photonConfig, type PhotonConfig, photonTransport, SPECTRUM_ENDPOINT } from "./photon";
import { receiptSealContext } from "./photon-receiver";
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
  readonly env?: Environment;
};

function receiptDependenciesFromEnvironment(): ImessageReceiptDependencies {
  const tokenKey = tokenKeyFromEnvironment();
  const setup = setupDependenciesFromEnvironment();
  return {
    config: photonConfig(),
    db: database(),
    notices: noticeDependenciesFromEnvironment(),
    origin: setup.appOrigin,
    setup,
    tokenKey,
    tokenKeys: [tokenKey],
  };
}

// The bound host's text: an exact command runs before any model turn.
export const channelProcessor: ChannelProcessor = async (tx, deps, message) => {
  const command = parseCommand(message.text);
  if (command) return executeCommand(tx, deps, message, command);
  return "ignored";
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

// An earlier message of the same conversation is not processed yet.
export class EarlierReceiptPendingError extends Error {
  constructor() {
    super("An earlier message of this conversation is not processed yet.");
    this.name = "EarlierReceiptPendingError";
  }
}

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

export async function processReceipt(
  tx: Transaction,
  deps: ImessageReceiptDependencies,
  receipt: OpenedReceipt,
  channel: ChannelProcessor | null = channelProcessor,
): Promise<ReceiptOutcome> {
  if (receipt.spaceType !== "dm" || receipt.contentType === "reaction") return "ignored";

  const code = receipt.text ? findLinkCode(receipt.text) : null;

  if (code) {
    return receiveLinkCode(tx, { tokenKey: deps.tokenKey }, {
      code,
      receiptId: receipt.id,
      sender: receipt.sender,
      senderHash: receipt.senderHash,
      spaceId: receipt.spaceId,
      spaceType: receipt.spaceType,
    });
  }

  const recipient = { address: receipt.sender, spaceId: receipt.spaceId };
  const binding = await activeBindingOfSender(tx, receipt.senderHash);
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

async function record(q: Transaction | Database, receiptId: string, outcome: ReceiptOutcome) {
  await q`
    update app.imessage_receipts
    set outcome = ${outcome}, processed_at = now(), text_ciphertext = null, sender_ciphertext = null, space_ciphertext = null
    where id = ${receiptId} and outcome is null
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
    if (earlier) throw new EarlierReceiptPendingError();

    const opened = openReceipt(deps.tokenKeys, row);
    const outcome = opened ? await processReceipt(tx, deps, opened, channelProcessor) : "ignored";

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
