import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpHandler } from "../../lib/server/agent-mcp";
import { createAuthorizationServerMetadataHandler, createTokenHandler } from "../../lib/server/agent-oauth-routes";
import { approveCommand } from "../../lib/server/bookings";
import { assignHandle } from "../../lib/server/handles";
import { agentDependencies, issueToken, type Tokens } from "./support/agents";
import { asHost, bookingDeps, runBooking } from "./support/booking";
import { fakeGoogleConfig } from "./support/calendar-host";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { calendarKey, evaluationDeps, runEvaluation, seedSchedulingRequest } from "./support/scheduling";

// The Phase 5 join, locally (agent-access task 6.1): a scripted requester MCP
// client and the CLI acting for the host work on the same request. Both see the
// same state and proposal version, retried actions replay, the agent's
// decision tool books nothing, the host's own approval books exactly one event
// even when repeated, the requester's agent reads the booked receipt, and
// revocation stops each of them.

const db = testDatabase();
let google: FakeGoogle;
let server: Server;
let origin: string;
let agent: ReturnType<typeof agentDependencies>;

beforeAll(async () => {
  google = await startFakeGoogle();
  await db`delete from app.agent_protocol_attempts`;
  agent = agentDependencies(db);
  let routes: (path: string) => ((request: Request, context?: { params: Promise<{ handle: string }> }) => Promise<Response> | Response) | null = () => null;

  server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Buffer);
    const url = new URL(incoming.url ?? "/", origin);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) if (typeof value === "string") headers.set(name, value);
    const route = routes(url.pathname);
    const handle = url.pathname.match(/^\/([^/]+)\/mcp$/)?.[1];
    const response = route
      ? await route(new Request(url, { body: chunks.length ? Buffer.concat(chunks) : undefined, headers, method: incoming.method }), handle ? { params: Promise.resolve({ handle }) } : undefined)
      : new Response("not found", { status: 404 });
    const out: Record<string, string> = {};
    response.headers.forEach((value, name) => (out[name] = value));
    outgoing.writeHead(response.status, out);
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const deps = { ...agent, appOrigin: origin };
  const mcpDeps = {
    ...deps,
    evaluationWaitMs: 200,
    setup: { appOrigin: origin, calendar: { config: fakeGoogleConfig(google), db, tokenKeys: [calendarKey] }, db },
  };
  const metadata = createAuthorizationServerMetadataHandler(() => deps);
  const token = createTokenHandler(() => deps);
  const host = createMcpHandler("host", () => mcpDeps);
  const requester = createMcpHandler("requester", () => mcpDeps);
  routes = (path) =>
    path === "/.well-known/oauth-authorization-server" ? metadata : path === "/oauth/token" ? token : path === "/mcp" ? host : /^\/[^/]+\/mcp$/.test(path) ? requester : null;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await google.close();
  await db.end();
});

// The scripted requester client: MCP 2026-07-28 over plain fetch.
async function requesterCall(resource: string, token: string, name: string, args: Record<string, unknown> = {}) {
  const response = await fetch(resource, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        _meta: { "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
        arguments: args,
        name,
      },
    }),
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "mcp-method": "tools/call",
      "mcp-name": name,
      "mcp-protocol-version": "2026-07-28",
    },
    method: "POST",
  });
  type Result = { status: number; isError?: boolean; structuredContent?: Record<string, unknown> };
  if (response.status !== 200) return { status: response.status } as Result;
  return { status: 200, ...((await response.json()) as { result: { isError: boolean; structuredContent: Record<string, unknown> } }).result } as Result;
}

const configDir = mkdtempSync(join(tmpdir(), "fmat-join-"));

