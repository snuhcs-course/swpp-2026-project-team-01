import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCapturedReplyCallbacks,
  createReceiver,
  privateJson,
  verifyRawBody,
} from "./agentmail-webhook-lib.mjs";

const secret = "whsec_plJ3nmyCDGBKInavdOK15jsl"; // Published Svix test vector, not a credential.
const body = Buffer.from('{"event_type":"ping","data":{"success":true}}');
test("official independent Svix test vector verifies exact bytes", () => {
  const headers = {
    "svix-id": "msg_loFOjxBNrRLzqYUf",
    "svix-timestamp": "1731705121",
    "svix-signature": "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=",
  };
  assert.equal(
    verifyRawBody(body, headers, secret, 1731705121000).event_type,
    "ping",
  );
  assert.throws(() =>
    verifyRawBody(
      Buffer.concat([body, Buffer.from(" ")]),
      headers,
      secret,
      1731705121000,
    ),
  );
  assert.throws(
    () => verifyRawBody(body, headers, secret, 1731705431000),
    /STALE/,
  );
});

test("concurrent signed duplicates persist once across receiver restart, scope stays isolated", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fmat-webhook-"));
  try {
    const config = {
      secret,
      namespace: "fmat-p0-unit",
      inboxIds: ["fixture@example.invalid"],
      fixtureEmails: ["fixture@example.invalid"],
      subjectMarker: "fmat-p0-unit-subject",
    };
    await privateJson(join(directory, "webhook-config.json"), config);
    const event = {
      event_type: "message.received",
      event_id: "evt_fixture",
      message: {
        inbox_id: config.inboxIds[0],
        message_id: "<fixture@example.invalid>",
        subject: config.subjectMarker,
        from: "Fixture <fixture@example.invalid>",
        to: ["fixture@example.invalid"],
        thread_id: "fixture-thread",
      },
    };
    const raw = Buffer.from(JSON.stringify(event));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac(
      "sha256",
      Buffer.from(secret.slice(6), "base64"),
    )
      .update(`msg_fixture.${timestamp}.`)
      .update(raw)
      .digest("base64");
    const headers = {
      "svix-id": "msg_fixture",
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    };
    const receive = createReceiver(directory);
    const results = await Promise.all([
      receive(raw, headers),
      receive(raw, headers),
    ]);
    assert.deepEqual(
      results.map((r) => r.outcome),
      ["persisted", "duplicate_ignored"],
    );
    assert.equal(
      (await createReceiver(directory)(raw, headers)).outcome,
      "duplicate_ignored",
    );
    assert.equal(
      (await receive(Buffer.concat([raw, Buffer.from(" ")]), headers)).status,
      401,
    );
    await privateJson(join(directory, "webhook-config.json"), {
      ...config,
      inboxIds: ["other@example.invalid"],
    });
    assert.equal((await receive(raw, headers)).status, 403);
    const ledger = JSON.parse(
      await readFile(join(directory, "webhook-ledger.json"), "utf8"),
    );
    assert.equal(ledger.processed.length, 1);
    assert.equal(ledger.duplicateCount, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("signed sent callbacks require the exact owned recipient", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fmat-webhook-"));
  try {
    const config = {
      secret,
      namespace: "fmat-p0-unit",
      inboxIds: ["fixture@example.invalid"],
      fixtureEmails: ["fixture@example.invalid"],
      subjectMarker: "fmat-p0-unit-subject",
    };
    await privateJson(join(directory, "webhook-config.json"), config);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const receive = createReceiver(directory);
    for (const [recipients, expected] of [
      [["other@example.invalid"], 403],
      [["fixture@example.invalid", "other@example.invalid"], 403],
      [["fixture@example.invalid"], 204],
    ]) {
      const raw = Buffer.from(
        JSON.stringify({
          event_type: "message.sent",
          event_id: "evt_sent",
          send: {
            inbox_id: config.inboxIds[0],
            message_id: "<fixture@example.invalid>",
            thread_id: "fixture-thread",
            recipients,
          },
        }),
      );
      const signature = createHmac(
        "sha256",
        Buffer.from(secret.slice(6), "base64"),
      )
        .update(`msg_sent.${timestamp}.`)
        .update(raw)
        .digest("base64");
      assert.equal(
        (
          await receive(raw, {
            "svix-id": "msg_sent",
            "svix-timestamp": timestamp,
            "svix-signature": `v1,${signature}`,
          })
        ).status,
        expected,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("captured callback claims bind exact reply and exclude local synthetic IDs", () => {
  const receivedAt = "2026-10-05T00:00:00Z";
  const timestamp = String(Date.parse(receivedAt) / 1000);
  const payload = {
    replyMessageId: "expected-reply",
    replyThreadId: "expected-thread",
    initialRetryMessageId: "expected-initial",
  };
  const event = {
    event_type: "message.sent",
    event_id: "evt_expected",
    send: {
      inbox_id: "owned",
      message_id: payload.replyMessageId,
      thread_id: payload.replyThreadId,
    },
  };
  const raw = Buffer.from(JSON.stringify(event));
  const svixId = "msg_provider_test_vector";
  const signature = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(`${svixId}.${timestamp}.`)
    .update(raw)
    .digest("base64");
  const entry = {
    receivedAt,
    svixId,
    eventId: event.event_id,
    eventType: event.event_type,
    messageId: payload.replyMessageId,
    threadId: payload.replyThreadId,
    raw: raw.toString("base64"),
    headers: {
      "svix-id": svixId,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    },
  };
  const config = { namespace: "fmat-p0-test", secret, inboxIds: ["owned"] };
  const ledger = { namespace: config.namespace, processed: [entry] };
  assert.equal(assertCapturedReplyCallbacks(ledger, config, payload).length, 1);
  const initialEvent = {
    ...event,
    event_id: "evt_initial",
    send: { ...event.send, message_id: payload.initialRetryMessageId },
  };
  const initialRaw = Buffer.from(JSON.stringify(initialEvent));
  const initialId = "msg_initial_test_vector";
  const initialSignature = createHmac(
    "sha256",
    Buffer.from(secret.slice(6), "base64"),
  )
    .update(`${initialId}.${timestamp}.`)
    .update(initialRaw)
    .digest("base64");
  const initialEntry = {
    ...entry,
    svixId: initialId,
    eventId: initialEvent.event_id,
    messageId: payload.initialRetryMessageId,
    raw: initialRaw.toString("base64"),
    headers: {
      "svix-id": initialId,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${initialSignature}`,
    },
  };
  assert.equal(
    assertCapturedReplyCallbacks(
      { ...ledger, processed: [initialEntry, entry] },
      config,
      payload,
    ).length,
    1,
  );
  assert.throws(
    () =>
      assertCapturedReplyCallbacks(ledger, config, {
        ...payload,
        replyMessageId: "other",
      }),
    /BINDING/,
  );
  assert.throws(
    () =>
      assertCapturedReplyCallbacks(
        { ...ledger, processed: [{ ...entry, svixId: "msg_local_fake" }] },
        config,
        payload,
      ),
    /NO_PROVIDER/,
  );
});
