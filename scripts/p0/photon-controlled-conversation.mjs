#!/usr/bin/env node

// Bounded, explicitly authorized P0 diagnostic. Default mode sends nothing.
// Never remove the private intent to retry an uncertain dispatch.
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const privateRoot = resolve(root, ".local/live-calendar-test");
const dependencyRoot = resolve(
  root,
  ".local/photon-transport-probe/node_modules",
);
const intentPath = resolve(
  privateRoot,
  "photon-controlled-dispatch-intent.json",
);
const projectIdExpected = "3244ea18-c2c1-4727-80d4-7d7ea4d091ef";
const text = "Find Me a Time test: please reply TEST RECEIVED";
const expectedReply = "TEST RECEIVED";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const start = Date.now();
const runId = randomUUID();
const deadline = start + 43_000;
let app;
let client;
let stream;
let intent;
let targetHash;
let dispatchStarted = false;
const result = {
  checked_at: new Date(start).toISOString(),
  run_id: runId,
  mode: "availability",
  target_binding_verified: false,
  message_sha256: hash(text),
  initialized: false,
  available: null,
  send_attempts: 0,
  send_status: "not_attempted",
  reply_matched: false,
  cleanup_stopped: false,
};
const privateResult = { run_id: runId };

// A hard bound also covers a stalled SDK cleanup; no SDK objects are printed.
const hardDeadline = setTimeout(() => {
  result.error = "hard_deadline";
  if (dispatchStarted && result.send_status !== "provider_accepted") {
    result.send_status = "uncertain";
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(2);
}, 49_000);
// Successful cleanup exits normally; this still terminates a late network
// operation that survives a soft deadline and subsequently opens SDK handles.
hardDeadline.unref();

function safeError(error) {
  return {
    grpc_code: typeof error?.grpcCode === "number" ? error.grpcCode : null,
    target_not_allowed: /target not allowed for this project/iu.test(
      error?.message || "",
    ),
    timeout: error?.message === "operation_deadline",
  };
}

async function bounded(operation, maxMs = 10_000) {
  let timer;
  try {
    const remaining = Math.min(maxMs, deadline - Date.now());
    if (remaining <= 0) throw new Error("operation_deadline");
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("operation_deadline")),
          remaining,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function privateWrite(path, value) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function privateJson(path) {
  const info = await stat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0)
    throw new Error("private_file_permissions");
  return JSON.parse(await readFile(path, "utf8"));
}

function parseEnv(source) {
  const env = {};
  for (const line of source.split(/\r?\n/u)) {
    const match = line.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/u);
    if (match) env[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/u, "$2");
  }
  return env;
}

