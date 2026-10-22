import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { AuthError, login, refresh, revoke } from "./oauth.js";
import { callTool, listTools, McpError, type McpTool } from "./mcp.js";
import { chooseStore, type Connection, readSaved, removeConnection, saveConnection, type StoreKind, StoreError } from "./store.js";

// fmat, the Find Me a Time user CLI (agent-access D4, design 9). Every command
// prints exactly one JSON object on stdout ({ ok, result } or { ok, error })
// and exits with a documented code; prompts and diagnostics go to stderr.

export const EXIT = { ok: 0, toolError: 1, usage: 2, authorization: 3, unknownOutcome: 4, service: 5 } as const;

export const DEFAULT_ORIGIN = "https://findmeatime.com";

const HOST_SCOPES = "host:read host:write host:decide";
const REQUESTER_SCOPES = "request:read request:write request:decide";

export type Io = {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly readLine: () => Promise<string>;
  readonly env: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
};

export const USAGE = `Usage: fmat <command> [options]

Commands:
  login (--host | --handle <handle>) [--no-browser] [--scope "<scopes>"]
  status
  tools [--host | --handle <handle>]
  call <tool> [--input <json> | --input-file <path>] [--retry-key <key>] [--host | --handle <handle>]
  logout [--host | --handle <handle>]

Options:
  --origin <url>              The service origin (default ${DEFAULT_ORIGIN}, or FMAT_ORIGIN)
  --credential-store <kind>   keychain, secret-service or file (or FMAT_CREDENTIAL_STORE)

Exit codes: 0 success, 1 tool error, 2 usage, 3 authorization needed,
4 unknown outcome (repeat with the printed retry key), 5 service or protocol error.`;

export type Parsed = {
  readonly command: string | null;
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | true>>;
};

const VALUE_FLAGS = new Set(["handle", "scope", "input", "input-file", "retry-key", "origin", "credential-store"]);
const BOOLEAN_FLAGS = new Set(["host", "no-browser", "help"]);

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export function parseArgs(argv: readonly string[]): Parsed {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (name in flags) throw new UsageError(`--${name} was given twice.`);
    if (BOOLEAN_FLAGS.has(name)) {
      if (inline !== undefined) throw new UsageError(`--${name} takes no value.`);
      flags[name] = true;
    } else if (VALUE_FLAGS.has(name)) {
      const value = inline ?? argv[++index];
      if (value === undefined || (inline === undefined && value.startsWith("--"))) throw new UsageError(`--${name} needs a value.`);
      flags[name] = value;
    } else {
      throw new UsageError(`Unknown option --${name}.`);
    }
  }

  return { command: positional.shift() ?? null, flags, positional };
}

function print(io: Io, body: unknown) {
  io.stdout(`${JSON.stringify(body)}\n`);
}

function fail(io: Io, code: number, category: string, message: string, nextAction: string, extra: Record<string, unknown> = {}) {
  print(io, { error: { category, message, nextAction }, ok: false, ...extra });
  return code;
}

function originOf(parsed: Parsed, io: Io) {
  const raw = (parsed.flags.origin as string | undefined) ?? io.env.FMAT_ORIGIN ?? DEFAULT_ORIGIN;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
      throw new UsageError("The origin must be https, or http on this machine.");
    }
    return url.origin;
  } catch (error) {
    throw error instanceof UsageError ? error : new UsageError(`Not a URL: ${raw}`);
  }
}

// The resource a command names (--host or --handle), or null for the current one.
function namedResource(parsed: Parsed, origin: string) {
  if (parsed.flags.host && parsed.flags.handle) throw new UsageError("Choose --host or --handle, not both.");
  if (parsed.flags.host) return { handle: null, resource: `${origin}/mcp`, role: "host" as const };
  if (typeof parsed.flags.handle === "string") {
    const handle = parsed.flags.handle.trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{1,29}$/.test(handle)) throw new UsageError("That is not a Find Me a Time handle.");
    return { handle, resource: `${origin}/${handle}/mcp`, role: "requester" as const };
  }
  return null;
}

