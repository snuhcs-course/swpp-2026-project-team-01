#!/usr/bin/env node

/**
 * Read-only Photon/Spectrum transport probe.
 *
 * The probe authenticates with the existing ignored root `.env`, initializes
 * the cloud iMessage provider, and performs only an availability lookup for a
 * fresh address under RFC 2606's reserved `.invalid` domain. The returned
 * boolean is deliberately discarded: no message, chat, participant, or
 * contact data is emitted or persisted.
 */

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const dependencyRoot = resolve(
  root,
  ".local/photon-transport-probe/node_modules",
);
const timeoutMs = 15_000;
let probeResult;

function parseEnv(source) {
  const result = {};
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[name] = value;
  }
  return result;
}

async function withTimeout(label, operation) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label}_timeout`)),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function packageVersion(name) {
  const packagePath = resolve(dependencyRoot, name, "package.json");
  return JSON.parse(await readFile(packagePath, "utf8")).version;
}

async function main() {
  const startedAt = Date.now();
  const localEnv = parseEnv(await readFile(resolve(root, ".env"), "utf8"));
  const projectId = process.env.PHOTON_PROJECT_ID || localEnv.PHOTON_PROJECT_ID;
  const projectSecret =
    process.env.PHOTON_PROJECT_SECRET || localEnv.PHOTON_PROJECT_SECRET;

  const result = (probeResult = {
    checked_at: new Date().toISOString(),
    runtime: {
      node: process.version,
      supported: Number.parseInt(process.versions.node, 10) >= 18,
    },
    dependencies: {
      core: await packageVersion("@spectrum-ts/core"),
      imessage: await packageVersion("@spectrum-ts/imessage"),
      expected: "12.10.1",
    },
    credentials: {
      project_id_present: Boolean(projectId),
      project_secret_present: Boolean(projectSecret),
    },
    project_authentication: {
      stage: "not_started",
      initialized: false,
      project_record_loaded: false,
      typed_id_present: false,
      configured_project_matches: null,
      project_record_keys: [],
    },
    transport: {
      kind: "grpc_tls",
      client_available: false,
      server_reached: false,
      permission_denied: false,
      read_only_rpc: "addresses.isIMessageAvailable(reserved_invalid_address)",
      rpc_succeeded: false,
      authenticated_response: false,
      response_discarded: true,
    },
    cleanup: { stopped: false },
  });

  if (!projectId || !projectSecret) {
    throw Object.assign(new Error("missing_photon_credentials"), { result });
  }

  const [{ Spectrum }, { imessage }] = await Promise.all([
    import(
      pathToFileURL(resolve(dependencyRoot, "@spectrum-ts/core/dist/index.js"))
    ),
    import(
      pathToFileURL(
        resolve(dependencyRoot, "@spectrum-ts/imessage/dist/index.js"),
      )
    ),
  ]);

  let app;
  try {
    result.project_authentication.stage = "initializing";
    app = await withTimeout("initialize", () =>
      Spectrum({
        projectId,
        projectSecret,
        providers: [imessage.config()],
        telemetry: false,
        options: { logLevel: "error" },
      }),
    );
    result.project_authentication.initialized = true;
    result.project_authentication.stage = "initialized";
    result.project_authentication.project_record_loaded = Boolean(app.config);
    result.project_authentication.project_record_keys = Object.keys(
      app.config || {},
    ).sort();
    result.project_authentication.typed_id_present =
      typeof app.config?.id === "string";
    result.project_authentication.configured_project_matches =
      typeof app.config?.id === "string" ? app.config.id === projectId : null;

    const runtime = app.__internal.platforms.get("imessage");
    const firstClient = Array.isArray(runtime?.client)
      ? runtime.client[0]
      : undefined;
    result.transport.client_available = Boolean(firstClient?.client);
    if (!firstClient?.client) throw new Error("no_imessage_transport_client");

    result.project_authentication.stage = "read_only_rpc";
    const availability = await withTimeout("read_only_rpc", () =>
      firstClient.client.addresses.isIMessageAvailable(
        `fmat-p0-${randomUUID()}@example.invalid`,
      ),
    );
    // The boolean is intentionally discarded. `.invalid` is reserved by RFC
    // 2606, so this cannot name a real recipient or begin a conversation.
    void availability;
    result.transport.rpc_succeeded = true;
    result.transport.authenticated_response = true;
    result.project_authentication.stage = "complete";
  } finally {
    if (app) {
      try {
        await withTimeout("cleanup", () => app.stop());
        result.cleanup.stopped = true;
      } catch {
        result.cleanup.error = "cleanup_failed";
      }
    }
    result.duration_ms = Date.now() - startedAt;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  const result = error?.result ||
    probeResult || {
      checked_at: new Date().toISOString(),
      runtime: { node: process.version },
    };
  result.error = {
    name: error instanceof Error ? error.name : "UnknownError",
    code: typeof error?.code === "string" ? error.code : undefined,
    grpc_code: typeof error?.grpcCode === "number" ? error.grpcCode : undefined,
    category:
      error instanceof Error && /_timeout$/u.test(error.message)
        ? error.message
        : "probe_failed",
  };
  if (result.transport && typeof error?.grpcCode === "number") {
    result.transport.server_reached = true;
  }
  if (result.transport && error?.grpcCode === 7) {
    result.transport.permission_denied = true;
    if (result.project_authentication) {
      result.project_authentication.stage = "read_only_rpc_denied";
    }
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = 1;
});
