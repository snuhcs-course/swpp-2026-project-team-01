import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { database, type Database } from "./database";
import { publishJob } from "./jobs";
import { sealToken, type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// The Photon webhook receiver (host-imessage-channel design 2, D1, D7).
// agent/channels/photon.ts routes POST /photon/webhook here. In order, before
// anything else is read: the deployment must name its webhook and signing secret;
// the delivery must name that webhook; the signature (`v0=` and the hex
// HMAC-SHA256 of `v0:{timestamp}:{raw body}`, as Photon documents it and eve's
// bundled adapter checks it) must verify within five minutes. Only then is the
// payload parsed. An inbound message is stored as one receipt (keyed hashes of the
// sender and conversation, the payload's SHA-256, and the text, sender and
// conversation sealed until processing) with one imessage_receipt job, in one
// transaction, before 200 is answered; every other event is acknowledged and
// dropped. Photon retries a 5xx with the same message.id, so a duplicate answers
// 200 and a changed payload under that ID answers 409 and changes nothing. The
// signature check and durable-before-acknowledgment shape follow teammate draft
// PR #23 (docs/host-imessage-linking). Nothing here binds a sender or grants
// access: the job decides what a message may do.

export const IMESSAGE_RECEIPT_JOB = "imessage_receipt";
export const MAX_WEBHOOK_BYTES = 64 * 1024;
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
// The receipt job fails its attempt while an admission window or an earlier
// message of the conversation holds it; 10 attempts span about three hours.
export const IMESSAGE_RECEIPT_ATTEMPTS = 10;

type Environment = Readonly<Record<string, string | undefined>>;

export type PhotonReceiverConfig = {
  // The webhook's signing secret (PHOTON_WEBHOOK_SECRET).
  readonly secret: string;
  // The registered webhook's ID (PHOTON_WEBHOOK_ID); other webhooks' deliveries are not ours.
  readonly webhookId: string;
};

export function photonReceiverConfig(env: Environment = process.env): PhotonReceiverConfig {
  return { secret: env.PHOTON_WEBHOOK_SECRET?.trim() ?? "", webhookId: env.PHOTON_WEBHOOK_ID?.trim() ?? "" };
}

export function photonSignature(secret: string, timestamp: string, body: string) {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`, "utf8").digest("hex")}`;
}

export function verifyPhotonSignature(
  secret: string,
  headers: Headers,
  body: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
) {
  const timestamp = headers.get("x-spectrum-timestamp") ?? "";
  const presented = headers.get("x-spectrum-signature") ?? "";

  if (!/^\d{1,12}$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = Buffer.from(photonSignature(secret, timestamp, body));
  const given = Buffer.from(presented);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const E164 = /^\+[1-9]\d{6,14}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,63}$/;

// Photon's sender.id (D2): an E.164 number, kept as given, or the Apple ID email
// a host's Messages sends from, lower-cased. Anything else is not a sender.
export function normalizeSender(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (E164.test(trimmed)) return trimmed;
  return EMAIL.test(trimmed) ? trimmed.toLowerCase() : null;
}

// The keyed hash a sender, conversation or entered number is looked up by.
export function imessageHash(key: TokenKey, kind: "sender" | "space" | "phone" | "starter", value: string) {
  const derived = createHmac("sha256", key.key).update(`find-me-a-time/imessage-${kind}/v1`).digest();
  return createHmac("sha256", derived).update(value, "utf8").digest("hex");
}

export function receiptSealContext(receiptId: string) {
  return `imessage_receipt:${receiptId}`;
}

export type InboundMessage = {
  readonly messageId: string;
  readonly sender: string;
  readonly spaceId: string;
  readonly spaceType: "dm" | "group";
  readonly contentType: string;
  // The text of a text message; null for every other content type.
  readonly text: string | null;
  readonly sentAt: Date | null;
};

function text(value: unknown, max: number) {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

// The inbound message of a `messages` event, or null for any other event, an
// outbound echo or a payload without its locators.
export function inboundMessage(payload: unknown): InboundMessage | null {
  if (!payload || typeof payload !== "object") return null;

  const event = payload as { event?: unknown; message?: unknown; space?: unknown };
  if (event.event !== "messages" || !event.message || typeof event.message !== "object") return null;

  const message = event.message as {
    id?: unknown;
    direction?: unknown;
    sender?: { id?: unknown } | null;
    space?: { id?: unknown; type?: unknown } | null;
    content?: { type?: unknown; text?: unknown } | null;
    timestamp?: unknown;
  };
  const space = (event.space && typeof event.space === "object" ? event.space : message.space) as
    | { id?: unknown; type?: unknown }
    | null
    | undefined;

  if (message.direction !== "inbound") return null;

  const messageId = text(message.id, 500);
  const sender = normalizeSender(message.sender?.id);
  const spaceId = text(space?.id, 500);
  const spaceType = space?.type === "dm" || space?.type === "group" ? space.type : null;
  const contentType = text(message.content?.type, 50);

  // Read receipts and typing signals are not messages from the user. Replying
  // to a read receipt would generate another one whenever they read our reply.
  if (contentType === "read" || contentType === "typing") return null;

  if (!messageId || !sender || !spaceId || !spaceType || !contentType) return null;

  const sentAt = typeof message.timestamp === "string" && !Number.isNaN(Date.parse(message.timestamp)) ? new Date(message.timestamp) : null;
  const body = contentType === "text" && typeof message.content?.text === "string" ? message.content.text : null;

  return { contentType, messageId, sender, sentAt, spaceId, spaceType, text: body };
}

export type ReceiverDependencies = {
  readonly db: Database;
  readonly config: PhotonReceiverConfig;
  readonly tokenKey: TokenKey;
  readonly now?: () => number;
};

// The database and the token key are resolved only once a delivery passed the
// configuration and signature checks, so an unconfigured deployment answers 404.
function receiverDependenciesFromEnvironment(): ReceiverDependencies {
  return {
    config: photonReceiverConfig(),
    get db() {
      return database();
    },
    get tokenKey() {
      return tokenKeyFromEnvironment();
    },
  };
}

function answer(status: number) {
  return new Response(null, { headers: { "cache-control": "no-store" }, status });
}

// The raw body, read with a byte cap whether or not a length is declared.
async function readBody(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_WEBHOOK_BYTES) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_WEBHOOK_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

export type ReceiveOutcome = "stored" | "duplicate" | "conflict";

// Stores the receipt and its job in one transaction. An earlier receipt of the
// same message with the same payload is a duplicate; another payload is a
// conflict, and nothing is written.
export async function storeReceipt(
  deps: Pick<ReceiverDependencies, "db" | "tokenKey">,
  webhookId: string,
  message: InboundMessage,
  payloadSha256: string,
): Promise<ReceiveOutcome> {
  const { db, tokenKey } = deps;

  return (await db.begin(async (tx) => {
    const [row] = await tx<{ id: string }[]>`select gen_random_uuid() as id`;
    const id = row!.id;
    const context = receiptSealContext(id);
    const sealed = {
      sender: sealToken(tokenKey, message.sender, context),
      space: sealToken(tokenKey, message.spaceId, context),
      text: message.text === null ? null : sealToken(tokenKey, message.text, context),
    };

    const [created] = await tx<{ id: string }[]>`
      insert into app.imessage_receipts
        (id, message_id, webhook_id, sender_hash, space_hash, space_type, content_type, provider_sent_at, payload_sha256,
         text_ciphertext, sender_ciphertext, space_ciphertext, sealed_key_id)
      values (${id}, ${message.messageId}, ${webhookId}, ${imessageHash(tokenKey, "sender", message.sender)},
              ${imessageHash(tokenKey, "space", message.spaceId)}, ${message.spaceType}, ${message.contentType},
              ${message.sentAt}, ${payloadSha256}, ${sealed.text?.ciphertext ?? null}, ${sealed.sender.ciphertext},
              ${sealed.space.ciphertext}, ${tokenKey.id})
      on conflict (message_id) do nothing
      returning id
    `;

    if (created) {
      await publishJob(tx, {
        dedupeKey: `receipt:${created.id}`,
        kind: IMESSAGE_RECEIPT_JOB,
        maxAttempts: IMESSAGE_RECEIPT_ATTEMPTS,
        payload: { receiptId: created.id },
      });
      return "stored";
    }

    const [existing] = await tx<{ payload_sha256: string }[]>`
      select payload_sha256 from app.imessage_receipts where message_id = ${message.messageId}
    `;
    return existing?.payload_sha256 === payloadSha256 ? "duplicate" : "conflict";
  })) as ReceiveOutcome;
}

export async function receivePhotonWebhook(
  request: Request,
  load: () => ReceiverDependencies = receiverDependenciesFromEnvironment,
): Promise<Response> {
  const deps = load();
  const { secret, webhookId } = deps.config;

  if (!secret || !webhookId) return answer(404);

  const body = await readBody(request);
  if (body === null) return answer(413);

  if (request.headers.get("x-spectrum-webhook-id") !== webhookId) return answer(404);

  const now = deps.now ? Math.floor(deps.now() / 1000) : undefined;
  if (!verifyPhotonSignature(secret, request.headers, body, now)) return answer(401);

  let payload: unknown;

  try {
    payload = JSON.parse(body);
  } catch {
    return answer(400);
  }

  const message = inboundMessage(payload);

  // Other events, outbound echoes and payloads without locators create no work.
  if (!message) return answer(200);

  const outcome = await storeReceipt(deps, webhookId, message, createHash("sha256").update(body, "utf8").digest("hex"));

  return answer(outcome === "conflict" ? 409 : 200);
}
