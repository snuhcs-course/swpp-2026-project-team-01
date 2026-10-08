#!/usr/bin/env node
// AI-generated with Codex, 2026-10-05 (Asia/Seoul).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT, readPrivateJson } from "./agentmail-probe-lib.mjs";

const privateRoot = path.join(ROOT, ".local/p0-agentmail");
const cleanup = readPrivateJson(path.join(privateRoot, "distinct-webhook-cleanup.json"));
const resultPath = path.join(
  ROOT,
  "scripts/p0/agentmail-paired-webhook-results-2026-10-05.json",
);
const distinctResultPath = path.join(
  ROOT,
  "scripts/p0/agentmail-distinct-probe-results-2026-10-05.json",
);
const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
const distinct = JSON.parse(fs.readFileSync(distinctResultPath, "utf8"));

let receiverStopped = false;
try {
  await fetch("http://127.0.0.1:8790/health", { signal: AbortSignal.timeout(1_000) });
} catch {
  receiverStopped = true;
}
const tunnelCheck = spawnSync("pgrep", [
  "-f",
  "cloudflared tunnel --url http://127.0.0.1:8790",
], { encoding: "utf8", timeout: 2_000 });
const tunnelStopped = tunnelCheck.status === 1;
if (
  cleanup.deletedReadStatus !== 404 ||
  !receiverStopped ||
  !tunnelStopped ||
  result.status !== "passed" ||
  !result.task2_4ProvenBeforeCleanup ||
  distinct.status !== "passed" ||
  distinct.confirmedAcceptedEmailCount !== 2
) throw new Error("PAIRED_PROBE_FINALIZATION_INCOMPLETE");

const final = {
  ...result,
  checkedAt: new Date().toISOString(),
  webhookCleanupPending: false,
  taskOwnedWebhookDeleted: true,
  deletedWebhookReadStatus: cleanup.deletedReadStatus,
  receiverStopped,
  temporaryTunnelStopped: tunnelStopped,
  task2_4Proven: true,
};
fs.writeFileSync(resultPath, `${JSON.stringify(final, null, 2)}\n`);
fs.writeFileSync(distinctResultPath, `${JSON.stringify({
  ...distinct,
  webhookEvidencePending: false,
  pairedWebhookEvidencePassed: true,
  actualSignedProviderCallbackCount: final.actualProviderCallbackCount,
  originalInboxThreadMatchedByWebhook: final.originalInboxThreadMatched,
  fixtureInboxThreadMatchedByWebhook: final.fixtureInboxThreadMatched,
  pairedWebhookResultsPath:
    "scripts/p0/agentmail-paired-webhook-results-2026-10-05.json",
  task2_4Proven: true,
}, null, 2)}\n`);
console.log(JSON.stringify(final, null, 2));
