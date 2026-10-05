import { createHash, createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertCapturedReplyCallbacks } from "./agentmail-webhook-lib.mjs";

const privateDirectory = resolve(".local/p0-agentmail");
const ledgerPath = `${privateDirectory}/webhook-ledger.json`;
const config = JSON.parse(
  await readFile(`${privateDirectory}/webhook-config.json`, "utf8"),
);
const before = JSON.parse(await readFile(ledgerPath, "utf8"));
const mode = config.inboxIds.length === 1 ? "single-self" : "pair";
const payload = JSON.parse(
  await readFile(`${privateDirectory}/payload-${mode}.json`, "utf8"),
);
const providerEntries = assertCapturedReplyCallbacks(before, config, payload);
const original = providerEntries[0];
const raw = Buffer.from(original.raw, "base64");
async function post(body, headers) {
  // Fixed loopback-only receiver; this script never sends email or calls other applications.
  const response = await fetch("http://127.0.0.1:8789/webhooks", {
    method: "POST",
    body,
    headers,
    signal: AbortSignal.timeout(5000),
  });
  return response.status;
}
function sign(body, id, timestamp) {
  const signature = createHmac(
    "sha256",
    Buffer.from(config.secret.slice(6), "base64"),
  )
    .update(`${id}.${timestamp}.`)
    .update(body)
    .digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": String(timestamp),
    "svix-signature": `v1,${signature}`,
  };
}
const actualReplayFresh =
  Math.abs(Date.now() / 1000 - Number(original.headers["svix-timestamp"])) <=
  300;
const actualReplayStatus = await post(raw, original.headers);
const tamperedStatus = await post(
  Buffer.concat([raw, Buffer.from(" ")]),
  original.headers,
);
const now = Math.floor(Date.now() / 1000);
const staleSyntheticStatus = await post(
  raw,
  sign(raw, "msg_local_stale", now - 600),
);
const duplicateEventSyntheticStatus = await post(
  raw,
  sign(raw, "msg_local_duplicate_event", now),
);
const outside = JSON.parse(raw.toString("utf8"));
const outsideMetadata = outside.message ?? outside.send ?? outside.delivery;
outsideMetadata.inbox_id = "unowned@example.invalid";
outside.event_id = "evt_local_outside";
const outsideRaw = Buffer.from(JSON.stringify(outside));
const outsideScopeSyntheticStatus = await post(
  outsideRaw,
  sign(outsideRaw, "msg_local_outside", now),
);
const after = JSON.parse(await readFile(ledgerPath, "utf8"));
const result = {
  checkedAt: new Date().toISOString(),
  probe: "agentmail-raw-webhook-replay",
  actualProviderCallbackObserved: true,
  actualProviderEventType: original.eventType,
  actualProviderEventTypes: [
    ...new Set(providerEntries.map((entry) => entry.eventType)),
  ],
  actualProviderCallbackCount: providerEntries.length,
  providerEventsMatchedReplyIdentityAndThread: true,
  actualProviderRawBodySha256: createHash("sha256").update(raw).digest("hex"),
  actualProviderReplayWithinTolerance: actualReplayFresh,
  actualProviderReplayStatus: actualReplayStatus,
  tamperedActualProviderBodyStatus: tamperedStatus,
  staleLocallySignedFixtureStatus: staleSyntheticStatus,
  sameEventNewDeliveryLocallySignedFixtureStatus: duplicateEventSyntheticStatus,
  outsideAllowlistLocallySignedFixtureStatus: outsideScopeSyntheticStatus,
  processedCountBefore: before.processed.length,
  processedCountAfter: after.processed.length,
  duplicateCountIncrease: after.duplicateCount - before.duplicateCount,
  newProcessingCausedByReplay:
    after.processed.length !== before.processed.length,
  syntheticTimestampEvidenceIsProviderExpiryEvidence: false,
  distinctIdentityEvidence: config.inboxIds.length === 2,
};
if (
  actualReplayStatus !== (actualReplayFresh ? 204 : 401) ||
  tamperedStatus !== 401 ||
  staleSyntheticStatus !== 401 ||
  duplicateEventSyntheticStatus !== 204 ||
  outsideScopeSyntheticStatus !== 403 ||
  result.newProcessingCausedByReplay
)
  throw new Error("Webhook verification/replay assertions failed");
await writeFile(
  resolve("scripts/p0/agentmail-webhook-results-2026-10-05.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
