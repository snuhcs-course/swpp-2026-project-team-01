import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const PRIVATE_DIR = path.join(ROOT, ".local/p0-agentmail");
export const fixturePath = (mode) =>
  path.join(PRIVATE_DIR, `fixtures-${mode}.json`);
export const payloadPath = (mode) =>
  path.join(PRIVATE_DIR, `payload-${mode}.json`);
export const privateResultPath = (mode) =>
  path.join(PRIVATE_DIR, `result-${mode}.json`);
export const PUBLIC_RESULT_PATH = path.join(
  ROOT,
  "scripts/p0/agentmail-probe-results-2026-10-05.json",
);

export const CLI_VERSION = "agentmail 1.8.0";
export const FIXTURE_COUNT = 2;
export const MAX_POLL_RUNS = 3;
export const POLL_DELAY_MS = 3_000;
export const PROBE_SUBJECT = "Find Me a Time P0 controlled AgentMail fixture";
export const PROBE_NAMESPACE = "fmat-p0-agentmail-v1";
export const INITIAL_TEXT =
  "Controlled P0 fixture message. Sender and recipient are dedicated Find Me a Time test inboxes.";
export const REPLY_TEXT =
  "Controlled P0 fixture reply. This reply remains inside the dedicated Find Me a Time test pair.";

export class ProbeError extends Error {
  constructor(code, details = undefined) {
    super(code);
    this.name = "ProbeError";
    this.code = code;
    this.details = details;
  }
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function readDotEnv(envPath = path.join(ROOT, ".env")) {
  const stat = fs.statSync(envPath);
  if ((stat.mode & 0o077) !== 0)
    throw new ProbeError("ENV_PERMISSIONS_MUST_BE_0600");

  const values = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) continue;
    const separator = line.indexOf("=");
    const name = line.slice(0, separator);
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[name] = value;
  }

  for (const name of ["AGENTMAIL_POD_ID", "AGENTMAIL_API_KEY"]) {
    if (!values[name]) throw new ProbeError(`MISSING_${name}`);
  }
  return values;
}

export function ensurePrivateDir() {
  fs.mkdirSync(PRIVATE_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(PRIVATE_DIR, 0o700);
}

export function writePrivateJson(filePath, value) {
  ensurePrivateDir();
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, filePath);
  fs.chmodSync(filePath, 0o600);
}