function loginHint(connection: { role: "host" | "requester"; handle: string | null } | null) {
  if (!connection) return "Run fmat login --host, or fmat login --handle <handle> to request a meeting.";
  return connection.role === "host" ? "Run fmat login --host again." : `Run fmat login --handle ${connection.handle} again.`;
}

function selectConnection(parsed: Parsed, origin: string, store: StoreKind) {
  const saved = readSaved(store);
  const named = namedResource(parsed, origin);
  const resource = named?.resource ?? saved.current;
  return { connection: resource ? (saved.connections[resource] ?? null) : null, named };
}

// A connection with a usable access token, refreshing when it is about to
// expire. A refused or unanswered refresh deletes the stored credential.
async function fresh(io: Io, store: StoreKind, connection: Connection, force = false) {
  if (!force && connection.accessExpiresAt - Date.now() > 30_000) return connection;
  try {
    const next = await refresh(connection, io.fetchImpl);
    saveConnection(store, next);
    return next;
  } catch (error) {
    if (error instanceof AuthError && error.category === "reauthorization_required") removeConnection(store, connection.resource);
    throw error;
  }
}

async function withToken<T>(io: Io, store: StoreKind, connection: Connection, run: (connection: Connection) => Promise<T>) {
  let current = await fresh(io, store, connection);
  try {
    return await run(current);
  } catch (error) {
    if (!(error instanceof McpError) || error.failure.kind !== "unauthorized") throw error;
    current = await fresh(io, store, current, true);
    try {
      return await run(current);
    } catch (again) {
      if (again instanceof McpError && again.failure.kind === "unauthorized") {
        removeConnection(store, current.resource);
        throw new AuthError("reauthorization_required", "The connection is no longer authorized.");
      }
      throw again;
    }
  }
}