function fmat(args: string[]) {
  return new Promise<{ code: number; json: Record<string, unknown> }>((resolve) => {
    const child = spawn("npx", ["tsx", "cli/src/fmat.ts", ...args], {
      env: { ...process.env, FMAT_CONFIG_DIR: configDir, FMAT_CREDENTIAL_STORE: "file", FMAT_ORIGIN: origin },
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stdin.end();
    child.on("close", (code) => resolve({ code: code ?? -1, json: stdout.trim() ? (JSON.parse(stdout.trim()) as Record<string, unknown>) : {} }));
  });
}

// The host's CLI connection, stored as `fmat login --host` would leave it
// (the login itself is covered by agent-cli.test.ts).
function storeHostConnection(tokens: Tokens) {
  const resource = `${origin}/mcp`;
  writeFileSync(
    join(configDir, "credentials.json"),
    JSON.stringify({
      connections: {
        [resource]: {
          accessExpiresAt: Date.now() + tokens.expires_in * 1000,
          accessToken: tokens.access_token,
          clientId: "fmat-cli",
          handle: null,
          origin,
          refreshToken: tokens.refresh_token,
          resource,
          role: "host",
          scope: tokens.scope,
        },
      },
      current: resource,
    }),
    { mode: 0o600 },
  );
}

describe("MCP and the CLI on one request", () => {
  it("agree, check, approve once, read the receipt and lose access on revocation", async () => {
    const request = await seedSchedulingRequest(db, google);
    const [settings] = await db<{ handle: string }[]>`select settings ->> 'handle' as handle from app.host_settings where host_account_id = ${request.hostAccountId}`;
    const handle = settings!.handle;
    await db.begin((tx) => assignHandle(tx, request.hostAccountId, handle));
    const requesterResource = `${origin}/${handle}/mcp`;
    const deps = { ...agent, appOrigin: origin };

    const requesterTokens = await issueToken(deps, {
      hostAccountId: request.hostAccountId,
      requestId: request.requestId,
      resource: requesterResource,
      role: "requester",
      scopes: ["request:read", "request:write", "request:decide"],
    });
    const hostTokens = await issueToken(deps, { hostAccountId: request.hostAccountId, resource: `${origin}/mcp`, role: "host", scopes: ["host:read", "host:write", "host:decide"] });
    storeHostConnection(hostTokens);
    const rq = (name: string, args?: Record<string, unknown>) => requesterCall(requesterResource, requesterTokens.access_token, name, args);

    // The requester's agent finds times, chooses and agrees, retrying the agreement.
    const found = await rq("find_times", { retryKey: "join-times-1" });
    await runEvaluation(db, evaluationDeps(db, google), (found.structuredContent!.outcome as { evaluationId: string }).evaluationId);
    const read = await rq("get_request");
    const evaluation = read.structuredContent!.evaluation as { id: string; candidates: { id: string }[] };
    const chosen = await rq("choose_time", { expectedRevision: read.structuredContent!.revision, input: { candidateId: evaluation.candidates[0]!.id, evaluationId: evaluation.id }, retryKey: "join-choose-1" });
    const version = (chosen.structuredContent!.outcome as { version: number }).version;
    const revision = (chosen.structuredContent!.request as { revision: number }).revision;
    const agree = { expectedRevision: revision, input: { version }, retryKey: "join-agree-1" };
    const agreed = await rq("agree_to_proposal", agree);
    const again = await rq("agree_to_proposal", agree);
    expect(again.structuredContent!.outcome).toEqual(agreed.structuredContent!.outcome);

    // The host's CLI sees the same state and version, and its decision tool books nothing.
    const hostView = await fmat(["call", "get_request", "--input", JSON.stringify({ requestId: request.requestId })]);
    expect(hostView.code).toBe(0);
    expect(hostView.json.result).toMatchObject({ proposal: { version }, state: "awaiting_host_approval" });
    const requesterView = await rq("get_request");
    expect(requesterView.structuredContent).toMatchObject({ proposal: { version }, state: "awaiting_host_approval" });

    const prepared = await fmat(["call", "request_host_decision", "--input", JSON.stringify({ decision: "approve", requestId: request.requestId, version })]);
    expect(prepared.json.result).toMatchObject({ reviewUrl: `${origin}/app?request=${request.requestId}`, status: "confirmation_required" });
    expect(google.createdEvents(request.calendarId)).toHaveLength(0);

    // The host's own approval, twice, makes one booking and one event.
    const current = await db<{ revision: number }[]>`select revision from app.requests where id = ${request.requestId}`;
    const first = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version }, { expectedRevision: current[0]!.revision });
    const second = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version }, { expectedRevision: current[0]!.revision });
    expect(first.ok && second.ok).toBe(true);
    const bookingId = (first as { result: { bookingId: string } }).result.bookingId;
    expect((second as { result: { bookingId: string } }).result.bookingId).toBe(bookingId);
    await runBooking(db, bookingDeps(db, google), bookingId);
    expect(google.createdEvents(request.calendarId)).toHaveLength(1);

    // Both sides now see it booked; the requester's agent reads only the receipt.
    const booked = await rq("get_request");
    expect(booked.structuredContent).toMatchObject({ open: false, state: "booked" });
    expect((booked.structuredContent!.booking as { state?: string } | null)?.state).toBe("confirmed");
    const hostBooked = await fmat(["call", "get_request", "--input", JSON.stringify({ requestId: request.requestId })]);
    expect(hostBooked.json.result).toMatchObject({ state: "booked" });

    // Revocation stops both.
    await db`update app.agent_grants set revoked_at = now(), revoke_reason = 'requester' where request_id = ${request.requestId}`;
    expect((await rq("get_request")).status).toBe(401);
    await db`update app.agent_grants set revoked_at = now(), revoke_reason = 'host' where host_account_id = ${request.hostAccountId} and role = 'host'`;
    const revoked = await fmat(["call", "get_request", "--input", JSON.stringify({ requestId: request.requestId })]);
    expect(revoked.code).toBe(3);
  }, 120_000);
});