export function readPrivateJson(filePath) {
  const stat = fs.statSync(filePath);
  if ((stat.mode & 0o077) !== 0)
    throw new ProbeError("PRIVATE_FILE_PERMISSIONS_MUST_BE_0600");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function keychainEnvironment() {
  const environment = { ...process.env };
  delete environment.AGENTMAIL_API_KEY;
  return environment;
}

export function runCli(args, { acceptFailure = false, parseJson = true } = {}) {
  const result = spawnSync("agentmail", args, {
    cwd: os.tmpdir(),
    env: keychainEnvironment(),
    encoding: "utf8",
    timeout: 55_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (!acceptFailure && result.status !== 0) {
    throw new ProbeError("AGENTMAIL_CLI_FAILED", {
      operation: args.slice(0, 3),
      status: result.status,
    });
  }
  if (acceptFailure) return result;
  if (!parseJson) return result.stdout;
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new ProbeError("AGENTMAIL_INVALID_JSON", {
      operation: args.slice(0, 3),
    });
  }
}

export function assertCliContract() {
  const version = execFileSync("agentmail", ["--version"], {
    cwd: os.tmpdir(),
    env: keychainEnvironment(),
    encoding: "utf8",
    timeout: 10_000,
  }).trim();
  if (version !== CLI_VERSION)
    throw new ProbeError("AGENTMAIL_CLI_VERSION_MISMATCH");

  const status = runCli(["auth", "status", "--format", "json"]);
  const bearer = status.schemes?.find(
    (scheme) => scheme.scheme === "BearerAuth",
  );
  const keyringActive = bearer?.sources?.some(
    (source) =>
      source.source === "keyring entry agentmail:BearerAuth" &&
      source.state === "active",
  );
  if (!bearer?.logged_in || !keyringActive)
    throw new ProbeError("AGENTMAIL_KEYCHAIN_AUTH_REQUIRED");

  const sendSchema = runCli(["inboxes", "messages", "send", "--schema"]);
  const replySchema = runCli(["inboxes", "messages", "reply", "--schema"]);
  for (const schema of [sendSchema, replySchema]) {
    const property = schema.input?.properties?.["Idempotency-Key"];
    if (
      property?.location !== "header" ||
      property?.flag !== "--idempotency-key"
    ) {
      throw new ProbeError("AGENTMAIL_IDEMPOTENCY_CONTRACT_MISSING");
    }
  }
  return { version, idempotencyWindowHours: 24 };
}

function itemsFromPage(page, property) {
  if (Array.isArray(page)) return page;
  return page[property] ?? page.items ?? [];
}

export function listAll(resourceArgs, property, limit = 100) {
  const output = [];
  let pageToken;
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const args = [
      ...resourceArgs,
      "--limit",
      String(limit),
      "--format",
      "json",
    ];
    if (pageToken) args.push("--page-token", pageToken);
    const page = runCli(args);
    output.push(...itemsFromPage(page, property));
    pageToken = page.next_page_token;
    if (!pageToken) return output;
  }
  throw new ProbeError("AGENTMAIL_PAGINATION_LIMIT_EXCEEDED");
}

export function assertProvisionCapacity(
  totalInboxCount,
  fixtureCount = FIXTURE_COUNT,
) {
  const maximumAllowedBeforeProvision = 3 - fixtureCount;
  if (totalInboxCount > maximumAllowedBeforeProvision) {
    throw new ProbeError("FREE_PLAN_FIXTURE_CAPACITY_BLOCKED", {
      totalInboxCount,
      requiredNewInboxes: fixtureCount,
      maximumAllowedBeforeProvision,
    });
  }
}

export function newFixtureState(podId, mode = "pair") {
  const ownerToken = randomBytes(32).toString("hex");
  const ownershipFingerprint = sha256(ownerToken);
  const suffix = randomBytes(5).toString("hex");
  return {
    version: 1,
    mode,
    podId,
    ownerToken,
    ownershipFingerprint,
    createdAt: new Date().toISOString(),
    initialIdempotencyKey: `fmat-p0-initial-${randomBytes(18).toString("hex")}`,
    replyIdempotencyKey: `fmat-p0-reply-${randomBytes(18).toString("hex")}`,
    fixtures:
      mode === "single-self"
        ? [
            {
              role: "self",
              username: `fmat-p0-mail-self-${suffix}`,
              clientId: `fmat-p0-${mode}-${suffix}-self`,
              displayName: "Find Me a Time P0 self fixture",
            },
          ]
        : [
            {
              role: "sender",
              username: `fmat-p0-mail-a-${suffix}`,
              clientId: `fmat-p0-${mode}-${suffix}-sender`,
              displayName: "Find Me a Time P0 sender fixture",
            },
            {
              role: "recipient",
              username: `fmat-p0-mail-b-${suffix}`,
              clientId: `fmat-p0-${mode}-${suffix}-recipient`,
              displayName: "Find Me a Time P0 recipient fixture",
            },
          ],
  };
}

export function fixtureMetadata(state, role) {
  return {
    fmat_p0_fixture: true,
    fmat_p0_role: role,
    fmat_p0_owner_sha256: state.ownershipFingerprint,
  };
}

export function assertOwnedFixture(providerInbox, localFixture, state) {
  const expected = fixtureMetadata(state, localFixture.role);
  if (
    !providerInbox ||
    providerInbox.inbox_id !== localFixture.inboxId ||
    providerInbox.pod_id !== state.podId ||
    providerInbox.email !== localFixture.email ||
    (localFixture.clientId &&
      providerInbox.client_id !== localFixture.clientId) ||
    providerInbox.metadata?.fmat_p0_fixture !== expected.fmat_p0_fixture ||
    providerInbox.metadata?.fmat_p0_role !== expected.fmat_p0_role ||
    providerInbox.metadata?.fmat_p0_owner_sha256 !==
      expected.fmat_p0_owner_sha256
  ) {
    throw new ProbeError("FIXTURE_OWNERSHIP_MISMATCH", {
      role: localFixture.role,
    });
  }
}

export function assertFixturePair(state) {
  if (state.mode === "single-self") {
    const fixture = state.fixtures?.find(
      (candidate) => candidate.role === "self",
    );
    if (!fixture?.inboxId || !fixture?.email || state.fixtures.length !== 1) {
      throw new ProbeError("FIXTURE_PAIR_INCOMPLETE");
    }
    return { sender: fixture, recipient: fixture };
  }
  if (state.fixtures?.length !== FIXTURE_COUNT)
    throw new ProbeError("FIXTURE_PAIR_INCOMPLETE");
  const sender = state.fixtures.find((fixture) => fixture.role === "sender");
  const recipient = state.fixtures.find(
    (fixture) => fixture.role === "recipient",
  );
  if (
    !sender?.inboxId ||
    !sender?.email ||
    !recipient?.inboxId ||
    !recipient?.email
  ) {
    throw new ProbeError("FIXTURE_PAIR_INCOMPLETE");
  }
  if (
    sender.email === recipient.email ||
    sender.inboxId === recipient.inboxId
  ) {
    throw new ProbeError("FIXTURE_PAIR_NOT_DISTINCT");
  }
  return { sender, recipient };
}

export function assertControlledRecipient(state, recipientEmail) {
  const { recipient } = assertFixturePair(state);
  if (recipientEmail !== recipient.email)
    throw new ProbeError("EXTERNAL_RECIPIENT_REFUSED");
}

export function assertImmutableSendWindow(payload, expected, now = Date.now()) {
  for (const [key, value] of Object.entries(expected)) {
    if (payload?.[key] !== value)
      throw new ProbeError("IMMUTABLE_PAYLOAD_MISMATCH");
  }
  const started = Date.parse(payload?.startedAt);
  if (!Number.isFinite(started) || started > now)
    throw new ProbeError("INVALID_ORIGINAL_DISPATCH_TIME");
  const expiry = started + 86_400_000;
  if (payload.policyExpiryAt && Date.parse(payload.policyExpiryAt) !== expiry)
    throw new ProbeError("IMMUTABLE_EXPIRY_MISMATCH");
  if (now >= expiry)
    throw new ProbeError("IDEMPOTENCY_WINDOW_EXPIRED_RECONCILIATION_REQUIRED");
  return new Date(expiry).toISOString();
}

export function safeFailure(error) {
  const code =
    error instanceof ProbeError ? error.code : "UNEXPECTED_PROBE_FAILURE";
  const safe = { status: "blocked", code };
  if (code === "FREE_PLAN_FIXTURE_CAPACITY_BLOCKED")
    safe.capacity = error.details;
  return safe;
}

export function deliveryEvidence(payload = {}) {
  const initialConfirmed = Boolean(
    payload.firstAcceptedMessageId ||
    payload.initialRetryMessageId ||
    payload.initialMessageId,
  );
  const replyConfirmed = Boolean(payload.replyMessageId);
  const confirmedAcceptedEmailCount =
    Number(initialConfirmed) + Number(replyConfirmed);
  const initialUncertain =
    Boolean(payload.initialDispatchAttemptedAt) && !initialConfirmed;
  const replyUncertain =
    Boolean(
      payload.sentParentReplyAttemptedAt || payload.replyDispatchAttemptedAt,
    ) && !replyConfirmed;
  const possiblySentEmailCount =
    confirmedAcceptedEmailCount +
    Number(initialUncertain) +
    Number(replyUncertain);
  const sendOutcomeUncertain =
    possiblySentEmailCount !== confirmedAcceptedEmailCount;
  return {
    actualEmailCount: sendOutcomeUncertain
      ? undefined
      : confirmedAcceptedEmailCount,
    confirmedAcceptedEmailCount,
    possiblySentEmailCount,
    sendOutcomeUncertain,
  };
}

export function writePublicResult(result) {
  fs.writeFileSync(PUBLIC_RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`);
}

export async function pollForMessage({
  inboxId,
  subject,
  from,
  after,
  expectedMessageId,
}) {
  for (let run = 1; run <= MAX_POLL_RUNS; run += 1) {
    const args = [
      "inboxes",
      "messages",
      "list",
      "--inbox-id",
      inboxId,
      "--subject",
      subject,
      "--from",
      from,
      "--after",
      after,
      "--limit",
      "20",
      "--format",
      "json",
    ];
    const page = runCli(args);
    const messages = itemsFromPage(page, "messages");
    const message = messages.find(
      (candidate) =>
        candidate.labels?.includes("received") &&
        (!expectedMessageId || candidate.message_id === expectedMessageId),
    );
    if (message) return { message, pollRuns: run };
    if (run < MAX_POLL_RUNS)
      await new Promise((resolve) => setTimeout(resolve, POLL_DELAY_MS));
  }
  throw new ProbeError("MESSAGE_POLL_EXHAUSTED");
}
