// AI-generated with Codex, 2026-10-05 (Asia/Seoul).
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { validatePairedCallbacks } from "./agentmail-paired-webhook-lib.mjs";

const secret = "whsec_plJ3nmyCDGBKInavdOK15jsl";
const receivedAt = "2026-10-05T00:00:00Z";
const timestamp = String(Date.parse(receivedAt) / 1000);
const payload = {
  subject: "[fmat-p0-distinct-test] controlled distinct identity",
  originalInboxId: "original-id",
  originalEmail: "original@example.invalid",
  fixtureInboxId: "fixture-id",
  fixtureEmail: "fixture@example.invalid",
  initialAcceptedMessageId: "initial-outbound",
  initialAcceptedThreadId: "original-thread",
  receivedParentMessageId: "initial-inbound",
  receivedParentThreadId: "fixture-thread",
  replyAcceptedMessageId: "reply-outbound",
  replyAcceptedThreadId: "fixture-thread",
};
const config = {
  namespace: "fmat-p0-distinct-test",
  secret,
  inboxIds: [payload.originalInboxId, payload.fixtureInboxId],
};

function entry(event, index) {
  const raw = Buffer.from(JSON.stringify(event));
  const id = `msg_provider_${index}`;
  const signature = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(`${id}.${timestamp}.`)
    .update(raw)
    .digest("base64");
  const metadata = event.message ?? event.send ?? event.delivery;
  return {
    receivedAt,
    svixId: id,
    eventId: event.event_id,
    eventType: event.event_type,
    messageId: metadata.message_id,
    inboxId: metadata.inbox_id,
    threadId: metadata.thread_id,
    raw: raw.toString("base64"),
    headers: {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    },
  };
}

function outbound(type, direction, index) {
  const initial = direction === "initial";
  const metadata = {
    inbox_id: initial ? payload.originalInboxId : payload.fixtureInboxId,
    message_id: initial ? payload.initialAcceptedMessageId : payload.replyAcceptedMessageId,
    thread_id: initial ? payload.initialAcceptedThreadId : payload.replyAcceptedThreadId,
    recipients: [initial ? payload.fixtureEmail : payload.originalEmail],
  };
  const property = type === "message.sent" ? "send" : "delivery";
  return entry({ event_type: type, event_id: `evt_${index}`, [property]: metadata }, index);
}

function received(direction, index) {
  const initial = direction === "initial";
  return entry({
    event_type: "message.received",
    event_id: `evt_${index}`,
    message: {
      inbox_id: initial ? payload.fixtureInboxId : payload.originalInboxId,
      message_id: initial ? payload.receivedParentMessageId : "reply-inbound",
      thread_id: initial ? payload.receivedParentThreadId : payload.initialAcceptedThreadId,
      subject: initial ? payload.subject : `Re: ${payload.subject}`,
      from: initial ? payload.originalEmail : payload.fixtureEmail,
      to: [initial ? payload.fixtureEmail : payload.originalEmail],
    },
  }, index);
}

function ledger() {
  return {
    namespace: config.namespace,
    processed: [
      outbound("message.sent", "initial", 1),
      outbound("message.delivered", "initial", 2),
      received("initial", 3),
      outbound("message.sent", "reply", 4),
      outbound("message.delivered", "reply", 5),
      received("reply", 6),
    ],
  };
}

test("six signed callbacks prove per-inbox threads without cross-inbox equality", () => {
  assert.notEqual(payload.initialAcceptedThreadId, payload.receivedParentThreadId);
  const result = validatePairedCallbacks(ledger(), config, payload);
  assert.equal(result.provider.length, 6);
  assert.equal(result.originalInboxThreadMatched, true);
  assert.equal(result.fixtureInboxThreadMatched, true);
  assert.equal(result.crossInboxThreadEqualityRequired, false);
});

test("missing received callback or wrong original-side reply thread fails", () => {
  const missing = ledger();
  missing.processed.pop();
  assert.throws(() => validatePairedCallbacks(missing, config, payload), /INCOMPLETE/);
  const wrong = ledger();
  const event = JSON.parse(Buffer.from(wrong.processed[5].raw, "base64").toString("utf8"));
  event.message.thread_id = "wrong-thread";
  wrong.processed[5] = entry(event, 60);
  assert.throws(() => validatePairedCallbacks(wrong, config, payload), /THREADING/);
});
