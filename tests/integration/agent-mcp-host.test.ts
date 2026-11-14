import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpHandler, type McpDependencies } from "../../lib/server/agent-mcp";
import { agentDependencies, callTool, HOST_RESOURCE, issueToken, mcpRequest, ORIGIN } from "./support/agents";
import { agreedRequest } from "./support/booking";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { createTestRequest, testNotices } from "./support/requests";
import { fakeGoogleConfig } from "./support/calendar-host";
import { calendarKey } from "./support/scheduling";

// The host MCP endpoint (agent-access task 4.1; design 4 and 6): both protocol
// eras on one stateless endpoint, the token and grant checks on every call,
// the tool list per permission, the host projection of the host's own
// requests, retries that replay, and decisions in the host's words
// (agent-decisions-in-words).

const db = testDatabase();
let google: FakeGoogle;

beforeAll(async () => {
  google = await startFakeGoogle();
  await db`delete from app.agent_protocol_attempts`;
});

afterAll(async () => {
  await google.close();
  await db.end();
});

function setup() {
  const agent = agentDependencies(db);
  const deps: McpDependencies = {
    appOrigin: ORIGIN,
    db,
    notices: () => testNotices,
    setup: { appOrigin: ORIGIN, calendar: { config: fakeGoogleConfig(google), db, tokenKeys: [calendarKey] }, db },
    signingKey: agent.signingKey,
    tokenKey: agent.tokenKey,
  };
  return { agent, handler: createMcpHandler("host", () => deps) };
}

async function hostWithRequest(scopes = ["host:read", "host:write", "host:decide"]) {
  const { agent, handler } = setup();
  const request = await agreedRequest(db, google);
  const tokens = await issueToken(agent, { hostAccountId: request.hostAccountId, resource: HOST_RESOURCE, role: "host", scopes });
  return { agent, handler, request, token: tokens.access_token };
}

async function rpc(handler: ReturnType<typeof setup>["handler"], call: Parameters<typeof mcpRequest>[1]) {
  const response = await handler(mcpRequest("/mcp", call));
  const text = await response.text();
  return { body: text ? (JSON.parse(text) as { result?: Record<string, unknown>; error?: { code: number; data?: unknown } }) : null, response };
}

