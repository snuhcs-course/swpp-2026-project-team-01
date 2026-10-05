#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DistinctProbeError,
  assertDistinctPair,
  assertFrozenPayload,
  assertInsideIdempotencyWindow,
  assertMarkedFixture,
  assertOriginalConfiguration,
  assertRecipient,
  deliveryEvidence,
  hash,
  immutablePayloadHash,
  recipientAddresses,
  senderAddress,
} from "./agentmail-distinct-probe-lib.mjs";
import {
  ROOT,
  assertCliContract,
  fixturePath,
  readDotEnv,
  readPrivateJson,
  runCli,
  writePrivateJson,
} from "./agentmail-probe-lib.mjs";
import { verifyRawBody } from "./agentmail-paired-webhook-lib.mjs";

const PRIVATE_PAYLOAD = path.join(ROOT, ".local/p0-agentmail/distinct-payload.json");
const PRIVATE_RESULT = path.join(ROOT, ".local/p0-agentmail/distinct-result.json");
const PUBLIC_RESULT = path.join(
  ROOT,
  "scripts/p0/agentmail-distinct-probe-results-2026-10-05.json",
);
const INITIAL_TEXT = "Controlled P0 message between two Find Me a Time provider-owned identities.";
const REPLY_TEXT = "Controlled P0 reply using the received parent in the marked fixture inbox.";
const MAX_POLLS = 3;
const POLL_DELAY_MS = 3_000;
const PAIRED_WEBHOOK_DIR = path.join(
  ROOT,
  ".local/p0-agentmail/distinct-paired-webhook",
);

