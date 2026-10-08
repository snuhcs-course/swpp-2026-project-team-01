// AI-generated with Codex, 2026-10-05 (Asia/Seoul).
import { createHmac } from "node:crypto";
import { createReceiver, privateJson, verifyRawBody } from "./agentmail-webhook-lib.mjs";

export { createReceiver, privateJson, verifyRawBody };

function address(value) {
  if (typeof value !== "string") return undefined;
  return value.match(/<([^>]+)>/)?.[1] ?? value;
}

export function signFixture(raw, secret, id, timestamp) {
  const value = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(`${id}.${timestamp}.`)
    .update(raw)
    .digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": String(timestamp),
    "svix-signature": `v1,${value}`,
  };
}

export function validatePairedCallbacks(ledger, config, payload) {
  if (ledger.namespace !== config.namespace || ledger.processed.length > 6) {
    throw new Error("PAIRED_LEDGER_SCOPE_MISMATCH");
  }
  const provider = ledger.processed.filter((entry) => !entry.svixId.startsWith("msg_local_"));
  const seen = new Set();
  const classifications = [];
  for (const entry of provider) {
    const receivedAt = Date.parse(entry.receivedAt);
    const event = verifyRawBody(
      Buffer.from(entry.raw, "base64"),
      entry.headers,
      config.secret,
      receivedAt,
    );
    const metadata = event.message ?? event.send ?? event.delivery;
    if (
      !["message.received", "message.sent", "message.delivered"].includes(event.event_type) ||
      !config.inboxIds.includes(metadata?.inbox_id) ||
      seen.has(event.event_id) ||
      event.event_id !== entry.eventId ||
      event.event_type !== entry.eventType ||
      entry.svixId !== entry.headers["svix-id"] ||
      metadata.message_id !== entry.messageId ||
      metadata.thread_id !== entry.threadId
    ) throw new Error("PAIRED_CALLBACK_BINDING_MISMATCH");
    seen.add(event.event_id);

    let direction;
    if (event.event_type === "message.received") {
      if (
        !Array.isArray(metadata.to) ||
        metadata.to.length !== 1
      ) throw new Error("PAIRED_RECEIVED_CONTENT_MISMATCH");
      if (
        metadata.inbox_id === payload.fixtureInboxId &&
        address(metadata.from) === payload.originalEmail &&
        address(metadata.to[0]) === payload.fixtureEmail
      ) direction = "initial";
      else if (
        metadata.inbox_id === payload.originalInboxId &&
        address(metadata.from) === payload.fixtureEmail &&
        address(metadata.to[0]) === payload.originalEmail
      ) direction = "reply";
      const expectedSubject = direction === "reply" ? `Re: ${payload.subject}` : payload.subject;
      if (metadata.subject !== expectedSubject) {
        throw new Error("PAIRED_RECEIVED_CONTENT_MISMATCH");
      }
    } else {
      if (!Array.isArray(metadata.recipients) || metadata.recipients.length !== 1) {
        throw new Error("PAIRED_OUTBOUND_RECIPIENT_MISMATCH");
      }
      if (
        metadata.inbox_id === payload.originalInboxId &&
        metadata.recipients[0] === payload.fixtureEmail &&
        metadata.message_id === payload.initialAcceptedMessageId
      ) direction = "initial";
      else if (
        metadata.inbox_id === payload.fixtureInboxId &&
        metadata.recipients[0] === payload.originalEmail &&
        metadata.message_id === payload.replyAcceptedMessageId
      ) direction = "reply";
    }
    if (!direction) throw new Error("PAIRED_CALLBACK_DIRECTION_MISMATCH");
    classifications.push({ entry, event, metadata, direction });
  }

  const count = (direction, type) =>
    classifications.filter((item) => item.direction === direction && item.event.event_type === type).length;
  for (const direction of ["initial", "reply"])
    for (const type of ["message.sent", "message.delivered", "message.received"])
      if (count(direction, type) !== 1) throw new Error("PAIRED_CALLBACK_SET_INCOMPLETE");

  const initialReceived = classifications.find(
    (item) => item.direction === "initial" && item.event.event_type === "message.received",
  );
  const replyReceived = classifications.find(
    (item) => item.direction === "reply" && item.event.event_type === "message.received",
  );
  if (
    initialReceived.metadata.message_id !== payload.receivedParentMessageId ||
    initialReceived.metadata.thread_id !== payload.receivedParentThreadId ||
    payload.replyAcceptedThreadId !== payload.receivedParentThreadId ||
    replyReceived.metadata.thread_id !== payload.initialAcceptedThreadId
  ) throw new Error("PER_INBOX_THREADING_MISMATCH");

  return {
    provider,
    classifications,
    initialReceived,
    replyReceived,
    originalInboxThreadMatched: true,
    fixtureInboxThreadMatched: true,
    crossInboxThreadEqualityRequired: false,
  };
}
