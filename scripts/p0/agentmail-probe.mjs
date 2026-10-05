#!/usr/bin/env node

import fs from "node:fs";
import {
  INITIAL_TEXT,
  PROBE_NAMESPACE,
  PROBE_SUBJECT,
  REPLY_TEXT,
  ProbeError,
  assertCliContract,
  assertControlledRecipient,
  assertFixturePair,
  assertImmutableSendWindow,
  assertOwnedFixture,
  assertProvisionCapacity,
  deliveryEvidence,
  fixtureMetadata,
  fixturePath,
  listAll,
  newFixtureState,
  pollForMessage,
  payloadPath,
  privateResultPath,
  readDotEnv,
  readPrivateJson,
  runCli,
  safeFailure,
  writePrivateJson,
  writePublicResult,
} from "./agentmail-probe-lib.mjs";

function publicBase(command) {
  return {
    checkedAt: new Date().toISOString(),
    probe: "agentmail-controlled-fixtures",
    command,
    cliVersion: "1.8.0",
    paidResourceCreated: false,
    existingResourceDeleted: false,
    externalHumanAddressUsed: false,
    actualEmailCount: 0,
  };
}

function findConfiguredPod(pods, configuredPodId) {
  const pod = pods.find((candidate) => candidate.pod_id === configuredPodId);
  if (!pod) throw new ProbeError("CONFIGURED_POD_NOT_VISIBLE_TO_OPERATOR");
  if (pod.name !== "Find Me a Time Development") {
    throw new ProbeError("CONFIGURED_POD_NAME_MISMATCH");
  }
  return pod;
}

function validateFixtureState(state, configuredPodId) {
  if (state.podId !== configuredPodId)
    throw new ProbeError("FIXTURE_POD_MISMATCH");
  const { sender, recipient } = assertFixturePair(state);
  for (const fixture of [sender, recipient]) {
    const providerInbox = runCli([
      "pods",
      "inboxes",
      "get",
      "--pod-id",
      configuredPodId,
      "--inbox-id",
      fixture.inboxId,
      "--format",
      "json",
    ]);
    assertOwnedFixture(providerInbox, fixture, state);
  }
  assertControlledRecipient(state, recipient.email);
  return { sender, recipient };
}

function createArguments(state, fixture) {
  return [
    "pods",
    "inboxes",
    "create",
    "--pod-id",
    state.podId,
    "--username",
    fixture.username,
    "--client-id",
    fixture.clientId,
    "--display-name",
    fixture.displayName,
    "--metadata",
    JSON.stringify(fixtureMetadata(state, fixture.role)),
    "--no-retry",
    "--format",
    "json",
  ];
}

function recordCreatedFixture(state, fixture, created, stateFile) {
  fixture.inboxId = created.inbox_id;
  fixture.email = created.email;
  fixture.createdAt = created.created_at;
  writePrivateJson(stateFile, state);
}

