import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Isolated P0 receiver. Manual recipe: https://docs.svix.com/receiving/verifying-payloads/how-manual
// Production should use the official library and the application's durable event store.
export function verifyRawBody(raw, headers, secret, now = Date.now()) {
  const id = headers["svix-id"];
  const timestamp = headers["svix-timestamp"];
  const signatures = headers["svix-signature"];
  if (
    !Buffer.isBuffer(raw) ||
    typeof id !== "string" ||
    !/^[\w-]{1,200}$/.test(id) ||
    typeof timestamp !== "string" ||
    !/^\d{1,12}$/.test(timestamp) ||
    typeof signatures !== "string" ||
    signatures.length > 4096 ||
    !/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret ?? "")
  )
    throw new Error("INVALID_SIGNATURE_INPUT");
  if (Math.abs(now / 1000 - Number(timestamp)) > 300)
    throw new Error("STALE_SIGNATURE");
  const expected = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(`${id}.${timestamp}.`)
    .update(raw)
    .digest();
  const verified = signatures.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value ?? ""))
      return false;
    const candidate = Buffer.from(value, "base64");
    return (
      candidate.length === expected.length &&
      timingSafeEqual(expected, candidate)
    );
  });
  if (!verified) throw new Error("INVALID_SIGNATURE");
  return JSON.parse(raw.toString("utf8"));
}

export async function privateJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
  await rename(temporary, path);
}

export function assertCapturedReplyCallbacks(ledger, config, payload) {
  const expectedThreadId =
    payload?.replyThreadId ??
    payload?.initialRetryThreadId ??
    payload?.threadId;
  if (
    ledger.namespace !== config.namespace ||
    !payload?.replyMessageId ||
    !expectedThreadId
  )
    throw new Error("CAPTURED_REPLY_CONTEXT_REQUIRED");
  const entries = ledger.processed.filter(
    (entry) => !entry.svixId.startsWith("msg_local_"),
  );
  const initialMessageId =
    payload.initialRetryMessageId ??
    payload.initialMessageId ??
    payload.firstAcceptedMessageId;
  if (!entries.length) throw new Error("NO_PROVIDER_CALLBACKS");
  for (const entry of entries) {
    const received = Date.parse(entry.receivedAt);
    if (!Number.isFinite(received)) throw new Error("INVALID_RECEIPT_TIME");
    const event = verifyRawBody(
      Buffer.from(entry.raw, "base64"),
      entry.headers,
      config.secret,
      received,
    );
    const metadata = event.message ?? event.send ?? event.delivery;
    if (
      !["message.sent", "message.delivered", "message.received"].includes(
        event.event_type,
      ) ||
      event.event_id !== entry.eventId ||
      event.event_type !== entry.eventType ||
      entry.svixId !== entry.headers["svix-id"] ||
      !config.inboxIds.includes(metadata?.inbox_id) ||
      ![payload.replyMessageId, initialMessageId]
        .filter(Boolean)
        .includes(metadata?.message_id) ||
      metadata?.thread_id !== expectedThreadId ||
      entry.messageId !== metadata.message_id ||
      entry.threadId !== metadata.thread_id
    )
      throw new Error("CAPTURED_REPLY_BINDING_MISMATCH");
  }
  const replies = entries.filter(
    (entry) => entry.messageId === payload.replyMessageId,
  );
  if (!replies.length) throw new Error("NO_REPLY_CALLBACKS");
  return replies;
}

export function createReceiver(directory) {
  let tail = Promise.resolve();
  return (raw, headers) => {
    const work = tail.then(async () => {
      let config;
      try {
        config = JSON.parse(
          await readFile(join(directory, "webhook-config.json"), "utf8"),
        );
      } catch {
        return { status: 503, outcome: "not_configured" };
      }
      if (
        !Array.isArray(config.inboxIds) ||
        config.inboxIds.length < 1 ||
        config.inboxIds.length > 2 ||
        typeof config.subjectMarker !== "string" ||
        config.subjectMarker.length < 12 ||
        !/^fmat-p0-/.test(config.namespace ?? "")
      )
        return { status: 503, outcome: "invalid_config" };
      let event;
      try {
        event = verifyRawBody(raw, headers, config.secret);
      } catch {
        return { status: 401, outcome: "signature_rejected" };
      }
      const metadata =
        event.event_type === "message.received"
          ? event.message
          : event.event_type === "message.sent"
            ? event.send
            : event.event_type === "message.delivered"
              ? event.delivery
              : undefined;
      const ownedMailbox = (value) => {
        if (typeof value !== "string" || !Array.isArray(config.fixtureEmails))
          return false;
        const text = value.trim();
        const address = text.includes("<")
          ? text.match(/^[^<>]*<([^<>\s]+@[^<>\s]+)>$/)?.[1]
          : text;
        return config.fixtureEmails.includes(address);
      };
      const fixtureContent =
        event.event_type === "message.received"
          ? typeof metadata?.subject === "string" &&
            metadata.subject.includes(config.subjectMarker) &&
            ownedMailbox(metadata.from) &&
            Array.isArray(metadata.to) &&
            metadata.to.length === 1 &&
            ownedMailbox(metadata.to[0])
          : Array.isArray(config.fixtureEmails) &&
            Array.isArray(metadata?.recipients) &&
            metadata.recipients.length === 1 &&
            config.fixtureEmails.includes(metadata.recipients[0]);
      if (
        !metadata ||
        !fixtureContent ||
        !config.inboxIds.includes(metadata.inbox_id) ||
        typeof event.event_id !== "string" ||
        typeof metadata.message_id !== "string"
      )
        return { status: 403, outcome: "outside_fixture_scope" };
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const ledgerPath = join(directory, "webhook-ledger.json");
      let ledger;
      try {
        ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        ledger = {
          namespace: config.namespace,
          processed: [],
          duplicateCount: 0,
        };
      }
      if (ledger.namespace !== config.namespace)
        throw new Error("LEDGER_SCOPE_MISMATCH");
      if (
        ledger.processed.some(
          (e) =>
            e.svixId === headers["svix-id"] || e.eventId === event.event_id,
        )
      ) {
        ledger.duplicateCount++;
        await privateJson(ledgerPath, ledger);
        return { status: 204, outcome: "duplicate_ignored" };
      }
      if (ledger.processed.length >= 6)
        return { status: 429, outcome: "fixture_limit" };
      // Store the raw body before acknowledgment. Only exact task-owned fixture events reach here.
      ledger.processed.push({
        receivedAt: new Date().toISOString(),
        svixId: headers["svix-id"],
        eventId: event.event_id,
        eventType: event.event_type,
        messageId: metadata.message_id,
        inboxId: metadata.inbox_id,
        threadId: metadata.thread_id,
        raw: raw.toString("base64"),
        headers,
      });
      await privateJson(ledgerPath, ledger);
      return { status: 204, outcome: "persisted" };
    });
    tail = work.catch(() => {});
    return work;
  };
}