describe("authentication", () => {
  it("challenges a missing, foreign or wrong-audience token with the resource metadata", async () => {
    const { agent, handler, request } = await hostWithRequest();
    const missing = await rpc(handler, { method: "tools/list" });
    expect(missing.response.status).toBe(401);
    expect(missing.response.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="host:read host:write host:decide"`,
    );

    const requesterToken = await issueToken(agent, {
      hostAccountId: request.hostAccountId,
      requestId: request.requestId,
      resource: `${ORIGIN}/somebody/mcp`,
      role: "requester",
      scopes: ["request:read"],
    });
    const wrongAudience = await rpc(handler, { method: "tools/list", token: requesterToken.access_token });
    expect(wrongAudience.response.status).toBe(401);
    expect(wrongAudience.response.headers.get("www-authenticate")).toContain('error="invalid_token"');

    const forged = await rpc(handler, { method: "tools/list", token: "eyJhbGciOiJub25lIn0.e30." });
    expect(forged.response.status).toBe(401);
  });

  it("stops at once for a suspended host or a revoked grant", async () => {
    const { handler, request, token } = await hostWithRequest();
    expect((await rpc(handler, { method: "tools/list", token })).response.status).toBe(200);

    await db`update app.host_accounts set status = 'suspended' where id = ${request.hostAccountId}`;
    expect((await rpc(handler, { method: "tools/list", token })).response.status).toBe(401);
    await db`update app.host_accounts set status = 'active' where id = ${request.hostAccountId}`;

    await db`update app.agent_grants set revoked_at = now(), revoke_reason = 'host' where host_account_id = ${request.hostAccountId}`;
    expect((await rpc(handler, { method: "tools/list", token })).response.status).toBe(401);
  });

  it("refuses GET, DELETE and a foreign browser origin", async () => {
    const { handler, token } = await hostWithRequest();
    expect((await handler(new Request(`${ORIGIN}/mcp`, { headers: { authorization: `Bearer ${token}` } }))).status).toBe(405);
    expect((await handler(new Request(`${ORIGIN}/mcp`, { method: "DELETE" }))).status).toBe(405);
    const foreign = await rpc(handler, { headers: { origin: "https://evil.example" }, method: "tools/list", token });
    expect(foreign.response.status).toBe(403);
  });
});

describe("protocol eras", () => {
  it("serves handshake clients without a session", async () => {
    const { handler, token } = await hostWithRequest();
    const init = await rpc(handler, {
      era: "2025-03-26",
      method: "initialize",
      params: { capabilities: {}, clientInfo: { name: "legacy", version: "1" }, protocolVersion: "2025-06-18" },
      token,
    });
    expect(init.body?.result).toMatchObject({ capabilities: { tools: {} }, protocolVersion: "2025-06-18", serverInfo: { name: "find-me-a-time" } });
    expect(init.body?.result?.instructions).toContain("Start with get_host_status");
    expect(init.response.headers.get("mcp-session-id")).toBeNull();

    const unknown = await rpc(handler, { era: "2025-03-26", method: "initialize", params: { protocolVersion: "1999-01-01" }, token });
    expect(unknown.body?.result).toMatchObject({ protocolVersion: "2025-11-25" });

    const initialized = await rpc(handler, { era: "2025-06-18", method: "notifications/initialized", notification: true, token });
    expect(initialized.response.status).toBe(202);

    for (const era of ["2025-11-25", "2025-06-18", "2025-03-26"] as const) {
      const list = await rpc(handler, { era, method: "tools/list", token });
      expect(list.response.status).toBe(200);
      expect((list.body!.result as { tools: unknown[] }).tools.length).toBeGreaterThan(0);
      expect(list.body?.result).not.toHaveProperty("resultType");
    }

    const unsupported = await rpc(handler, { era: "2025-06-18", headers: { "mcp-protocol-version": "2024-11-05" }, method: "tools/list", token });
    expect(unsupported.response.status).toBe(400);
    expect(unsupported.body?.error?.code).toBe(-32022);
  });

  it("serves modern requests with discovery and the defined errors", async () => {
    const { handler, token } = await hostWithRequest();
    const discover = await rpc(handler, { method: "server/discover", token });
    expect(discover.body?.result).toMatchObject({
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "find-me-a-time" } },
      capabilities: { tools: {} },
      resultType: "complete",
      supportedVersions: ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"],
    });

    const mismatch = await rpc(handler, { headers: { "mcp-method": "tools/call" }, method: "tools/list", token });
    expect(mismatch.response.status).toBe(400);
    expect(mismatch.body?.error?.code).toBe(-32020);

    const nameMismatch = await rpc(handler, { headers: { "mcp-name": "list_requests" }, method: "tools/call", params: { arguments: {}, name: "get_host_status" }, token });
    expect(nameMismatch.body?.error?.code).toBe(-32020);

    const encoded = await rpc(handler, {
      headers: { "mcp-name": `=?base64?${Buffer.from("get_host_status").toString("base64")}?=` },
      method: "tools/call",
      params: { arguments: {}, name: "get_host_status" },
      token,
    });
    expect(encoded.response.status).toBe(200);

    const version = await handler(
      new Request(`${ORIGIN}/mcp`, {
        body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/list", params: { _meta: { "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/protocolVersion": "2099-01-01" } } }),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "mcp-method": "tools/list", "mcp-protocol-version": "2099-01-01" },
        method: "POST",
      }),
    );
    expect(version.status).toBe(400);
    expect(((await version.json()) as { error: { code: number; data: { supported: string[] } } }).error).toMatchObject({ code: -32022, data: { supported: expect.arrayContaining(["2026-07-28"]) } });

    const noCapabilities = await handler(
      new Request(`${ORIGIN}/mcp`, {
        body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } }),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "mcp-method": "tools/list", "mcp-protocol-version": "2026-07-28" },
        method: "POST",
      }),
    );
    expect(((await noCapabilities.json()) as { error: { code: number } }).error.code).toBe(-32602);

    const unknown = await rpc(handler, { method: "resources/list", token });
    expect(unknown.response.status).toBe(404);
    expect(unknown.body?.error?.code).toBe(-32601);
  });
});

describe("host tools", () => {
  it("lists only the tools the permissions allow and challenges a missing one", async () => {
    const { handler, token } = await hostWithRequest(["host:read"]);
    const list = await rpc(handler, { method: "tools/list", token });
    const names = (list.body!.result as { tools: { name: string; inputSchema: Record<string, unknown> }[] }).tools.map((tool) => tool.name);
    expect(names).toEqual(["get_host_status", "get_setup", "list_requests", "get_request"]);

    const write = await rpc(handler, { method: "tools/call", params: { arguments: {}, name: "suggest_changes" }, token });
    expect(write.response.status).toBe(403);
    expect(write.response.headers.get("www-authenticate")).toContain('error="insufficient_scope", resource_metadata=');
    expect(write.response.headers.get("www-authenticate")).toContain('scope="host:write"');
  });

  it("reads only the host's own requests in the host projection", async () => {
    const { handler, request, token } = await hostWithRequest();
    const other = await createTestRequest(db);

    const list = await callTool(handler, "/mcp", token, "list_requests");
    expect((list.structuredContent.requests as { requestId: string }[]).map((item) => item.requestId)).toEqual([request.requestId]);

    const mine = await callTool(handler, "/mcp", token, "get_request", { requestId: request.requestId });
    expect(mine.isError).toBe(false);
    expect(mine.structuredContent).toMatchObject({ requestId: request.requestId, state: "awaiting_host_approval" });
    expect(JSON.stringify(mine)).not.toContain(request.bookingId);

    const theirs = await callTool(handler, "/mcp", token, "get_request", { requestId: other.requestId });
    const unknown = await callTool(handler, "/mcp", token, "get_request", { requestId: randomUUID() });
    expect(theirs.isError).toBe(true);
    expect(theirs.structuredContent).toEqual(unknown.structuredContent);
    expect(theirs.structuredContent.error?.category).toBe("request_unavailable");

    const invalid = await callTool(handler, "/mcp", token, "get_request", { requestId: "not-a-uuid" });
    expect(invalid.structuredContent.error?.category).toBe("invalid_input");
  });

  it("approves the current version in the host's words, once, through the button's command", async () => {
    const { handler, request, token } = await hostWithRequest();
    const view = await callTool(handler, "/mcp", token, "get_request", { requestId: request.requestId });
    const { revision } = view.structuredContent as { revision: number };
    const version = (view.structuredContent.proposal as { version: number }).version;
    const args = { expectedRevision: revision, hostInstruction: "Yes, approve that one.", requestId: request.requestId, retryKey: "approve-0001", version };

    const approved = await callTool(handler, "/mcp", token, "approve_proposal", args);
    expect(approved.isError).toBe(false);
    expect(approved.structuredContent).toMatchObject({ outcome: { repeated: false, state: "reserved" }, request: { state: "booking" } });

    // The same call, and another key on the same version, observe the one booking.
    const again = await callTool(handler, "/mcp", token, "approve_proposal", args);
    expect(again.structuredContent.outcome).toEqual(approved.structuredContent.outcome);
    const otherKey = await callTool(handler, "/mcp", token, "approve_proposal", { ...args, retryKey: "approve-0002" });
    expect(otherKey.structuredContent.outcome).toMatchObject({ bookingId: (approved.structuredContent.outcome as { bookingId: string }).bookingId, repeated: true });

    const [{ approvals, bookings }] = Array.from(await db<{ approvals: number; bookings: number }[]>`
      select (select count(*)::int from app.approvals where request_id = ${request.requestId}) as approvals,
             (select count(*)::int from app.bookings where request_id = ${request.requestId}) as bookings
    `);
    expect([approvals, bookings]).toEqual([1, 1]);
  });

  it("refuses an old version, a stale revision and a missing host instruction", async () => {
    const { handler, request, token } = await hostWithRequest();
    const view = await callTool(handler, "/mcp", token, "get_request", { requestId: request.requestId });
    const { revision } = view.structuredContent as { revision: number };
    const version = (view.structuredContent.proposal as { version: number }).version;
    const base = { expectedRevision: revision, hostInstruction: "Approve it", requestId: request.requestId, version };

    const old = await callTool(handler, "/mcp", token, "approve_proposal", { ...base, retryKey: "approve-old-1", version: version + 1 });
    expect(old.structuredContent.error?.category).toBe("proposal_superseded");

    const stale = await callTool(handler, "/mcp", token, "approve_proposal", { ...base, expectedRevision: revision - 1, retryKey: "approve-stale-1" });
    expect(stale.structuredContent.error?.category).toBe("stale_revision");

    const { hostInstruction: _words, ...unasked } = base;
    const missing = await callTool(handler, "/mcp", token, "approve_proposal", { ...unasked, retryKey: "approve-none-1" });
    expect(missing.structuredContent.error?.category).toBe("invalid_input");
    const blank = await callTool(handler, "/mcp", token, "decline_request", { expectedRevision: revision, hostInstruction: "   ", requestId: request.requestId, retryKey: "decline-blank-1" });
    expect(blank.structuredContent.error?.category).toBe("invalid_input");

    const [{ count }] = Array.from(await db<{ count: number }[]>`select count(*)::int as count from app.approvals where request_id = ${request.requestId}`);
    expect(count).toBe(0);
    const [state] = await db<{ state: string }[]>`select state from app.requests where id = ${request.requestId}`;
    expect(state!.state).toBe("awaiting_host_approval");
  });

  it("declines in the host's words, replays the retry and refuses a closed request", async () => {
    const { handler, request, token } = await hostWithRequest();
    const view = await callTool(handler, "/mcp", token, "get_request", { requestId: request.requestId });
    const { revision } = view.structuredContent as { revision: number };
    const version = (view.structuredContent.proposal as { version: number }).version;
    const args = { expectedRevision: revision, hostInstruction: "Decline this, I'm away that week.", requestId: request.requestId, retryKey: "decline-0001" };

    const declined = await callTool(handler, "/mcp", token, "decline_request", args);
    expect(declined.structuredContent.error).toBeUndefined();
    expect(declined.structuredContent).toMatchObject({ outcome: { state: "declined" }, request: { state: "declined" } });
    const again = await callTool(handler, "/mcp", token, "decline_request", args);
    expect(again.structuredContent.outcome).toEqual(declined.structuredContent.outcome);

    const closed = await callTool(handler, "/mcp", token, "decline_request", { ...args, expectedRevision: revision + 1, retryKey: "decline-0002" });
    expect(closed.structuredContent.error?.category).toBe("request_closed");
    const late = await callTool(handler, "/mcp", token, "approve_proposal", { ...args, retryKey: "approve-late-1", version });
    expect(late.structuredContent.error?.category).toBe("request_closed");
  });

  it("keeps decisions to grants with host:decide and to the host's own requests", async () => {
    const { handler, request, token } = await hostWithRequest(["host:read", "host:write"]);
    const list = await rpc(handler, { method: "tools/list", token });
    const names = (list.body!.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
    expect(names).not.toContain("approve_proposal");
    expect(names).not.toContain("decline_request");

    const args = { expectedRevision: 0, hostInstruction: "Approve", requestId: request.requestId, retryKey: "approve-scope-1", version: 1 };
    const refused = await rpc(handler, { method: "tools/call", params: { arguments: args, name: "approve_proposal" }, token });
    expect(refused.response.status).toBe(403);
    expect(refused.response.headers.get("www-authenticate")).toContain('scope="host:decide"');

    const decider = await hostWithRequest();
    const { version: _version, ...declineArgs } = args;
    const theirs = await callTool(decider.handler, "/mcp", decider.token, "decline_request", { ...declineArgs, retryKey: "decline-foreign-1" });
    expect(theirs.structuredContent.error?.category).toBe("request_unavailable");

    const [state] = await db<{ state: string }[]>`select state from app.requests where id = ${request.requestId}`;
    expect(state!.state).toBe("awaiting_host_approval");
  });

  it("replays an identical retry and refuses a reused key with other input", async () => {
    const { handler, request, token } = await hostWithRequest();
    const start = new Date(Date.now() + 9 * 86_400_000).toISOString();
    const args = { input: { changes: { durationMinutes: 45, start } }, requestId: request.requestId, retryKey: "suggest-0001" };

    const first = await callTool(handler, "/mcp", token, "suggest_changes", args);
    expect(first.isError).toBe(false);
    const again = await callTool(handler, "/mcp", token, "suggest_changes", args);
    expect((again.structuredContent.outcome as { suggestionId: string }).suggestionId).toBe((first.structuredContent.outcome as { suggestionId: string }).suggestionId);

    const conflict = await callTool(handler, "/mcp", token, "suggest_changes", { ...args, input: { changes: { durationMinutes: 60 } } });
    expect(conflict.structuredContent.error).toMatchObject({ category: "retry_conflict" });

    const [{ count }] = Array.from(await db<{ count: number }[]>`select count(*)::int as count from app.shared_change_drafts where request_id = ${request.requestId}`);
    expect(count).toBe(1);
  });

  it("reports the host's status with a next step", async () => {
    const { handler, token } = await hostWithRequest();
    const status = await callTool(handler, "/mcp", token, "get_host_status");
    expect(status.structuredContent).toMatchObject({ workspace: `${ORIGIN}/app` });
    expect(typeof status.structuredContent.nextStep).toBe("string");
  });
});

it("sets meeting mode, place and travel mode only with hostWords, then confirms through MCP", async () => {
  const { seedHost, setupDependencies, prepareReviewableHost, draftRevision } = await import("./support/setup-host");
  const setupDeps = setupDependencies(db, google);
  const host = await seedHost(db, setupDeps, google, { displayName: "U08 Host" });
  await prepareReviewableHost(db, host);
  const agent = agentDependencies(db);
  const deps: McpDependencies = { appOrigin: ORIGIN, db, setup: setupDeps, signingKey: agent.signingKey, tokenKey: agent.tokenKey };
  const handler = createMcpHandler("host", () => deps);
  const tokens = await issueToken(agent, { hostAccountId: host.hostAccountId, resource: HOST_RESOURCE, role: "host", scopes: ["host:read", "host:write"] });
  const call = (name: string, args = {}) => callTool(handler, "/mcp", tokens.access_token, name, args);
  const initialRevision = await draftRevision(db, host.hostAccountId);
  const input = { action: "choose_own", field: "meetingMode", value: "either" };
  for (const hostWords of [undefined, "   ", "x".repeat(501)]) {
    expect((await call("update_setup_field", { expectedRevision: initialRevision, retryKey: randomUUID(), input, hostWords })).structuredContent.error?.category).toBe("invalid_input");
    expect((await call("confirm_setup", { expectedRevision: initialRevision, retryKey: randomUUID(), proposalHash: "a".repeat(64), hostWords })).structuredContent.error?.category).toBe("invalid_input");
  }
  expect(await draftRevision(db, host.hostAccountId)).toBe(initialRevision);
  for (const [field, value, hostWords] of [
    ["meetingMode", "either", "Online or in person near Yeoksam Station."],
    ["location", { kind: "places", areas: ["Yeoksam Station"], venue: null }, "Near Yeoksam Station."],
    ["travelMode", "transit", "I travel by subway."],
    ["durationMinutes", 45, "Make meetings 45 minutes by default."],
  ] as const) {
    const before = await call("get_setup");
    const draft = before.structuredContent.draft as { revision: number };
    const saved = await call("update_setup_field", { expectedRevision: draft.revision, retryKey: randomUUID(), input: { action: "choose_own", field, value }, hostWords });
    expect(saved.isError).toBe(false);
  }
  const review = await call("get_setup");
  expect(review.structuredContent.nextStep).toBe("Read the settings back to the host. When they agree, call confirm_setup with their words.");
  const confirmed = await call("confirm_setup", { expectedRevision: (review.structuredContent.draft as { revision: number }).revision, proposalHash: review.structuredContent.proposalHash, retryKey: randomUUID(), hostWords: "Looks good, confirm it." });
  expect(confirmed.isError).toBe(false);
  expect(confirmed.structuredContent).toMatchObject({ handle: host.local, next: "Setup is confirmed. Give the host the booking link to share. You are not notified of new requests: tell the host to ask you to check for requests, and use list_requests when they do." });
  const [settings] = await db<{ settings: Record<string, unknown> }[]>`select settings from app.host_settings where host_account_id = ${host.hostAccountId}`;
  expect(settings!.settings).toMatchObject({ meetingMode: "either", location: { areas: ["Yeoksam Station"] }, travelMode: "transit", durationMinutes: 45 });
  const receipts = await db`select to_jsonb(o) as receipt from app.command_outcomes o where resource_id = ${host.hostAccountId}`;
  expect(JSON.stringify(settings)).not.toContain("hostWords");
  expect(JSON.stringify(receipts)).not.toContain("Looks good, confirm it.");
});
