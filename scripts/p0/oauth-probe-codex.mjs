#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { access, chmod, mkdir, open, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readJson, scratch, writePrivateJson } from "./oauth-probe-lib.mjs";
import {
  assertCodexRunReplacementAllowed,
  codexLoginArgs,
  extractCodexFailureEvidence,
  extractCodexMcpEvidence,
} from "./oauth-probe-native-guards.mjs";

process.umask(0o077);

const command = process.argv[2] ?? "help";
const mcpUrl = "http://127.0.0.1:8788/mcp";
const runConfigFile = path.join(scratch, "oauth-native-codex-run.json");
const registryFile = path.join(scratch, "oauth-native-clients.json");
const fixtureFile = path.join(scratch, "fixture-credentials.json");

function processRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function loadRun({ create = false } = {}) {
  const existing = await readJson(runConfigFile);
  if (existing?.name) return existing;
  if (!create) throw new Error("CODEX_NATIVE_RUN_NOT_INITIALIZED");
  const registry = await readJson(registryFile, { clients: [] });
  let name;
  do {
    name = `fmat_p0_native_${randomBytes(5).toString("hex")}`;
  } while (registry.clients?.some((client) => client.name === name));
  const run = {
    version: 1,
    name,
    mcpUrl,
    createdAt: new Date().toISOString(),
  };
  await writePrivateJson(runConfigFile, run);
  return run;
}