async function main() {
  const args = process.argv.slice(2);
  const send = args.includes("--send-once");
  const observe = args.includes("--observe-only");
  const receiptIndex = args.indexOf("--registration-receipt");
  if ((send && observe) || receiptIndex < 0 || !args[receiptIndex + 1])
    throw new Error("invalid_arguments");
  const allowedArgs = new Set([
    "--send-once",
    "--observe-only",
    "--registration-receipt",
    args[receiptIndex + 1],
  ]);
  if (args.some((arg) => !allowedArgs.has(arg)))
    throw new Error("invalid_arguments");
  result.mode = send ? "send_once" : observe ? "observe_only" : "availability";
  const receiptPath = await realpath(resolve(args[receiptIndex + 1]));
  const resolvedPrivateRoot = await realpath(privateRoot);
  if (dirname(receiptPath) !== resolvedPrivateRoot)
    throw new Error("receipt_outside_private_directory");
  const receipt = await privateJson(receiptPath);
  const authorization = await privateJson(
    resolve(privateRoot, "photon-controlled-authorization.json"),
  );
  targetHash = authorization.target_sha256;
  if (
    typeof targetHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(targetHash) ||
    authorization.message_count !== 1 ||
    authorization.project_id !== projectIdExpected ||
    authorization.message_sha256 !== hash(text) ||
    !Number.isFinite(Date.parse(authorization.authorized_at)) ||
    Date.parse(authorization.authorized_at) > start
  ) {
    throw new Error("controlled_authorization_binding_failed");
  }
  const target = receipt.phoneNumber;
  if (
    typeof target !== "string" ||
    hash(target) !== targetHash ||
    receipt.projectId !== projectIdExpected ||
    !receipt.id ||
    receipt.type !== "shared"
  ) {
    throw new Error("controlled_registration_binding_failed");
  }
  result.target_binding_verified = true;
  await mkdir(privateRoot, { recursive: true, mode: 0o700 });
  await chmod(privateRoot, 0o700);
  if (send || observe) {
    try {
      intent = await privateJson(intentPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (send && intent) throw new Error("dispatch_intent_exists_no_resend");
    if (observe && !intent)
      throw new Error("observation_requires_existing_intent");
    if (
      intent &&
      (intent.target_sha256 !== targetHash ||
        intent.project_id !== projectIdExpected ||
        intent.message_sha256 !== hash(text) ||
        intent.chat_guid !== `any;-;${target}`)
    ) {
      throw new Error("existing_intent_binding_failed");
    }
  }
  const env = parseEnv(await readFile(resolve(root, ".env"), "utf8"));
  const projectId = process.env.PHOTON_PROJECT_ID || env.PHOTON_PROJECT_ID;
  const projectSecret =
    process.env.PHOTON_PROJECT_SECRET || env.PHOTON_PROJECT_SECRET;
  if (projectId !== projectIdExpected || !projectSecret)
    throw new Error("credentials_binding_failed");
  if (process.env.SPECTRUM_CLOUD_URL || process.env.SPECTRUM_IMESSAGE_ADDRESS)
    throw new Error("endpoint_override_not_allowed");
  for (const name of ["@spectrum-ts/core", "@spectrum-ts/imessage"]) {
    const pkg = JSON.parse(
      await readFile(resolve(dependencyRoot, name, "package.json"), "utf8"),
    );
    if (pkg.version !== "12.10.1")
      throw new Error("pinned_dependency_mismatch");
  }
  const [{ Spectrum, cloud }, { imessage }, { createGrpcClient }] =
    await Promise.all([
      import(
        pathToFileURL(
          resolve(dependencyRoot, "@spectrum-ts/core/dist/index.js"),
        )
      ),
      import(
        pathToFileURL(
          resolve(dependencyRoot, "@spectrum-ts/imessage/dist/index.js"),
        )
      ),
      import(
        pathToFileURL(
          resolve(dependencyRoot, "@photon-ai/advanced-imessage/dist/grpc.js"),
        )
      ),
    ]);
  app = await bounded(() =>
    Spectrum({
      projectId,
      projectSecret,
      providers: [imessage.config()],
      telemetry: false,
      options: { logLevel: "error" },
    }),
  );
  result.initialized = true;
  // Dedicated explicit client disables retries even for an uncertain send.
  // Tokens remain in memory; the project-authenticated discovery chooses them.
  const discovered = await bounded(() =>
    cloud.issueImessageTokens(projectId, projectSecret),
  );
  if (discovered.type !== "shared" || typeof discovered.token !== "string")
    throw new Error("shared_transport_required");
  client = createGrpcClient({
    address: "imessage.spectrum.photon.codes:443",
    token: discovered.token,
    tls: true,
    retry: false,
    autoIdempotency: false,
    timeout: 8_000,
    channelOptions: { "grpc.enable_retries": 0 },
  });
  if (!observe) {
    try {
      result.available = await bounded(() =>
        client.addresses.isIMessageAvailable(target),
      );
    } catch (error) {
      result.availability_failure = safeError(error);
      if (!send) throw error;
      // A policy failure of the address read does not establish that the
      // registered DM send route is denied. The explicit flag authorizes one
      // correctly bound diagnostic send; it never alters or bypasses policy.
    }
    if (!send) return;
    if (result.available === false)
      throw new Error("controlled_target_not_available");
    const dm = await bounded(async () =>
      imessage(app).space.create(await imessage(app).user(target)),
    );
    if (
      dm.id !== `any;-;${target}` ||
      dm.type !== "dm" ||
      dm.phone !== "shared"
    )
      throw new Error("controlled_dm_binding_failed");
    intent = {
      created_at: new Date().toISOString(),
      project_id: projectIdExpected,
      user_id: receipt.id,
      target_sha256: targetHash,
      message_sha256: hash(text),
      chat_guid: dm.id,
      client_message_id: randomUUID(),
      status: "intent_persisted_no_automatic_resend",
    };
    // Exclusive create and fsync precede the only send invocation. A crash or
    // missing response leaves this permanent refusal fence intact.
    await privateWrite(intentPath, intent);
    dispatchStarted = true;
    result.send_attempts = 1;
    result.send_status = "uncertain";
    const sent = await bounded(() =>
      client.messages.sendText(intent.chat_guid, text, {
        clientMessageId: intent.client_message_id,
      }),
    );
    if (
      !sent.guid ||
      !sent.isFromMe ||
      !sent.chatGuids.includes(intent.chat_guid)
    )
      throw new Error("dispatch_response_binding_failed");
    privateResult.outbound_message_id = sent.guid;
    privateResult.chat_guid = intent.chat_guid;
    privateResult.client_message_id = intent.client_message_id;
    result.message_id_sha256 = hash(sent.guid);
    result.send_status = "provider_accepted";
    result.accepted_at = new Date().toISOString();
    await privateWrite(
      resolve(privateRoot, "photon-controlled-dispatch-receipt.json"),
      { ...privateResult, accepted_at: result.accepted_at },
    );
  }
  const after = new Date(intent.created_at);
  if (!Number.isFinite(after.getTime()))
    throw new Error("invalid_intent_timestamp");
  const matchReply = (message) => {
    if (
      message.isFromMe !== false ||
      message.sender?.address !== target ||
      message.sender?.service !== "iMessage" ||
      !message.chatGuids?.includes(intent.chat_guid) ||
      !(message.dateCreated instanceof Date) ||
      message.dateCreated < after ||
      message.content?.text !== expectedReply ||
      !message.guid
    )
      return false;
    result.reply_matched = true;
    result.reply_observed_at = new Date().toISOString();
    result.reply_message_id_sha256 = hash(message.guid);
    privateResult.reply = {
      message_id: message.guid,
      chat_guid: intent.chat_guid,
      sender_matches_controlled_target: true,
      text_equals_expected_reply: true,
      created_at: message.dateCreated.toISOString(),
    };
    return true;
  };
  // Server scopes both reads and events to this exact DM. No global event
  // stream or listRecent call reads unrelated conversations.
  stream = client.messages.subscribeEvents({ chat: intent.chat_guid });
  const iterator = stream[Symbol.asyncIterator]();
  let next = iterator.next();
  // Attach rejection handling before a separate history request can fail.
  next.catch(() => {});
  try {
    const history = await bounded(() =>
      client.messages.listInChat(intent.chat_guid, {
        after,
        isFromMe: false,
        pageSize: 20,
      }),
    );
    if (history.messages.some(matchReply)) return;
  } catch (error) {
    result.targeted_history_failure = safeError(error);
  }
  while (!result.reply_matched && Date.now() < deadline - 1_000) {
    const event = await bounded(() => next, deadline - Date.now() - 500);
    if (event.done) break;
    if (
      event.value.chatGuid === intent.chat_guid &&
      event.value.type === "message.received"
    )
      matchReply(event.value.message);
    if (!result.reply_matched) {
      next = iterator.next();
      next.catch(() => {});
    }
  }
}

try {
  await main();
} catch (error) {
  result.failure = safeError(error);
  result.error = [
    "invalid_arguments",
    "private_file_permissions",
    "receipt_outside_private_directory",
    "controlled_authorization_binding_failed",
    "controlled_registration_binding_failed",
    "dispatch_intent_exists_no_resend",
    "observation_requires_existing_intent",
    "existing_intent_binding_failed",
    "credentials_binding_failed",
    "endpoint_override_not_allowed",
    "pinned_dependency_mismatch",
    "shared_transport_required",
    "controlled_target_not_available",
    "controlled_dm_binding_failed",
    "dispatch_response_binding_failed",
    "invalid_intent_timestamp",
  ].includes(error.message)
    ? error.message
    : "operation_failed";
  // A bounded observation ending without a matching reply is incomplete
  // evidence, even after a successful provider write.
  process.exitCode = 1;
} finally {
  let cleanupTimer;
  try {
    await Promise.race([
      (async () => {
        if (stream) await stream.close();
        if (client) await client.close();
        if (app) await app.stop();
        result.cleanup_stopped = true;
      })(),
      new Promise((_, reject) => {
        cleanupTimer = setTimeout(
          () => reject(new Error("cleanup_deadline")),
          4_000,
        );
      }),
    ]);
  } catch {
    result.cleanup_failed = true;
    process.exitCode = 1;
  }
  clearTimeout(cleanupTimer);
  result.finished_at = new Date().toISOString();
  result.duration_ms = Date.now() - start;
  try {
    await privateWrite(
      resolve(privateRoot, `photon-controlled-result-${runId}.json`),
      { ...privateResult, result },
    );
  } catch {
    result.private_result_write_failed = true;
    process.exitCode = 1;
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