function completeProvisioning(state, stateFile) {
  const initiallyMissing = state.fixtures.filter((fixture) => !fixture.inboxId);
  if (initiallyMissing.some((fixture) => !fixture.clientId)) {
    throw new ProbeError("PARTIAL_FIXTURE_CLIENT_ID_REQUIRED");
  }
  if (initiallyMissing.length === 0) return;

  const podInboxes = listAll(
    ["pods", "inboxes", "list", "--pod-id", state.podId],
    "inboxes",
  );
  for (const fixture of initiallyMissing) {
    const recovered = podInboxes.filter(
      (inbox) => inbox.client_id === fixture.clientId,
    );
    if (recovered.length > 1)
      throw new ProbeError("DUPLICATE_FIXTURE_CLIENT_ID");
    if (recovered.length === 1) {
      recordCreatedFixture(state, fixture, recovered[0], stateFile);
      assertOwnedFixture(recovered[0], fixture, state);
    }
  }

  const trulyMissing = state.fixtures.filter((fixture) => !fixture.inboxId);
  if (trulyMissing.length === 0) return;
  const globalInboxes = listAll(["inboxes", "list"], "inboxes");
  if (globalInboxes.length + trulyMissing.length > 3) {
    throw new ProbeError("FREE_PLAN_FIXTURE_CAPACITY_BLOCKED", {
      totalInboxCount: globalInboxes.length,
      requiredNewInboxes: trulyMissing.length,
      maximumAllowedBeforeProvision: 3 - trulyMissing.length,
    });
  }

  for (const fixture of trulyMissing) {
    const args = createArguments(state, fixture);
    let created;
    try {
      created = runCli(args);
    } catch (firstError) {
      try {
        created = runCli(args);
      } catch {
        const afterUnknownOutcome = listAll(
          ["pods", "inboxes", "list", "--pod-id", state.podId],
          "inboxes",
        ).filter((inbox) => inbox.client_id === fixture.clientId);
        if (afterUnknownOutcome.length !== 1) throw firstError;
        [created] = afterUnknownOutcome;
      }
    }
    recordCreatedFixture(state, fixture, created, stateFile);
    assertOwnedFixture(created, fixture, state);
  }
}

