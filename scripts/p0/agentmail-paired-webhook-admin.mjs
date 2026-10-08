#!/usr/bin/env node
// AI-generated with Codex, 2026-10-05 (Asia/Seoul).

import fs from "node:fs";
import path from "node:path";
import {
  ROOT,
  assertCliContract,
  readPrivateJson,
  runCli,
  writePrivateJson,
} from "./agentmail-probe-lib.mjs";
import { assertFrozenPayload, hash } from "./agentmail-distinct-probe-lib.mjs";

const privateRoot = path.join(ROOT, ".local/p0-agentmail");
const directory = path.join(privateRoot, "distinct-paired-webhook");
const payloadPath = path.join(privateRoot, "distinct-payload.json");
const tunnelPath = path.join(privateRoot, "distinct-tunnel.json");
const planPath = path.join(privateRoot, "distinct-webhook-plan.json");
const resourcePath = path.join(privateRoot, "distinct-webhook-resource.json");
const cleanupPath = path.join(privateRoot, "distinct-webhook-cleanup.json");
const eventTypes = ["message.received", "message.sent", "message.delivered"];

function listWebhooks() {
  const page = runCli(["webhooks", "list", "--limit", "100", "--format", "json"]);
  return Array.isArray(page) ? page : page.webhooks ?? page.items ?? [];
}

function expectedPlan() {
  const payload = readPrivateJson(payloadPath);
  assertFrozenPayload(payload);
  const tunnel = readPrivateJson(tunnelPath);
  if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(tunnel.url))
    throw new Error("INVALID_DISTINCT_TUNNEL_URL");
  return {
    version: 1,
    clientId: `fmat-p0-paired-${hash(payload.namespace).slice(0, 20)}`,
    namespace: payload.namespace,
    subjectMarker: payload.subject,
    inboxIds: [payload.originalInboxId, payload.fixtureInboxId].sort(),
    fixtureEmails: [payload.originalEmail, payload.fixtureEmail].sort(),
    eventTypes,
    url: `${tunnel.url}/webhooks`,
  };
}

function assertResource(resource, plan) {
  const sorted = (value) => [...(value ?? [])].sort();
  if (
    resource.client_id !== plan.clientId ||
    resource.url !== plan.url ||
    JSON.stringify(sorted(resource.inbox_ids)) !== JSON.stringify(plan.inboxIds) ||
    JSON.stringify(sorted(resource.event_types)) !== JSON.stringify(sorted(plan.eventTypes)) ||
    (resource.pod_ids?.length ?? 0) !== 0
  ) throw new Error("TASK_WEBHOOK_OWNERSHIP_MISMATCH");
}

function setup() {
  assertCliContract();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const plan = expectedPlan();
  if (fs.existsSync(planPath)) {
    const persisted = readPrivateJson(planPath);
    if (JSON.stringify(persisted) !== JSON.stringify(plan)) throw new Error("WEBHOOK_PLAN_CHANGED");
  } else writePrivateJson(planPath, plan);

  const matches = listWebhooks().filter((webhook) => webhook.client_id === plan.clientId);
  if (matches.length > 1) throw new Error("DUPLICATE_TASK_WEBHOOK");
  let resource = matches[0];
  if (!resource) {
    resource = runCli([
      "webhooks", "create", "--client-id", plan.clientId,
      "--url", plan.url, "--event-types", JSON.stringify(plan.eventTypes),
      "--inbox-ids", JSON.stringify(plan.inboxIds), "--no-retry", "--format", "json",
    ]);
  } else {
    resource = runCli(["webhooks", "get", "--webhook-id", resource.webhook_id, "--format", "json"]);
  }
  assertResource(resource, plan);
  if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(resource.secret ?? ""))
    throw new Error("WEBHOOK_SECRET_REQUIRED");
  writePrivateJson(resourcePath, resource);
  writePrivateJson(path.join(directory, "webhook-config.json"), {
    namespace: plan.namespace,
    secret: resource.secret,
    inboxIds: plan.inboxIds,
    fixtureEmails: plan.fixtureEmails,
    subjectMarker: plan.subjectMarker,
  });
  console.log(JSON.stringify({ status: "configured", exactInboxCount: 2, podFilterCount: 0 }));
}

function cleanup() {
  assertCliContract();
  const plan = readPrivateJson(planPath);
  const resource = readPrivateJson(resourcePath);
  const current = runCli(["webhooks", "get", "--webhook-id", resource.webhook_id, "--format", "json"]);
  assertResource(current, plan);
  if (current.webhook_id !== resource.webhook_id) throw new Error("WEBHOOK_ID_MISMATCH");
  runCli(
    ["webhooks", "delete", "--webhook-id", resource.webhook_id, "--format", "json"],
    { parseJson: false },
  );
  const after = runCli(
    ["webhooks", "get", "--webhook-id", resource.webhook_id, "--format", "http"],
    { acceptFailure: true },
  );
  const deletedReadStatus = /\b404\b/.test(`${after.stdout}\n${after.stderr}`) ? 404 : undefined;
  if (deletedReadStatus !== 404) throw new Error("WEBHOOK_DELETE_NOT_VERIFIED");
  writePrivateJson(cleanupPath, {
    cleanedAt: new Date().toISOString(),
    clientId: plan.clientId,
    webhookId: resource.webhook_id,
    deletedReadStatus,
  });
  console.log(JSON.stringify({ status: "deleted", deletedReadStatus }));
}

const [command] = process.argv.slice(2);
if (command === "setup") setup();
else if (command === "cleanup") cleanup();
else {
  console.log("Usage: node scripts/p0/agentmail-paired-webhook-admin.mjs setup|cleanup");
  process.exitCode = 2;
}
