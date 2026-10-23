import { database, type Database, type Transaction } from "./database";
import { findLinkCode } from "./email-links";
import { receiveLinkCode } from "./imessage-links";
import type { JobHandler } from "./jobs";
import { assertMessagingAdmitted } from "./messaging";
import { photonConfig, type PhotonConfig, photonTransport, SPECTRUM_ENDPOINT } from "./photon";
import { receiptSealContext } from "./photon-receiver";
import { openToken, type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// The imessage_receipt job (host-imessage-channel design 7): what one stored
// Photon receipt may do. It checks messaging admission first, then opens the
// receipt's sealed text, sender and conversation and, in order:
//   - a group conversation or a reaction does nothing;
//   - an earlier receipt of the same conversation still unprocessed fails the
//     attempt, so a later message never overtakes it;
//   - a message carrying an FMAT- code is linking (imessage-links.ts) and never
//     reaches the model.
// The outcome is recorded with the sealed values cleared in the same write.

type Environment = Readonly<Record<string, string | undefined>>;

export type ReceiptOutcome = "link_received" | "link_refused" | "unlinked_reply" | "command" | "forwarded" | "replied" | "ignored";

export type ImessageReceiptDependencies = {
  readonly db: Database;
  readonly config: PhotonConfig;
  readonly tokenKey: TokenKey;
  readonly tokenKeys: readonly TokenKey[];
  readonly env?: Environment;
};

function receiptDependenciesFromEnvironment(): ImessageReceiptDependencies {
  const tokenKey = tokenKeyFromEnvironment();
  return { config: photonConfig(), db: database(), tokenKey, tokenKeys: [tokenKey] };
}

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

export async function processReceipt(tx: Transaction, deps: ImessageReceiptDependencies, receipt: OpenedReceipt): Promise<ReceiptOutcome> {
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

  return "ignored";
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
    const outcome = opened ? await processReceipt(tx, deps, opened) : "ignored";

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