function prepare(mode = "pair") {
  const publicResult = publicBase("prepare");
  try {
    const env = readDotEnv();
    const cli = assertCliContract();
    const pods = listAll(["pods", "list"], "pods");
    findConfiguredPod(pods, env.AGENTMAIL_POD_ID);

    const stateFile = fixturePath(mode);
    const requestedFixtureCount = mode === "single-self" ? 1 : 2;
    if (fs.existsSync(stateFile)) {
      const state = readPrivateJson(stateFile);
      completeProvisioning(state, stateFile);
      validateFixtureState(state, env.AGENTMAIL_POD_ID);
      const result = {
        ...publicResult,
        status: "prepared",
        fixtureMode: mode,
        fixtureCount: requestedFixtureCount,
        ownershipFingerprint: state.ownershipFingerprint,
        ownershipGuardPassed: true,
        sendExecuted: false,
        namespace: PROBE_NAMESPACE,
        subjectMarker: PROBE_SUBJECT,
        distinctIdentityEvidence: mode !== "single-self",
        task2_4Complete: false,
        deterministicCreationRecovery: state.fixtures.every((fixture) =>
          Boolean(fixture.clientId),
        )
          ? "client-id"
          : "unavailable-for-already-created-fixture",
        idempotencyWindowPolicyHours: cli.idempotencyWindowHours,
        idempotencyExpiryActuallyObserved: false,
      };
      writePublicResult(result);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const inboxes = listAll(["inboxes", "list"], "inboxes");
    assertProvisionCapacity(inboxes.length, requestedFixtureCount);

    const state = newFixtureState(env.AGENTMAIL_POD_ID, mode);
    state.preflightTotalInboxCount = inboxes.length;
    state.provisioningStartedAt = new Date().toISOString();
    writePrivateJson(stateFile, state);

    completeProvisioning(state, stateFile);

    validateFixtureState(state, env.AGENTMAIL_POD_ID);
    state.preparedAt = new Date().toISOString();
    writePrivateJson(stateFile, state);
    const result = {
      ...publicResult,
      status: "prepared",
      preflightTotalInboxCount: inboxes.length,
      fixtureMode: mode,
      fixtureCount: requestedFixtureCount,
      ownershipFingerprint: state.ownershipFingerprint,
      ownershipGuardPassed: true,
      sendExecuted: false,
      namespace: PROBE_NAMESPACE,
      subjectMarker: PROBE_SUBJECT,
      distinctIdentityEvidence: mode !== "single-self",
      task2_4Complete: false,
      deterministicCreationRecovery: "client-id",
      idempotencyWindowPolicyHours: cli.idempotencyWindowHours,
      idempotencyExpiryActuallyObserved: false,
    };
    writePublicResult(result);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const result = {
      ...publicResult,
      ...safeFailure(error),
      sendExecuted: false,
    };
    writePublicResult(result);
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 2;
  }
}

function extractConflictStatus(result) {
  const combined = `${result.stdout}\n${result.stderr}`;
  return /\b409\b/.test(combined) ? 409 : undefined;
}

async function send(expectedFingerprint, mode = "pair") {
  const publicResult = publicBase("send");
  let payload;
  try {
    const env = readDotEnv();
    const cli = assertCliContract();
    const state = readPrivateJson(fixturePath(mode));
    if (
      !expectedFingerprint ||
      expectedFingerprint !== state.ownershipFingerprint
    ) {
      throw new ProbeError("REVIEWED_OWNERSHIP_FINGERPRINT_REQUIRED");
    }
    const { sender, recipient } = validateFixtureState(
      state,
      env.AGENTMAIL_POD_ID,
    );
    assertControlledRecipient(state, recipient.email);
    const privatePayloadPath = payloadPath(mode);
    if (fs.existsSync(privatePayloadPath)) {
      payload = readPrivateJson(privatePayloadPath);
    } else {
      payload = {
        version: 2,
        senderInboxId: sender.inboxId,
        recipientInboxId: recipient.inboxId,
        recipientEmail: recipient.email,
        subject: PROBE_SUBJECT,
        text: INITIAL_TEXT,
        initialIdempotencyKey: state.initialIdempotencyKey,
        replyIdempotencyKey: state.replyIdempotencyKey,
        startedAt: new Date().toISOString(),
      };
      payload.policyExpiryAt = new Date(
        Date.parse(payload.startedAt) + 86_400_000,
      ).toISOString();
      writePrivateJson(privatePayloadPath, payload);
    }
    const expected = {
      senderInboxId: sender.inboxId,
      recipientInboxId: recipient.inboxId,
      recipientEmail: recipient.email,
      subject: PROBE_SUBJECT,
      text: INITIAL_TEXT,
      initialIdempotencyKey: state.initialIdempotencyKey,
      replyIdempotencyKey: state.replyIdempotencyKey,
    };
    assertImmutableSendWindow(payload, expected);

    const sendArgs = [
      "inboxes",
      "messages",
      "send",
      "--inbox-id",
      sender.inboxId,
      "--to",
      recipient.email,
      "--subject",
      payload.subject,
      "--text",
      payload.text,
      "--idempotency-key",
      payload.initialIdempotencyKey,
      "--no-retry",
      "--format",
      "json",
    ];
    let retried;
    if (payload.initialRetryMessageId || payload.initialMessageId) {
      retried = {
        message_id: payload.initialRetryMessageId ?? payload.initialMessageId,
        thread_id: payload.initialRetryThreadId ?? payload.threadId,
      };
      payload.initialDispatchAttemptedAt ??= payload.startedAt;
      payload.initialRetryMessageId = retried.message_id;
      payload.initialRetryThreadId = retried.thread_id;
      payload.firstAcceptedResponseCaptured ??= false;
      writePrivateJson(privatePayloadPath, payload);
    } else {
      payload.initialDispatchAttemptedAt = new Date().toISOString();
      writePrivateJson(privatePayloadPath, payload);
      const first = runCli(sendArgs);
      payload.firstAcceptedMessageId = first.message_id;
      payload.firstAcceptedThreadId = first.thread_id;
      payload.firstAcceptedResponseCaptured = true;
      writePrivateJson(privatePayloadPath, payload);
      retried = runCli(sendArgs);
      payload.initialRetryMessageId = retried.message_id;
      payload.initialRetryThreadId = retried.thread_id;
      if (
        first.message_id !== retried.message_id ||
        first.thread_id !== retried.thread_id
      ) {
        throw new ProbeError("IDEMPOTENT_RETRY_ID_MISMATCH");
      }
      writePrivateJson(privatePayloadPath, payload);
    }

    if (payload.changedPayloadStatus !== 409) {
      const conflict = runCli(
        sendArgs.map((value) =>
          value === INITIAL_TEXT ? `${INITIAL_TEXT} Changed payload.` : value,
        ),
        { acceptFailure: true },
      );
      if (conflict.status === 0 || extractConflictStatus(conflict) !== 409) {
        throw new ProbeError("CHANGED_PAYLOAD_DID_NOT_RETURN_409");
      }
      payload.changedPayloadStatus = 409;
      payload.changedPayloadVerifiedAt = new Date().toISOString();
      writePrivateJson(privatePayloadPath, payload);
    }

    const received = await pollForMessage({
      inboxId: recipient.inboxId,
      subject: payload.subject,
      from: sender.email,
      after: payload.startedAt,
    });
    if (!received.message.labels?.includes("received")) {
      throw new ProbeError("RECEIVED_PARENT_LABEL_REQUIRED");
    }
    payload.receivedParentMessageId = received.message.message_id;
    writePrivateJson(privatePayloadPath, payload);
    const replyArgs = [
      "inboxes",
      "messages",
      "reply",
      "--inbox-id",
      recipient.inboxId,
      "--message-id",
      payload.receivedParentMessageId,
      "--to",
      sender.email,
      "--text",
      REPLY_TEXT,
      "--idempotency-key",
      payload.replyIdempotencyKey,
      "--no-retry",
      "--format",
      "json",
    ];
    payload.replyDispatchAttemptedAt ??= new Date().toISOString();
    writePrivateJson(privatePayloadPath, payload);
    const reply = payload.replyMessageId
      ? { message_id: payload.replyMessageId, thread_id: payload.replyThreadId }
      : runCli(replyArgs);
    payload.replyMessageId = reply.message_id;
    payload.replyThreadId = reply.thread_id;
    writePrivateJson(privatePayloadPath, payload);
    const replyRetry = runCli(replyArgs);
    if (
      reply.message_id !== replyRetry.message_id ||
      reply.thread_id !== replyRetry.thread_id
    ) {
      throw new ProbeError("REPLY_IDEMPOTENT_RETRY_ID_MISMATCH");
    }
    payload.replyMessageId = reply.message_id;
    payload.replyThreadId = reply.thread_id;
    payload.completedAt = new Date().toISOString();
    writePrivateJson(privatePayloadPath, payload);
    if (retried.thread_id !== reply.thread_id)
      throw new ProbeError("REPLY_THREAD_MISMATCH");
    const returned = await pollForMessage({
      inboxId: sender.inboxId,
      subject: payload.subject,
      from: recipient.email,
      after: payload.startedAt,
      expectedMessageId: reply.message_id,
    });
    if (
      !returned.message.labels?.includes("received") ||
      returned.message.thread_id !== reply.thread_id
    )
      throw new ProbeError("RECEIVED_REPLY_NOT_VERIFIED");

    const result = {
      ...publicResult,
      status: "passed",
      actualEmailCount: 2,
      fixtureMode: mode,
      confirmedAcceptedEmailCount: 2,
      possiblySentEmailCount: 2,
      sendOutcomeUncertain: false,
      ownershipGuardPassed: true,
      identicalRetryReturnedOriginalMessage:
        payload.firstAcceptedResponseCaptured,
      changedPayloadStatus: 409,
      replyUsedReceivedParentMessageId: true,
      replyStayedInOriginalThread: true,
      distinctIdentityEvidence: mode !== "single-self",
      task2_4Complete: false,
      idempotencyWindowPolicyHours: cli.idempotencyWindowHours,
      idempotencyExpiryActuallyObserved: false,
    };
    writePrivateJson(privateResultPath(mode), { ...payload, ...result });
    writePublicResult(result);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const delivery = deliveryEvidence(payload);
    const result = {
      ...publicResult,
      ...safeFailure(error),
      ...delivery,
      partialEvidence:
        delivery.confirmedAcceptedEmailCount > 0 ||
        delivery.possiblySentEmailCount > 0,
      changedPayloadStatus: payload?.changedPayloadStatus,
      firstAcceptedResponseCaptured:
        payload?.firstAcceptedResponseCaptured ?? false,
      idempotencyExpiryActuallyObserved: false,
    };
    writePublicResult(result);
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 2;
  }
}

function recipientsOf(message) {
  return (Array.isArray(message.to) ? message.to : [message.to])
    .filter(Boolean)
    .map((recipient) =>
      typeof recipient === "string"
        ? recipient
        : (recipient.email ?? recipient.address),
    );
}

function replySingleSent(expectedFingerprint) {
  const publicResult = publicBase("reply-single-sent");
  let payload;
  try {
    const env = readDotEnv();
    assertCliContract();
    const state = readPrivateJson(fixturePath("single-self"));
    if (
      !expectedFingerprint ||
      expectedFingerprint !== state.ownershipFingerprint
    ) {
      throw new ProbeError("REVIEWED_OWNERSHIP_FINGERPRINT_REQUIRED");
    }
    const { sender } = validateFixtureState(state, env.AGENTMAIL_POD_ID);
    assertControlledRecipient(state, sender.email);
    const privatePayloadPath = payloadPath("single-self");
    payload = readPrivateJson(privatePayloadPath);
    const initialMessageId =
      payload.initialRetryMessageId ?? payload.initialMessageId;
    const initialThreadId = payload.initialRetryThreadId ?? payload.threadId;
    if (!initialMessageId || !initialThreadId)
      throw new ProbeError("INITIAL_SEND_EVIDENCE_REQUIRED");
    const expiry = assertImmutableSendWindow(payload, {
      senderInboxId: sender.inboxId,
      recipientInboxId: sender.inboxId,
      recipientEmail: sender.email,
      subject: PROBE_SUBJECT,
      text: INITIAL_TEXT,
      initialIdempotencyKey: state.initialIdempotencyKey,
      replyIdempotencyKey: state.replyIdempotencyKey,
    });
    const parent = runCli([
      "inboxes",
      "messages",
      "get",
      "--inbox-id",
      sender.inboxId,
      "--message-id",
      initialMessageId,
      "--format",
      "json",
    ]);
    if (
      !parent.labels?.includes("sent") ||
      parent.labels?.includes("received")
    ) {
      throw new ProbeError("EXACT_SENT_ONLY_PARENT_REQUIRED");
    }
    if (
      parent.thread_id !== initialThreadId ||
      parent.subject !== payload.subject
    ) {
      throw new ProbeError("SENT_PARENT_MISMATCH");
    }
    const recipients = recipientsOf(parent);
    if (recipients.length !== 1 || recipients[0] !== sender.email) {
      throw new ProbeError("EXACT_SELF_RECIPIENT_REQUIRED");
    }

    const replyArgs = [
      "inboxes",
      "messages",
      "reply",
      "--inbox-id",
      sender.inboxId,
      "--message-id",
      initialMessageId,
      "--to",
      sender.email,
      "--text",
      REPLY_TEXT,
      "--idempotency-key",
      payload.replyIdempotencyKey,
      "--no-retry",
      "--format",
      "json",
    ];
    let reply;
    if (payload.replyMessageId) {
      reply = {
        message_id: payload.replyMessageId,
        thread_id: payload.replyThreadId,
      };
      if (payload.replyRetryMatched !== true) {
        const retry = runCli(replyArgs);
        if (
          retry.message_id !== reply.message_id ||
          retry.thread_id !== reply.thread_id
        )
          throw new ProbeError("REPLY_IDEMPOTENT_RETRY_ID_MISMATCH");
        payload.replyRetryMatched = true;
        writePrivateJson(privatePayloadPath, payload);
      }
    } else {
      payload.sentParentReplyAttemptedAt = new Date().toISOString();
      writePrivateJson(privatePayloadPath, payload);
      const first = runCli(replyArgs);
      payload.replyMessageId = first.message_id;
      payload.replyThreadId = first.thread_id;
      payload.replyFirstResponseCaptured = true;
      writePrivateJson(privatePayloadPath, payload);
      const retry = runCli(replyArgs);
      if (
        first.message_id !== retry.message_id ||
        first.thread_id !== retry.thread_id
      ) {
        throw new ProbeError("REPLY_IDEMPOTENT_RETRY_ID_MISMATCH");
      }
      reply = first;
      payload.replyRetryMatched = true;
      writePrivateJson(privatePayloadPath, payload);
    }
    if (reply.thread_id !== initialThreadId)
      throw new ProbeError("REPLY_THREAD_MISMATCH");
    const providerReply = runCli([
      "inboxes",
      "messages",
      "get",
      "--inbox-id",
      sender.inboxId,
      "--message-id",
      reply.message_id,
      "--format",
      "json",
    ]);
    const replyRecipients = recipientsOf(providerReply);
    if (
      providerReply.message_id !== reply.message_id ||
      providerReply.thread_id !== initialThreadId ||
      !providerReply.labels?.includes("sent") ||
      replyRecipients.length !== 1 ||
      replyRecipients[0] !== sender.email
    ) {
      throw new ProbeError("REPLY_EXACT_SELF_RECIPIENT_NOT_PROVED");
    }
    payload.completedAt = new Date().toISOString();
    payload.policyExpiryAt = expiry;
    writePrivateJson(privatePayloadPath, payload);
    const result = {
      ...publicResult,
      status: "partial",
      actualEmailCount: 2,
      confirmedAcceptedEmailCount: 2,
      possiblySentEmailCount: 2,
      sendOutcomeUncertain: false,
      fixtureMode: "single-self",
      ownershipGuardPassed: true,
      initialProviderRecordVerified: true,
      initialLabel: "sent",
      receivedParentObserved: false,
      replyParentLabel: "sent",
      replyExactSelfRecipient: true,
      replyRetryReturnedSameMessageAndThread:
        payload.replyRetryMatched === true,
      replyStayedInOriginalThread: true,
      changedPayloadStatus: payload.changedPayloadStatus,
      distinctIdentityEvidence: false,
      task2_4Complete: false,
      pairPreparation:
        state.preflightTotalInboxCount > 1
          ? {
              status: "blocked",
              code: "FREE_PLAN_FIXTURE_CAPACITY_BLOCKED",
              preflightTotalInboxCount: state.preflightTotalInboxCount,
              requiredNewInboxes: 2,
            }
          : undefined,
      idempotencyExpiryActuallyObserved: false,
      webhookEvidence: {
        resultFile: "scripts/p0/agentmail-webhook-results-2026-10-05.json",
      },
      limitation:
        "Self-send produced sent-only provider records; no received-parent or distinct-identity evidence was observed.",
    };
    writePrivateJson(privateResultPath("single-self"), {
      ...payload,
      ...result,
    });
    writePublicResult(result);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const delivery = deliveryEvidence(payload);
    const result = {
      ...publicResult,
      ...safeFailure(error),
      ...delivery,
      partialEvidence:
        delivery.confirmedAcceptedEmailCount > 0 ||
        delivery.possiblySentEmailCount > 0,
      idempotencyExpiryActuallyObserved: false,
    };
    writePublicResult(result);
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 2;
  }
}

const [command = "help", fingerprint] = process.argv.slice(2);
if (command === "prepare") prepare("pair");
else if (command === "prepare-single") prepare("single-self");
else if (command === "send") await send(fingerprint, "pair");
else if (command === "send-single") await send(fingerprint, "single-self");
else if (command === "reply-single-sent") replySingleSent(fingerprint);
else {
  console.log(`Usage:
  node scripts/p0/agentmail-probe.mjs prepare
  node scripts/p0/agentmail-probe.mjs prepare-single
  node scripts/p0/agentmail-probe.mjs send <reviewed-ownership-fingerprint>
  node scripts/p0/agentmail-probe.mjs send-single <reviewed-ownership-fingerprint>
  node scripts/p0/agentmail-probe.mjs reply-single-sent <reviewed-ownership-fingerprint>`);
  if (command !== "help") process.exitCode = 2;
}