function appCli(args, apiKey, { acceptFailure = false } = {}) {
  const environment = { ...process.env, AGENTMAIL_API_KEY: apiKey };
  const result = spawnSync("agentmail", args, {
    cwd: os.tmpdir(),
    env: environment,
    encoding: "utf8",
    timeout: 55_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (acceptFailure) return result;
  if (result.status !== 0) throw new DistinctProbeError("APPLICATION_CLI_REQUEST_FAILED");
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new DistinctProbeError("APPLICATION_CLI_INVALID_JSON");
  }
}

function listItems(page, property) {
  return Array.isArray(page) ? page : page[property] ?? page.items ?? [];
}

function publicBase(command) {
  return {
    checkedAt: new Date().toISOString(),
    probe: "agentmail-distinct-controlled-identities",
    command,
    cliVersion: "1.8.0",
    providerInboxCreated: false,
    providerResourceDeleted: false,
    paidResourceCreated: false,
    externalHumanAddressUsed: false,
  };
}

function writePublic(value) {
  fs.writeFileSync(PUBLIC_RESULT, `${JSON.stringify(value, null, 2)}\n`);
}

function safeError(error) {
  return {
    status: "blocked",
    code: error instanceof DistinctProbeError ? error.code : "UNEXPECTED_DISTINCT_PROBE_FAILURE",
  };
}

function validateOwnership() {
  const env = readDotEnv();
  assertCliContract();
  const fixtureState = readPrivateJson(fixturePath("single-self"));
  const originalAdmin = runCli([
    "pods", "inboxes", "get", "--pod-id", env.AGENTMAIL_POD_ID,
    "--inbox-id", env.AGENTMAIL_INBOX_ID, "--format", "json",
  ]);
  const fixtureLocal = fixtureState.fixtures?.find((fixture) => fixture.role === "self");
  if (!fixtureLocal) throw new DistinctProbeError("OWNED_FIXTURE_STATE_REQUIRED");
  const fixtureAdmin = runCli([
    "pods", "inboxes", "get", "--pod-id", env.AGENTMAIL_POD_ID,
    "--inbox-id", fixtureLocal.inboxId, "--format", "json",
  ]);
  assertOriginalConfiguration(originalAdmin, {
    inboxId: env.AGENTMAIL_INBOX_ID,
    podId: env.AGENTMAIL_POD_ID,
  });
  assertMarkedFixture(fixtureAdmin, fixtureState);
  assertDistinctPair(originalAdmin, fixtureAdmin, env.AGENTMAIL_POD_ID);

  const originalApp = appCli(
    ["inboxes", "get", "--inbox-id", env.AGENTMAIL_INBOX_ID, "--format", "json"],
    env.AGENTMAIL_API_KEY,
  );
  const fixtureApp = appCli(
    ["inboxes", "get", "--inbox-id", fixtureLocal.inboxId, "--format", "json"],
    env.AGENTMAIL_API_KEY,
  );
  assertOriginalConfiguration(originalApp, {
    inboxId: env.AGENTMAIL_INBOX_ID,
    podId: env.AGENTMAIL_POD_ID,
  });
  assertMarkedFixture(fixtureApp, fixtureState);
  const appPage = appCli(
    ["inboxes", "list", "--limit", "100", "--format", "json"],
    env.AGENTMAIL_API_KEY,
  );
  const visible = listItems(appPage, "inboxes");
  const expectedIds = new Set([originalAdmin.inbox_id, fixtureAdmin.inbox_id]);
  if (
    visible.length !== 2 ||
    visible.some((inbox) => inbox.pod_id !== env.AGENTMAIL_POD_ID || !expectedIds.has(inbox.inbox_id)) ||
    [...expectedIds].some((id) => !visible.some((inbox) => inbox.inbox_id === id))
  ) {
    throw new DistinctProbeError("APPLICATION_KEY_VISIBLE_SET_MISMATCH");
  }
  return { env, original: originalAdmin, fixture: fixtureAdmin, fixtureState };
}

function createPayload(pair) {
  const namespace = `fmat-p0-distinct-${randomBytes(10).toString("hex")}`;
  const startedAt = new Date().toISOString();
  const payload = {
    version: 1,
    namespace,
    subject: `[${namespace}] controlled distinct identity`,
    initialText: INITIAL_TEXT,
    replyText: REPLY_TEXT,
    originalInboxId: pair.original.inbox_id,
    originalEmail: pair.original.email,
    fixtureInboxId: pair.fixture.inbox_id,
    fixtureEmail: pair.fixture.email,
    podId: pair.env.AGENTMAIL_POD_ID,
    initialIdempotencyKey: `fmat-distinct-initial-${randomBytes(20).toString("hex")}`,
    replyIdempotencyKey: `fmat-distinct-reply-${randomBytes(20).toString("hex")}`,
    startedAt,
    policyExpiresAt: new Date(Date.parse(startedAt) + 86_400_000).toISOString(),
  };
  payload.immutableHash = immutablePayloadHash(payload);
  return payload;
}

function loadOrPreparePayload(pair) {
  if (fs.existsSync(PRIVATE_PAYLOAD)) {
    const payload = readPrivateJson(PRIVATE_PAYLOAD);
    assertFrozenPayload(payload);
    if (
      payload.originalInboxId !== pair.original.inbox_id ||
      payload.originalEmail !== pair.original.email ||
      payload.fixtureInboxId !== pair.fixture.inbox_id ||
      payload.fixtureEmail !== pair.fixture.email ||
      payload.podId !== pair.env.AGENTMAIL_POD_ID
    ) {
      throw new DistinctProbeError("PERSISTED_PAIR_MISMATCH");
    }
    return payload;
  }
  const payload = createPayload(pair);
  writePrivateJson(PRIVATE_PAYLOAD, payload);
  return payload;
}

function safePreparedResult(payload) {
  return {
    status: "prepared",
    actualEmailCount: 0,
    confirmedAcceptedEmailCount: 0,
    possiblySentEmailCount: 0,
    sendOutcomeUncertain: false,
    ownershipGuardPassed: true,
    originalProductIdentityVerified: true,
    freshFixtureOwnershipVerified: true,
    distinctInboxIds: true,
    sameConfiguredPod: true,
    applicationKeyVisibleSetExact: true,
    privatePayloadMode0600: (fs.statSync(PRIVATE_PAYLOAD).mode & 0o077) === 0,
    namespaceFingerprint: hash(payload.namespace).slice(0, 16),
    subjectUsesUniqueNamespace: payload.subject.includes(payload.namespace),
    webhookRegisteredByProbe: false,
  };
}

function prepare() {
  const base = publicBase("prepare");
  try {
    const pair = validateOwnership();
    const payload = loadOrPreparePayload(pair);
    assertInsideIdempotencyWindow(payload);
    const result = { ...base, ...safePreparedResult(payload) };
    writePublic(result);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const result = { ...base, ...safeError(error) };
    writePublic(result);
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 2;
  }
}

function conflictStatus(result) {
  return /\b409\b/.test(`${result.stdout}\n${result.stderr}`) ? 409 : undefined;
}

async function pollFreshReceived(payload, apiKey) {
  for (let poll = 1; poll <= MAX_POLLS; poll += 1) {
    const page = appCli([
      "inboxes", "messages", "list", "--inbox-id", payload.fixtureInboxId,
      "--subject", payload.subject, "--from", payload.originalEmail,
      "--after", payload.startedAt, "--limit", "20", "--format", "json",
    ], apiKey);
    const exact = listItems(page, "messages").filter((message) => {
      const recipients = recipientAddresses(message);
      return message.subject === payload.subject &&
        message.inbox_id === payload.fixtureInboxId &&
        senderAddress(message) === payload.originalEmail &&
        recipients.length === 1 && recipients[0] === payload.fixtureEmail &&
        !message.labels?.includes("sent");
    });
    if (exact.length > 1) throw new DistinctProbeError("DUPLICATE_INITIAL_DELIVERY");
    if (exact.length === 1) return { message: exact[0], pollRuns: poll };
    if (poll < MAX_POLLS) await new Promise((resolve) => setTimeout(resolve, POLL_DELAY_MS));
  }
  throw new DistinctProbeError("FRESH_RECEIVED_PARENT_POLL_EXHAUSTED");
}

function recoverFreshReceivedFromSignedCallback(payload) {
  const config = readPrivateJson(path.join(PAIRED_WEBHOOK_DIR, "webhook-config.json"));
  const ledger = readPrivateJson(path.join(PAIRED_WEBHOOK_DIR, "webhook-ledger.json"));
  if (
    config.namespace !== payload.namespace ||
    config.subjectMarker !== payload.subject ||
    JSON.stringify([...config.inboxIds].sort()) !==
      JSON.stringify([payload.originalInboxId, payload.fixtureInboxId].sort())
  ) throw new DistinctProbeError("PAIRED_WEBHOOK_SCOPE_MISMATCH");
  const matches = ledger.processed.flatMap((entry) => {
    if (entry.eventType !== "message.received") return [];
    const event = verifyRawBody(
      Buffer.from(entry.raw, "base64"),
      entry.headers,
      config.secret,
      Date.parse(entry.receivedAt),
    );
    const message = event.message;
    const recipients = recipientAddresses(message);
    return message?.inbox_id === payload.fixtureInboxId &&
      message.subject === payload.subject &&
      senderAddress(message) === payload.originalEmail &&
      recipients.length === 1 && recipients[0] === payload.fixtureEmail
      ? [{ message, pollRuns: MAX_POLLS, source: "verified-signed-webhook" }]
      : [];
  });
  if (matches.length !== 1) {
    throw new DistinctProbeError("SIGNED_RECEIVED_PARENT_NOT_UNIQUE");
  }
  return matches[0];
}

async function run() {
  const base = publicBase("run");
  let payload;
  try {
    const pair = validateOwnership();
    payload = loadOrPreparePayload(pair);
    assertFrozenPayload(payload);
    assertInsideIdempotencyWindow(payload);
    assertRecipient(payload.fixtureEmail, pair.fixture.email);
    assertRecipient(payload.originalEmail, pair.original.email);

    const initialArgs = [
      "inboxes", "messages", "send", "--inbox-id", payload.originalInboxId,
      "--to", payload.fixtureEmail, "--subject", payload.subject,
      "--text", payload.initialText, "--idempotency-key", payload.initialIdempotencyKey,
      "--no-retry", "--format", "json",
    ];
    if (!payload.initialAcceptedMessageId) {
      payload.initialAttemptedAt = new Date().toISOString();
      writePrivateJson(PRIVATE_PAYLOAD, payload);
      const accepted = appCli(initialArgs, pair.env.AGENTMAIL_API_KEY);
      payload.initialAcceptedMessageId = accepted.message_id;
      payload.initialAcceptedThreadId = accepted.thread_id;
      payload.initialAcceptedResponsePrivatelyCaptured = true;
      payload.callerResponseDiscarded = true;
      writePrivateJson(PRIVATE_PAYLOAD, payload);
    }
    if (!payload.initialRetryMessageId) {
      const retry = appCli(initialArgs, pair.env.AGENTMAIL_API_KEY);
      payload.initialRetryMessageId = retry.message_id;
      payload.initialRetryThreadId = retry.thread_id;
      if (
        retry.message_id !== payload.initialAcceptedMessageId ||
        retry.thread_id !== payload.initialAcceptedThreadId
      ) throw new DistinctProbeError("INITIAL_RETRY_ID_MISMATCH");
      writePrivateJson(PRIVATE_PAYLOAD, payload);
    }
    if (payload.initialChangedPayloadStatus !== 409) {
      const changed = appCli(
        initialArgs.map((value) => value === payload.initialText ? `${value} changed` : value),
        pair.env.AGENTMAIL_API_KEY,
        { acceptFailure: true },
      );
      if (changed.status === 0 || conflictStatus(changed) !== 409) {
        throw new DistinctProbeError("CHANGED_PAYLOAD_DID_NOT_RETURN_409");
      }
      payload.initialChangedPayloadStatus = 409;
      writePrivateJson(PRIVATE_PAYLOAD, payload);
    }

    if (!payload.receivedParentMessageId) {
      let received;
      try {
        received = await pollFreshReceived(payload, pair.env.AGENTMAIL_API_KEY);
        received.source = "bounded-cli-poll";
      } catch (error) {
        if (error.code !== "FRESH_RECEIVED_PARENT_POLL_EXHAUSTED") throw error;
        received = recoverFreshReceivedFromSignedCallback(payload);
      }
      payload.receivedParentMessageId = received.message.message_id;
      payload.receivedParentThreadId = received.message.thread_id;
      payload.receivedParentPollRuns = received.pollRuns;
      payload.receivedParentSource = received.source;
      payload.receivedParentNonSent = !received.message.labels?.includes("sent");
      writePrivateJson(PRIVATE_PAYLOAD, payload);
    }

    const replyArgs = [
      "inboxes", "messages", "reply", "--inbox-id", payload.fixtureInboxId,
      "--message-id", payload.receivedParentMessageId, "--to", payload.originalEmail,
      "--text", payload.replyText, "--idempotency-key", payload.replyIdempotencyKey,
      "--no-retry", "--format", "json",
    ];
    if (!payload.replyAcceptedMessageId) {
      payload.replyAttemptedAt = new Date().toISOString();
      writePrivateJson(PRIVATE_PAYLOAD, payload);
      const reply = appCli(replyArgs, pair.env.AGENTMAIL_API_KEY);
      payload.replyAcceptedMessageId = reply.message_id;
      payload.replyAcceptedThreadId = reply.thread_id;
      writePrivateJson(PRIVATE_PAYLOAD, payload);
    }
    if (!payload.replyRetryMessageId) {
      const retry = appCli(replyArgs, pair.env.AGENTMAIL_API_KEY);
      payload.replyRetryMessageId = retry.message_id;
      payload.replyRetryThreadId = retry.thread_id;
      if (
        retry.message_id !== payload.replyAcceptedMessageId ||
        retry.thread_id !== payload.replyAcceptedThreadId
      ) throw new DistinctProbeError("REPLY_RETRY_ID_MISMATCH");
      writePrivateJson(PRIVATE_PAYLOAD, payload);
    }
    if (payload.replyAcceptedThreadId !== payload.receivedParentThreadId) {
      throw new DistinctProbeError("FIXTURE_REPLY_THREAD_MISMATCH");
    }
    const sentReply = appCli([
      "inboxes", "messages", "get", "--inbox-id", payload.fixtureInboxId,
      "--message-id", payload.replyAcceptedMessageId, "--format", "json",
    ], pair.env.AGENTMAIL_API_KEY);
    const replyRecipients = recipientAddresses(sentReply);
    if (
      !sentReply.labels?.includes("sent") ||
      sentReply.thread_id !== payload.receivedParentThreadId ||
      replyRecipients.length !== 1 || replyRecipients[0] !== payload.originalEmail
    ) throw new DistinctProbeError("REPLY_PROVIDER_RECORD_MISMATCH");

    const devExact = appCli([
      "inboxes", "messages", "get", "--inbox-id", payload.originalInboxId,
      "--message-id", payload.replyAcceptedMessageId, "--format", "json",
    ], pair.env.AGENTMAIL_API_KEY, { acceptFailure: true });
    payload.devExactReplyGetAvailable = devExact.status === 0;
    if (payload.devExactReplyGetAvailable) {
      const receivedReply = JSON.parse(devExact.stdout);
      payload.devExactReplyThreadMatched =
        receivedReply.message_id === payload.replyAcceptedMessageId &&
        receivedReply.thread_id === payload.initialAcceptedThreadId;
    }
    payload.completedAt = new Date().toISOString();
    writePrivateJson(PRIVATE_PAYLOAD, payload);

    const result = {
      ...base,
      status: "passed",
      ...deliveryEvidence(payload),
      ownershipGuardPassed: true,
      distinctIdentityEvidence: true,
      originalProductIdentityVerified: true,
      freshFixtureOwnershipVerified: true,
      applicationKeyVisibleSetExact: true,
      initialCallerResponseDiscarded: true,
      initialRetryReturnedSameMessageAndThread: true,
      changedPayloadStatus: 409,
      receivedParentObservedInMarkedFixture: true,
      receivedParentNonSent: payload.receivedParentNonSent,
      receivedParentSource: payload.receivedParentSource,
      replyUsedExactReceivedParent: true,
      replyRetryReturnedSameMessageAndThread: true,
      fixtureInboxReplyStayedInReceivedThread: true,
      originalInboxThreadMatchedByWebhook: false,
      crossInboxThreadEqualityRequired: false,
      devExactReplyGetAvailable: payload.devExactReplyGetAvailable,
      devExactReplyThreadMatched: payload.devExactReplyThreadMatched ?? false,
      freshInboxPollRuns: payload.receivedParentPollRuns,
      freshInboxPollLimit: MAX_POLLS,
      oldDevelopmentInboxListedOrSearched: false,
      idempotencyExpiryActuallyObserved: false,
      webhookEvidencePending: true,
      namespaceFingerprint: hash(payload.namespace).slice(0, 16),
    };
    writePrivateJson(PRIVATE_RESULT, { ...payload, ...result });
    writePublic(result);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const result = {
      ...base,
      ...safeError(error),
      ...deliveryEvidence(payload),
      oldDevelopmentInboxListedOrSearched: false,
      idempotencyExpiryActuallyObserved: false,
    };
    writePublic(result);
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 2;
  }
}

const [command = "help"] = process.argv.slice(2);
if (command === "prepare") prepare();
else if (command === "run") await run();
else {
  console.log(`Usage:
  node scripts/p0/agentmail-distinct-probe.mjs prepare
  node scripts/p0/agentmail-distinct-probe.mjs run`);
  if (command !== "help") process.exitCode = 2;
}