async function createFreshRun() {
  const existing = await readJson(runConfigFile);
  const registry = await readJson(registryFile, { clients: [] });
  const priorPid = existing?.loginPidFile
    ? await readJson(existing.loginPidFile)
    : null;
  assertCodexRunReplacementAllowed({
    run: existing,
    registry,
    loginRunning: processRunning(priorPid?.pid),
  });
  let snapshotFile = null;
  if (existing?.name) {
    snapshotFile = path.join(
      scratch,
      `oauth-native-codex-run-snapshot-${existing.name}-${captureName("replaced")}.json`,
    );
    const handle = await open(snapshotFile, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(existing, null, 2)}\n`);
    await handle.close();
    await chmod(snapshotFile, 0o600);
  }
  let name;
  do {
    name = `fmat_p0_native_${randomBytes(5).toString("hex")}`;
  } while (registry.clients?.some((client) => client.name === name));
  const run = {
    version: 1,
    name,
    mcpUrl,
    createdAt: new Date().toISOString(),
    priorRunSnapshot: snapshotFile,
  };
  await writePrivateJson(runConfigFile, run);
  return run;
}

async function updateRun(patch) {
  const run = await loadRun();
  const updated = { ...run, ...patch };
  await writePrivateJson(runConfigFile, updated);
  return updated;
}

function paths(run) {
  return {
    workdir: path.join(
      os.tmpdir(),
      `fmat-p0-native-codex-${process.getuid?.() ?? "user"}-${run.name}`,
    ),
    loginLog: run.loginLog ?? null,
    loginPidFile: run.loginPidFile ?? null,
  };
}

function mcpConfig(run) {
  return `mcp_servers.${run.name}.url=${JSON.stringify(run.mcpUrl)}`;
}

function readOnlyToolConfigs(run) {
  return [
    `mcp_servers.${run.name}.enabled_tools=["diagnostic.read"]`,
    `mcp_servers.${run.name}.tools."diagnostic.read".approval_mode="approve"`,
  ];
}

async function guardName(run, { allowSameClient = true } = {}) {
  const registry = await readJson(registryFile, { clients: [] });
  const client = registry.clients?.find(
    (candidate) => candidate.name === run.name,
  );
  if (
    client &&
    ["pending", "active"].includes(client.status) &&
    (!allowSameClient || (run.clientId && client.clientId !== run.clientId))
  )
    throw new Error("ACTIVE_OR_PENDING_NATIVE_NAME_CONFLICT");
}

async function initialize({ newRun = false } = {}) {
  const run = newRun
    ? await createFreshRun()
    : await loadRun({ create: true });
  await guardName(run);
  return {
    name: run.name,
    mcpUrl: run.mcpUrl,
    runConfigFile: path.relative(process.cwd(), runConfigFile),
    priorRunSnapshot: run.priorRunSnapshot
      ? path.relative(process.cwd(), run.priorRunSnapshot)
      : null,
  };
}

async function startLogin() {
  const run = await loadRun({ create: true });
  await guardName(run, { allowSameClient: false });
  const { workdir } = paths(run);
  await mkdir(workdir, { recursive: true, mode: 0o700 });
  const prior = run.loginPidFile ? await readJson(run.loginPidFile) : null;
  if (processRunning(prior?.pid))
    throw new Error("CODEX_LOGIN_ALREADY_RUNNING");
  if (run.loginLog && (await exists(run.loginLog)))
    await chmod(run.loginLog, 0o600);
  const attempt = captureName("login");
  const loginLog = path.join(
    scratch,
    `codex-native-${run.name}-${attempt}.log`,
  );
  const loginPidFile = path.join(
    scratch,
    `codex-native-${run.name}-${attempt}-pid.json`,
  );
  const handle = await open(loginLog, "wx", 0o600);
  await chmod(loginLog, 0o600);
  const child = spawn(
    "codex",
    codexLoginArgs({ name: run.name, mcpUrl: run.mcpUrl }),
    {
      cwd: workdir,
      detached: true,
      stdio: ["ignore", handle.fd, handle.fd],
    },
  );
  child.unref();
  await handle.close();
  await writePrivateJson(loginPidFile, {
    pid: child.pid,
    name: run.name,
    startedAt: new Date().toISOString(),
  });
  await updateRun({
    codexVersion: installedCodexVersion(),
    loginLog,
    loginPidFile,
    loginStartedAt: new Date().toISOString(),
  });
  return {
    started: true,
    pid: child.pid,
    name: run.name,
    loginLog: path.relative(process.cwd(), loginLog),
  };
}

async function loginStatus() {
  const run = await loadRun();
  const { loginLog, loginPidFile } = paths(run);
  const tracked = loginPidFile ? await readJson(loginPidFile) : null;
  let text = "";
  try {
    if (loginLog) {
      text = await readFile(loginLog, "utf8");
      await chmod(loginLog, 0o600);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return {
    name: run.name,
    running: processRunning(tracked?.pid),
    authorizationPending: /https?:\/\/[^\s]+\/oauth\/authorize\?/.test(text),
    loginSucceeded: text.includes(
      `Successfully logged in to MCP server '${run.name}'`,
    ),
    loginFailed: /error|failed/i.test(
      text.replace(/https?:\/\/[^\s]+/g, "[private-url]"),
    ),
    loginLog: loginLog ? path.relative(process.cwd(), loginLog) : null,
  };
}

async function stopLogin() {
  const run = await loadRun();
  const loginPidFile = paths(run).loginPidFile;
  const tracked = loginPidFile ? await readJson(loginPidFile) : null;
  if (!processRunning(tracked?.pid))
    return { stopped: false, reason: "not-running" };
  process.kill(tracked.pid, "SIGTERM");
  return { stopped: true, pid: tracked.pid };
}

function captureName(phase) {
  return `${phase}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
}

function installedCodexVersion() {
  const result = spawnSync("codex", ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (result.status !== 0) throw new Error("CODEX_VERSION_CHECK_FAILED");
  return result.stdout.trim();
}

async function runExec(phase) {
  if (!/^(allowed|revoked)$/.test(phase))
    throw new Error("PHASE_MUST_BE_ALLOWED_OR_REVOKED");
  const run = await loadRun();
  const { workdir } = paths(run);
  await mkdir(workdir, { recursive: true, mode: 0o700 });
  const capture = captureName(phase);
  const resultFile = path.join(
    scratch,
    `codex-native-${run.name}-exec-${capture}.json`,
  );
  const lastMessageFile = path.join(
    scratch,
    `codex-native-${run.name}-exec-${capture}-last-message.txt`,
  );
  const prompt =
    phase === "allowed"
      ? `Use only the MCP server ${run.name}. Call diagnostic.read exactly once. Do not use shell, filesystem, web, other MCP servers, production resources, personal identities, Calendar, or any other tool. Return only the diagnostic result and stop.`
      : `Use only the MCP server ${run.name}. Attempt diagnostic.read exactly once to verify it is denied after revocation. Do not reauthenticate. Do not use shell, filesystem, web, other MCP servers, production resources, personal identities, Calendar, or any other tool. Return only the denial and stop.`;
  const execution = spawnSync(
    "codex",
    [
      "exec",
      "--ignore-user-config",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--cd",
      workdir,
      "--skip-git-repo-check",
      "--json",
      "--output-last-message",
      lastMessageFile,
      "-c",
      mcpConfig(run),
      ...readOnlyToolConfigs(run).flatMap((config) => ["-c", config]),
      prompt,
    ],
    { cwd: workdir, encoding: "utf8", timeout: 55_000, maxBuffer: 5_000_000 },
  );
  await writePrivateJson(resultFile, {
    phase,
    name: run.name,
    codexVersion: installedCodexVersion(),
    status: execution.status,
    signal: execution.signal,
    timedOut: execution.error?.code === "ETIMEDOUT",
    stdout: execution.stdout ?? "",
    stderr: execution.stderr ?? "",
    capturedAt: new Date().toISOString(),
  });
  try {
    await chmod(lastMessageFile, 0o600);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await updateRun({
    [`${phase}ResultFile`]: resultFile,
    [`${phase}LastMessageFile`]: lastMessageFile,
  });
  return {
    phase,
    name: run.name,
    exitStatus: execution.status,
    signal: execution.signal,
    timedOut: execution.error?.code === "ETIMEDOUT",
    resultFile: path.relative(process.cwd(), resultFile),
    lastMessageFile: path.relative(process.cwd(), lastMessageFile),
  };
}

async function evidence(phase) {
  if (!/^(allowed|revoked)$/.test(phase))
    throw new Error("PHASE_MUST_BE_ALLOWED_OR_REVOKED");
  const run = await loadRun();
  const resultFile = run[`${phase}ResultFile`];
  if (!resultFile) throw new Error("PHASE_EXEC_RESULT_NOT_CAPTURED");
  const capture = await readJson(resultFile);
  const fixture = await readJson(fixtureFile);
  const registry = await readJson(registryFile, { clients: [] });
  const client = registry.clients?.find(
    (candidate) => candidate.name === run.name,
  );
  let sanitizedCalls = [];
  try {
    sanitizedCalls = extractCodexMcpEvidence({
      jsonl: capture.stdout ?? "",
      serverName: run.name,
      clientId: client?.clientId,
      fixtureUserId: fixture?.userId,
    });
  } catch (error) {
    if (
      phase !== "revoked" ||
      error.message !== "ACTUAL_DIAGNOSTIC_MCP_TOOL_CALL_EVENT_NOT_FOUND"
    )
      throw error;
  }
  const allowedToolSucceeded = sanitizedCalls.some(
    (call) =>
      call.itemStatus === "completed" &&
      call.errorCategory === null &&
      call.diagnostic?.issuerMatches === true &&
      call.diagnostic?.audienceMatches === true &&
      call.diagnostic?.grantMatches === true &&
      call.diagnostic?.clientMatches === true &&
      call.diagnostic?.fixtureSubjectMatches === true,
  );
  const allowedApprovalDenied = sanitizedCalls.some(
    (call) => call.errorCategory === "approval_policy_denied",
  );
  if (phase === "allowed" && !allowedToolSucceeded && !allowedApprovalDenied)
    throw new Error("ACTUAL_DIAGNOSTIC_BINDINGS_NOT_PROVEN");
  const failureEvents = extractCodexFailureEvidence(capture.stdout ?? "");
  const revokedToolDenied = sanitizedCalls.some((call) =>
    ["application_grant_denied", "forbidden", "unauthorized"].includes(
      call.errorCategory,
    ),
  );
  return {
    phase,
    name: run.name,
    codexVersion: capture.codexVersion ?? run.codexVersion ?? null,
    execExitStatus: capture.status,
    timedOut: capture.timedOut,
    actualMcpToolCalls: sanitizedCalls,
    structuredFailureEvents: failureEvents,
    allowedOutcome:
      phase === "allowed"
        ? allowedToolSucceeded
          ? "tool_call_succeeded"
          : "approval_policy_denied"
        : null,
    revokedOutcome:
      phase === "revoked"
        ? revokedToolDenied
          ? "tool_call_denied"
          : failureEvents.length > 0
            ? "failed_before_tool_call"
            : "denial_not_proven"
        : null,
    resultFile: path.relative(process.cwd(), resultFile),
  };
}

async function logout() {
  const run = await loadRun();
  const { workdir } = paths(run);
  const result = spawnSync(
    "codex",
    ["mcp", "logout", "-c", mcpConfig(run), run.name],
    { cwd: workdir, encoding: "utf8", timeout: 15_000 },
  );
  const outputFile = path.join(
    scratch,
    `codex-native-${run.name}-logout-${captureName("logout")}.json`,
  );
  await writePrivateJson(outputFile, {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    capturedAt: new Date().toISOString(),
  });
  await updateRun({ logoutResultFile: outputFile });
  return {
    name: run.name,
    exitStatus: result.status,
    credentialsRemoved: /removed|logged out|no credentials/i.test(
      `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    ),
    outputFile: path.relative(process.cwd(), outputFile),
  };
}

try {
  let result;
  if (command === "initialize")
    result = await initialize({ newRun: process.argv.includes("--new-run") });
  else if (command === "start-login") result = await startLogin();
  else if (command === "login-status") result = await loginStatus();
  else if (command === "stop-login") result = await stopLogin();
  else if (command === "exec") result = await runExec(process.argv[3] ?? "");
  else if (command === "evidence")
    result = await evidence(process.argv[3] ?? "");
  else if (command === "logout") result = await logout();
  else {
    console.log(`Usage:
  node scripts/p0/oauth-probe-codex.mjs initialize [--new-run]
  node scripts/p0/oauth-probe-codex.mjs start-login
  node scripts/p0/oauth-probe-codex.mjs login-status
  node scripts/p0/oauth-probe-codex.mjs stop-login
  node scripts/p0/oauth-probe-codex.mjs exec allowed|revoked
  node scripts/p0/oauth-probe-codex.mjs evidence allowed|revoked
  node scripts/p0/oauth-probe-codex.mjs logout`);
    process.exit(command === "help" ? 0 : 2);
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
}