function readInput(parsed: Parsed): Record<string, unknown> {
  if (parsed.flags.input && parsed.flags["input-file"]) throw new UsageError("Give --input or --input-file, not both.");
  const text = typeof parsed.flags.input === "string" ? parsed.flags.input : typeof parsed.flags["input-file"] === "string" ? readFileSync(parsed.flags["input-file"], "utf8") : "{}";
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UsageError("The input is not JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new UsageError("The input must be a JSON object.");
  return value as Record<string, unknown>;
}

function takesRetryKey(tool: McpTool) {
  return Boolean(tool.inputSchema?.properties && "retryKey" in tool.inputSchema.properties);
}

export async function main(argv: readonly string[], io: Io): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    return fail(io, EXIT.usage, "usage", (error as Error).message, "Run fmat --help.");
  }

  if (parsed.flags.help || !parsed.command) {
    io.stderr(`${USAGE}\n`);
    return parsed.flags.help ? EXIT.ok : fail(io, EXIT.usage, "usage", "Name a command.", "Run fmat --help.");
  }

  try {
    const origin = originOf(parsed, io);
    const store = chooseStore((parsed.flags["credential-store"] as string | undefined) ?? io.env.FMAT_CREDENTIAL_STORE);

    switch (parsed.command) {
      case "login": {
        const named = namedResource(parsed, origin);
        if (!named) throw new UsageError("Choose --host, or --handle <handle> to request a meeting with that host.");
        const scope = typeof parsed.flags.scope === "string" ? parsed.flags.scope : named.role === "host" ? HOST_SCOPES : REQUESTER_SCOPES;
        const connection = await login({
          fetchImpl: io.fetchImpl,
          handle: named.handle,
          headless: Boolean(parsed.flags["no-browser"]),
          notify: (line) => io.stderr(`${line}\n`),
          origin,
          readLine: io.readLine,
          resource: named.resource,
          role: named.role,
          scope,
        });
        saveConnection(store, connection);
        print(io, { ok: true, result: { expiresAt: new Date(connection.accessExpiresAt).toISOString(), origin, resource: connection.resource, role: connection.role, scope: connection.scope } });
        return EXIT.ok;
      }

      case "status": {
        const saved = readSaved(store);
        print(io, {
          ok: true,
          result: {
            connections: Object.values(saved.connections).map((connection) => ({
              accessExpiresAt: new Date(connection.accessExpiresAt).toISOString(),
              current: connection.resource === saved.current,
              handle: connection.handle,
              origin: connection.origin,
              resource: connection.resource,
              role: connection.role,
              scope: connection.scope,
            })),
            credentialStore: store,
          },
        });
        return EXIT.ok;
      }

      case "logout": {
        const { connection } = selectConnection(parsed, origin, store);
        if (!connection) return fail(io, EXIT.authorization, "not_connected", "No stored connection matches.", loginHint(null));
        const revoked = await revoke(connection, io.fetchImpl);
        removeConnection(store, connection.resource);
        print(io, { ok: true, result: { removed: connection.resource, revoked } });
        return EXIT.ok;
      }

      case "tools":
      case "call": {
        const { connection, named } = selectConnection(parsed, origin, store);
        if (!connection) return fail(io, EXIT.authorization, "not_connected", "This command needs a connection.", loginHint(named));

        const tools = await withToken(io, store, connection, (current) => listTools(current.resource, current.accessToken, io.fetchImpl));
        if (parsed.command === "tools") {
          print(io, { ok: true, result: { tools: tools.map((tool) => ({ description: tool.description, inputSchema: tool.inputSchema, name: tool.name, readOnly: tool.annotations?.readOnlyHint ?? false })) } });
          return EXIT.ok;
        }

        const name = parsed.positional[0];
        const tool = tools.find((candidate) => candidate.name === name);
        if (!name || !tool) throw new UsageError(name ? `This connection has no tool named ${name}.` : "Name a tool: fmat call <tool>.");

        const args = readInput(parsed);
        let retryKey: string | null = null;
        if (takesRetryKey(tool)) {
          retryKey = typeof parsed.flags["retry-key"] === "string" ? parsed.flags["retry-key"] : typeof args.retryKey === "string" ? args.retryKey : randomUUID();
          args.retryKey = retryKey;
        }

        try {
          const result = await withToken(io, store, connection, (current) => callTool(current.resource, current.accessToken, name, args, io.fetchImpl));
          const structured = (result.structuredContent ?? null) as { error?: unknown } | null;
          if (result.isError) {
            print(io, { error: structured?.error ?? structured, ok: false, ...(retryKey ? { retryKey } : {}) });
            return EXIT.toolError;
          }
          print(io, { ok: true, result: structured, ...(retryKey ? { retryKey } : {}) });
          return EXIT.ok;
        } catch (error) {
          if (error instanceof McpError && error.failure.kind === "no_response") {
            return fail(
              io,
              EXIT.unknownOutcome,
              "unknown_outcome",
              "No answer arrived, so whether the action ran is unknown.",
              retryKey ? `Run the same command again with --retry-key ${retryKey}; it returns the saved outcome if the action ran.` : "Run the same command again.",
              retryKey ? { retryKey } : {},
            );
          }
          throw error;
        }
      }
    }

    throw new UsageError(`Unknown command ${parsed.command}.`);
  } catch (error) {
    if (error instanceof UsageError) return fail(io, EXIT.usage, "usage", error.message, "Run fmat --help.");
    if (error instanceof StoreError) return fail(io, EXIT.usage, "credential_store", error.message, "Pass --credential-store file, or install a system credential store.");
    if (error instanceof AuthError) {
      const code = error.category === "service_unavailable" ? EXIT.service : EXIT.authorization;
      return fail(io, code, error.category, error.message, error.category === "service_unavailable" ? "Try again later." : "Run fmat login again.");
    }
    if (error instanceof McpError) {
      if (error.failure.kind === "insufficient_scope") {
        return fail(io, EXIT.authorization, "insufficient_scope", "This connection lacks a permission the tool needs.", `Run fmat login again with --scope including ${error.failure.scope ?? "the needed permission"}.`);
      }
      if (error.failure.kind === "no_response") return fail(io, EXIT.service, "service_unavailable", "The service did not answer.", "Try again later.");
      if (error.failure.kind === "protocol") return fail(io, EXIT.service, "protocol_error", error.failure.message, "Check the command, then try again.");
    }
    throw error;
  }
}
