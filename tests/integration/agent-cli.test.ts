import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthorizeHandler, createDecisionHandler } from "../../lib/server/agent-authorize";
import { createMcpHandler } from "../../lib/server/agent-mcp";
import { createAuthorizationServerMetadataHandler, createRevocationHandler, createTokenHandler } from "../../lib/server/agent-oauth-routes";
import { agentDependencies } from "./support/agents";
import { cookieHeader, localAuthConfig, signInHost } from "./support/auth";
import { fakeGoogleConfig } from "./support/calendar-host";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { calendarKey } from "./support/scheduling";

// The user CLI against a local server running the real handlers (agent-access
// task 4.2; design 9): a headless login through consent and /connect/code,
// tools and a tool call with JSON output, an exact retry by the printed key,
// a conflicting reuse, and a refused refresh that asks for a new login.

const db = testDatabase();
let google: FakeGoogle;
let server: Server;
let origin: string;

beforeAll(async () => {
  google = await startFakeGoogle();
  await db`delete from app.agent_protocol_attempts`;
  const shared = agentDependencies(db);
  let routes: Record<string, (request: Request) => Promise<Response> | Response> = {};

  server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Buffer);
    const url = new URL(incoming.url ?? "/", origin);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) if (typeof value === "string") headers.set(name, value);
    const request = new Request(url, { body: chunks.length ? Buffer.concat(chunks) : undefined, headers, method: incoming.method });
    const route = routes[url.pathname];
    const response = route ? await route(request) : new Response("not found", { status: 404 });
    const out: Record<string, string | string[]> = {};
    response.headers.forEach((value, name) => {
      if (name !== "set-cookie") out[name] = value;
    });
    if (response.headers.getSetCookie().length) out["set-cookie"] = response.headers.getSetCookie();
    outgoing.writeHead(response.status, out);
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const deps = { ...shared, appOrigin: origin, auth: localAuthConfig() };
  const mcpDeps = {
    ...deps,
    setup: { appOrigin: origin, calendar: { config: fakeGoogleConfig(google), db, tokenKeys: [calendarKey] }, db },
  };
  routes = {
    "/.well-known/oauth-authorization-server": createAuthorizationServerMetadataHandler(() => deps),
    "/connect/authorize": createAuthorizeHandler(() => deps),
    "/connect/decision": createDecisionHandler(() => deps),
    "/mcp": createMcpHandler("host", () => mcpDeps),
    "/oauth/revoke": createRevocationHandler(() => deps),
    "/oauth/token": createTokenHandler(() => deps),
  };
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await google.close();
  await db.end();
});

const configDir = mkdtempSync(join(tmpdir(), "fmat-cli-"));

function fmat(args: string[]) {
  const child = spawn("npx", ["tsx", "cli/src/fmat.ts", ...args], {
    env: { ...process.env, FMAT_CONFIG_DIR: configDir, FMAT_CREDENTIAL_STORE: "file", FMAT_ORIGIN: origin },
  }) as ChildProcessWithoutNullStreams;
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const done = new Promise<{ code: number; json: Record<string, unknown> }>((resolve) =>
    child.on("close", (code) => resolve({ code: code ?? -1, json: stdout.trim() ? (JSON.parse(stdout.trim()) as Record<string, unknown>) : {} })),
  );
  return { child, done, stderr: () => stderr };
}

async function waitFor<T>(read: () => T | null, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > until) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("fmat", () => {
  let host: Awaited<ReturnType<typeof signInHost>>;

  it("logs in headlessly through consent and the code page", async () => {
    host = await signInHost(db);
    const login = fmat(["login", "--host", "--no-browser"]);
    const url = await waitFor(() => login.stderr().match(/(http:\/\/127\.0\.0\.1:\d+\/connect\/authorize\?\S+)/)?.[1] ?? null);

    const authorize = await fetch(url, { headers: { cookie: host.cookie }, redirect: "manual" });
    const transaction = new URL(authorize.headers.get("location")!).searchParams.get("transaction")!;
    const cookie = `${host.cookie}; ${cookieHeader(authorize)}`;
    const decided = await fetch(`${origin}/connect/decision`, {
      body: new URLSearchParams([["transaction", transaction], ["decision", "allow"], ["scope", "host:read"], ["scope", "host:write"]]).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded", cookie, origin },
      method: "POST",
      redirect: "manual",
    });
    const codePage = new URL(decided.headers.get("location")!);
    expect(codePage.origin + codePage.pathname).toBe(`${origin}/connect/code`);
    login.child.stdin.write(`${codePage.searchParams.get("state")}.${codePage.searchParams.get("code")}\n`);

    const result = await login.done;
    expect(result.code).toBe(0);
    expect(result.json).toMatchObject({ ok: true, result: { resource: `${origin}/mcp`, role: "host", scope: "host:read host:write" } });

    const stored = readFileSync(join(configDir, "credentials.json"), "utf8");
    expect(stored).toContain("refreshToken");
  }, 60_000);

  it("lists tools and calls one, printing JSON", async () => {
    const tools = await fmat(["tools"]).done;
    expect(tools.code).toBe(0);
    const names = (tools.json.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
    expect(names).toContain("get_host_status");
    expect(names).not.toContain("request_host_decision");

    const status = await fmat(["call", "get_host_status"]).done;
    expect(status.code).toBe(0);
    expect(status.json).toMatchObject({ ok: true, result: { ready: false, workspace: `${origin}/app` } });
  }, 60_000);

  it("replays a mutation by its printed retry key and refuses the key with other input", async () => {
    const setup = await fmat(["call", "get_setup"]).done;
    const revision = (setup.json.result as { draft?: { revision: number }; revision?: number }).draft?.revision ?? (setup.json.result as { revision: number }).revision;
    expect(typeof revision).toBe("number");

    const input = JSON.stringify({ expectedRevision: revision, input: { action: "choose_own", field: "displayName", value: "Ada Agent" } });
    const first = await fmat(["call", "update_setup_field", "--input", input]).done;
    expect(first.code).toBe(0);
    const retryKey = first.json.retryKey as string;
    expect(retryKey).toBeTruthy();

    const again = await fmat(["call", "update_setup_field", "--input", input, "--retry-key", retryKey]).done;
    expect(again.code).toBe(0);
    expect(again.json.result).toEqual(first.json.result);

    const other = JSON.stringify({ expectedRevision: revision, input: { action: "choose_own", field: "displayName", value: "Someone Else" } });
    const conflict = await fmat(["call", "update_setup_field", "--input", other, "--retry-key", retryKey]).done;
    expect(conflict.code).toBe(1);
    expect(conflict.json).toMatchObject({ error: { category: "retry_conflict" }, ok: false, retryKey });
  }, 60_000);

  it("asks for a new login when the refresh is refused", async () => {
    await db`update app.agent_grants set revoked_at = now(), revoke_reason = 'host' where host_account_id = ${host.hostAccountId} and revoked_at is null`;
    const path = join(configDir, "credentials.json");
    const saved = JSON.parse(readFileSync(path, "utf8")) as { connections: Record<string, { accessExpiresAt: number }> };
    for (const connection of Object.values(saved.connections)) connection.accessExpiresAt = 0;
    writeFileSync(path, JSON.stringify(saved), { mode: 0o600 });

    const refused = await fmat(["tools"]).done;
    expect(refused.code).toBe(3);
    expect(refused.json).toMatchObject({ error: { category: "reauthorization_required", nextAction: "Run fmat login again." }, ok: false });

    const after = await fmat(["status"]).done;
    expect((after.json.result as { connections: unknown[] }).connections).toEqual([]);
  }, 60_000);
});
