import { createHash } from "node:crypto";
import { database, type Database } from "./database";
import { publishJob } from "./jobs";
import { svixHeaders, verifySvixSignature } from "./svix";

// The AgentMail webhook receiver (requester-email-ingress; requester-email-channel
// design 1). agent/channels/agentmail.ts routes POST /agentmail/webhooks/{receiverId}
// here. In order, before anything else is read: the receiver must be enabled,
// name the configured inbox and record the fingerprint of the configured signing
// secret; the Svix signature must verify over the raw body within five minutes.
// Only then is the payload parsed. A received message is stored as one receipt
// (minimized locators and the payload's SHA-256, nothing from the message itself)
// with one email_receipt job, in one transaction, before 204 is answered; every
// other event type is acknowledged and dropped. A retry of the same event finds
// its receipt and answers 204; the same event, delivery or message with other
// evidence answers 409 and changes nothing. Nothing here grants request access,
// verifies a contact or sends mail: the job decides what a message may do.

export const EMAIL_RECEIPT_JOB = "email_receipt";
export const MAX_WEBHOOK_BYTES = 256 * 1024;
// The receipt job fails its attempt while an admission window or AgentMail is
// unavailable; 10 attempts span about three hours of backoff.
export const EMAIL_RECEIPT_ATTEMPTS = 10;

type Environment = Readonly<Record<string, string | undefined>>;

export type ReceiverConfig = {
  // The product inbox the deployment serves (AGENTMAIL_INBOX_ID).
  readonly inboxId: string;
  // The webhook's signing secret (AGENTMAIL_WEBHOOK_SECRET), whsec_ prefixed.
  readonly secret: string;
};

export function receiverConfigFromEnvironment(env: Environment = process.env): ReceiverConfig {
  return { inboxId: env.AGENTMAIL_INBOX_ID?.trim() ?? "", secret: env.AGENTMAIL_WEBHOOK_SECRET?.trim() ?? "" };
}

export function secretFingerprint(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export type ReceiverDependencies = {
  readonly db: Database;
  readonly config: ReceiverConfig;
  readonly now?: () => Date;
};

function receiverDependenciesFromEnvironment(): ReceiverDependencies {
  return { config: receiverConfigFromEnvironment(), db: database() };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function answer(status: number) {
  return new Response(null, { headers: { "cache-control": "no-store" }, status });
}

export type ReceivedEvent = {
  readonly eventId: string;
  readonly inboxId: string;
  readonly threadId: string;
  readonly messageId: string;
};

function text(value: unknown, max: number) {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

// The locators of a message.received payload, or null for any other event or a
// payload without them.
export function receivedEvent(payload: unknown): ReceivedEvent | null {
  if (!payload || typeof payload !== "object") return null;

  const event = payload as { event_type?: unknown; event_id?: unknown; message?: unknown };
  if (event.event_type !== "message.received") return null;

  const message = (event.message ?? {}) as { inbox_id?: unknown; thread_id?: unknown; message_id?: unknown };
  const eventId = text(event.event_id, 200);
  const inboxId = text(message.inbox_id, 320);
  const threadId = text(message.thread_id, 500);
  const messageId = text(message.message_id, 1000);

  return eventId && inboxId && threadId && messageId ? { eventId, inboxId, messageId, threadId } : null;
}

async function readBody(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_WEBHOOK_BYTES) return null;

  const body = await request.text();
  return Buffer.byteLength(body, "utf8") > MAX_WEBHOOK_BYTES ? null : body;
}

type ReceiptRow = {
  readonly event_id: string;
  readonly inbox_id: string;
  readonly thread_id: string;
  readonly message_id: string;
  readonly payload_sha256: string;
};

export type ReceiveOutcome = "stored" | "duplicate" | "conflict" | "ignored";

// Stores the receipt and its job in one transaction. An identical earlier
// receipt (by event, delivery or message) is a duplicate; any difference in the
// stored evidence is a conflict, and nothing is written.
export async function storeReceipt(
  db: Database,
  receiverId: string,
  deliveryId: string,
  event: ReceivedEvent,
  payloadSha256: string,
): Promise<ReceiveOutcome> {
  return (await db.begin(async (tx) => {
    const [created] = await tx<{ id: string }[]>`
      insert into app.email_receipts
        (receiver_id, event_id, delivery_id, event_type, inbox_id, thread_id, message_id, payload_sha256)
      values (${receiverId}, ${event.eventId}, ${deliveryId}, 'message.received', ${event.inboxId}, ${event.threadId},
              ${event.messageId}, ${payloadSha256})
      on conflict do nothing
      returning id
    `;

    if (created) {
      await publishJob(tx, {
        dedupeKey: `receipt:${created.id}`,
        kind: EMAIL_RECEIPT_JOB,
        maxAttempts: EMAIL_RECEIPT_ATTEMPTS,
        payload: { receiptId: created.id },
      });
      return "stored";
    }

    const existing = await tx<ReceiptRow[]>`
      select event_id, inbox_id, thread_id, message_id, payload_sha256 from app.email_receipts
      where event_id = ${event.eventId} or delivery_id = ${deliveryId}
         or (inbox_id = ${event.inboxId} and message_id = ${event.messageId})
    `;
    const same = existing.every(
      (row) =>
        row.event_id === event.eventId &&
        row.inbox_id === event.inboxId &&
        row.thread_id === event.threadId &&
        row.message_id === event.messageId &&
        row.payload_sha256 === payloadSha256,
    );

    return existing.length > 0 && same ? "duplicate" : "conflict";
  })) as ReceiveOutcome;
}

export async function receiveAgentMailWebhook(
  request: Request,
  receiverId: string,
  load: () => ReceiverDependencies = receiverDependenciesFromEnvironment,
): Promise<Response> {
  const deps = load();
  const { inboxId, secret } = deps.config;

  if (!inboxId || !secret || !UUID.test(receiverId)) return answer(404);

  const [receiver] = await deps.db<{ inbox_id: string; secret_fingerprint: string }[]>`
    select inbox_id, secret_fingerprint from app.email_receivers where id = ${receiverId} and state = 'enabled'
  `;

  if (!receiver || receiver.inbox_id !== inboxId || receiver.secret_fingerprint !== secretFingerprint(secret)) {
    return answer(404);
  }

  const body = await readBody(request);
  if (body === null) return answer(413);

  const headers = svixHeaders(request.headers);
  if (!verifySvixSignature(secret, headers, body, deps.now?.())) return answer(401);

  let payload: unknown;

  try {
    payload = JSON.parse(body);
  } catch {
    return answer(400);
  }

  const event = receivedEvent(payload);

  // Unsupported delivery classes are acknowledged and create no work.
  if (!event) return answer(204);

  // A message for another inbox is not this receiver's to accept.
  if (event.inboxId !== inboxId) return answer(404);

  const outcome = await storeReceipt(
    deps.db,
    receiverId,
    headers.id!,
    event,
    createHash("sha256").update(body, "utf8").digest("hex"),
  );

  return answer(outcome === "conflict" ? 409 : 204);
}
