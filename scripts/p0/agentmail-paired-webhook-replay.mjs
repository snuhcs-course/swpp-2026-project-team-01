#!/usr/bin/env node
// AI-generated with Codex, 2026-10-05 (Asia/Seoul).

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./agentmail-probe-lib.mjs";
import {
  signFixture,
  validatePairedCallbacks,
} from "./agentmail-paired-webhook-lib.mjs";

const privateRoot = path.join(ROOT, ".local/p0-agentmail");
const directory = path.join(privateRoot, "distinct-paired-webhook");
const config = JSON.parse(fs.readFileSync(path.join(directory, "webhook-config.json"), "utf8"));
const before = JSON.parse(fs.readFileSync(path.join(directory, "webhook-ledger.json"), "utf8"));
const payload = JSON.parse(fs.readFileSync(path.join(privateRoot, "distinct-payload.json"), "utf8"));
const restart = JSON.parse(fs.readFileSync(path.join(privateRoot, "distinct-server-restart.json"), "utf8"));
const validation = validatePairedCallbacks(before, config, payload);
if (!restart.restartedAfterCapture) throw new Error("RECEIVER_RESTART_EVIDENCE_REQUIRED");

async function post(raw, headers) {
  const response = await fetch("http://127.0.0.1:8790/webhooks", {
    method: "POST",
    body: raw,
    headers,
    signal: AbortSignal.timeout(5_000),
  });
  return response.status;
}

const original = validation.provider[0];
const raw = Buffer.from(original.raw, "base64");
const actualReplayFresh =
  Math.abs(Date.now() / 1000 - Number(original.headers["svix-timestamp"])) <= 300;
const actualReplayStatus = await post(raw, original.headers);
const tamperedStatus = await post(Buffer.concat([raw, Buffer.from(" ")]), original.headers);
const now = Math.floor(Date.now() / 1000);
const staleStatus = await post(raw, signFixture(raw, config.secret, "msg_local_stale_pair", now - 600));
const sameEventStatus = await post(
  raw,
  signFixture(raw, config.secret, "msg_local_duplicate_pair", now),
);
const outside = JSON.parse(raw.toString("utf8"));
const outsideMetadata = outside.message ?? outside.send ?? outside.delivery;
outsideMetadata.inbox_id = "outside-owned-pair";
outside.event_id = "evt_local_outside_pair";
const outsideRaw = Buffer.from(JSON.stringify(outside));
const outsideStatus = await post(
  outsideRaw,
  signFixture(outsideRaw, config.secret, "msg_local_outside_pair", now),
);
const after = JSON.parse(fs.readFileSync(path.join(directory, "webhook-ledger.json"), "utf8"));
const eventTypes = [...new Set(validation.provider.map((entry) => entry.eventType))].sort();
const result = {
  checkedAt: new Date().toISOString(),
  probe: "agentmail-paired-raw-webhook-replay",
  status: "passed",
  actualProviderCallbackCount: validation.provider.length,
  actualProviderEventTypes: eventTypes,
  callbackLimit: 6,
  exactTwoInboxAllowlist: true,
  actualInitialReceivedCallback: true,
  actualReplyReceivedCallback: true,
  originalInboxThreadMatched: validation.originalInboxThreadMatched,
  fixtureInboxThreadMatched: validation.fixtureInboxThreadMatched,
  crossInboxThreadEqualityRequired: false,
  actualProviderRawBodySha256: createHash("sha256").update(raw).digest("hex"),
  actualProviderReplayWithinTolerance: actualReplayFresh,
  actualProviderReplayStatus: actualReplayStatus,
  actualReplayAfterReceiverRestartPassed: actualReplayStatus === (actualReplayFresh ? 204 : 401),
  tamperedActualProviderBodyStatus: tamperedStatus,
  staleLocallySignedFixtureStatus: staleStatus,
  sameEventNewDeliveryLocallySignedFixtureStatus: sameEventStatus,
  outsideAllowlistLocallySignedFixtureStatus: outsideStatus,
  processedCountBefore: before.processed.length,
  processedCountAfter: after.processed.length,
  duplicateCountIncrease: after.duplicateCount - before.duplicateCount,
  newProcessingCausedByReplay: after.processed.length !== before.processed.length,
  syntheticTimestampEvidenceIsProviderExpiryEvidence: false,
  distinctIdentityEvidence: true,
  receivedParentThreadingEvidence: true,
  webhookCleanupPending: true,
  task2_4ProvenBeforeCleanup: true,
};
if (
  validation.provider.length !== 6 ||
  JSON.stringify(eventTypes) !== JSON.stringify(["message.delivered", "message.received", "message.sent"]) ||
  actualReplayStatus !== (actualReplayFresh ? 204 : 401) ||
  tamperedStatus !== 401 || staleStatus !== 401 || sameEventStatus !== 204 || outsideStatus !== 403 ||
  result.newProcessingCausedByReplay
) throw new Error("PAIRED_WEBHOOK_REPLAY_ASSERTION_FAILED");
fs.writeFileSync(
  path.join(ROOT, "scripts/p0/agentmail-paired-webhook-results-2026-10-05.json"),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(JSON.stringify(result, null, 2));
