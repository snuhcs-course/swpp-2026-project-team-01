import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpHandler, type McpDependencies } from "../../lib/server/agent-mcp";
import { openConnectLink, sealConnectLink } from "../../lib/server/connect-link";
import { createConnectLinkHandler } from "../../lib/server/connect-link-routes";
import { agentDependencies, callTool, issueToken, ORIGIN } from "./support/agents";
import { localAuthConfig, signInHost } from "./support/auth";
import { testDatabase } from "./support/database";
import { startFakePhoton, type FakePhoton } from "./support/fake-photon";
import { imessageHarness, unreachableSetup } from "./support/imessage";
import { newSender, TEST_LINE, TEST_WHATSAPP_NUMBER } from "./support/photon";
import { makeHostReady } from "./support/ready-host";
import { createTestRequest, testTokenKey } from "./support/requests";

const db = testDatabase();
let photon: FakePhoton;
const im = imessageHarness(db, () => photon);
const options = { origin: ORIGIN, lineNumber: TEST_LINE, whatsappNumber: TEST_WHATSAPP_NUMBER, telegramUsername: "test_bot", tokenKey: testTokenKey, tokenKeys: [testTokenKey], registrar: im.registrar };
const page = createConnectLinkHandler(() => ({ ...options, appOrigin: ORIGIN, auth: localAuthConfig(), db, lineDayLimit: 10000 }));
beforeAll(async () => { photon = await startFakePhoton(); });
afterAll(async () => { await photon.close(); await db.end(); });

async function connected(role: "host" | "requester", configured = true) {
  const host = await signInHost(db);
  const request = await createTestRequest(db, { hostAccountId: host.hostAccountId });
  const { handle } = await makeHostReady(db, host.hostAccountId);
  const agent = agentDependencies(db);
  const resource = role === "host" ? `${ORIGIN}/mcp` : `${ORIGIN}/${handle}/mcp`;
  const tokens = await issueToken(agent, { hostAccountId: host.hostAccountId, requestId: role === "requester" ? request.requestId : undefined, role, resource, scopes: role === "host" ? ["host:read", "host:write"] : ["request:read", "request:write"] });
  const deps: McpDependencies = { appOrigin: ORIGIN, db, setup: unreachableSetup(db), signingKey: agent.signingKey, tokenKey: agent.tokenKey, chatLinkOptions: configured ? options : { ...options, lineNumber: "", whatsappNumber: "", telegramUsername: "" } };
  const handler = createMcpHandler(role, () => deps);
  const call = (name: string, args = {}) => callTool(handler, new URL(resource).pathname, tokens.access_token, name, args, role === "requester" ? handle : undefined);
  const start = (extra = {}) => call(role === "host" ? "start_chat_link" : "start_updates_link", { channel: "imessage", number: newSender(), retryKey: randomUUID(), ...extra });
  return { role, host, request, call, start };
}
function tokenOf(start: { structuredContent: Record<string, unknown> }) {
  return new URL(String(start.structuredContent.linkUrl)).pathname.split("/").at(-1)!;
}
function get(token: string, cookie = "") { return page(new Request(`${ORIGIN}/connect/link/${token}/status`, { headers: { cookie } }), token); }
function post(token: string, action: string, cookie = "", extra = {}) {
  return page(new Request(`${ORIGIN}/connect/link/${token}/confirm`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", cookie }, body: JSON.stringify({ action, retryKey: randomUUID(), ...extra }) }), token);
}

for (const role of ["host", "requester"] as const) describe(`${role} link started through MCP`, () => {
  it("confirms only after receipt, reports status, queues the usual welcome and closes the token", async () => {
    const client = await connected(role);
    const stateTool = role === "host" ? "get_host_status" : "get_request";
    const stateKey = role === "host" ? "chat" : "updates";
    expect((await client.call(stateTool)).structuredContent[stateKey]).toMatchObject({ state: "none" });
    const started = await client.start();
    expect(started.isError).toBe(false);
    expect(started.structuredContent).toMatchObject({ channel: "imessage", next: "Give the person this link. On that page they send a code from their own phone and confirm. Nothing is linked until they do." });
    expect(JSON.stringify(started.structuredContent)).not.toContain("/booking/");
    const token = tokenOf(started);
    const cookie = role === "host" ? client.host.cookie : "";
    if (role === "host") expect(await (await get(token)).json()).toEqual({ state: "sign_in" });
    const pending = await (await get(token, cookie)).json();
    expect(pending).toMatchObject({ state: "open", status: { state: "pending" } });
    expect((await client.call(stateTool)).structuredContent[stateKey]).toMatchObject({ channel: "imessage", state: "pending", sender: null });
    expect((await post(token, "confirm", cookie)).status).toBe(409);
    const sender = newSender();
    expect((await im.deliver({ sender, text: pending.status.message })).outcome).toBe("link_received");
    const received = await (await get(token, cookie)).json();
    expect(received).toMatchObject({ state: "open", status: { state: "received", sender } });
    const confirmed = await post(token, "confirm", cookie);
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({ state: "linked", message: "Linked. You can go back to your agent." });
    expect((await client.call(stateTool)).structuredContent[stateKey]).toMatchObject({ channel: "imessage", state: "linked", sender });
    expect(await (await get(token, cookie)).json()).toEqual({ state: "closed" });
    expect((await post(token, "confirm", cookie)).status).toBe(410);
    const outbox = role === "host" ? await im.outbox({ hostAccountId: client.host.hostAccountId }) : await db<{ kind: string }[]>`select kind from app.imessage_outbox where request_id = ${client.request.requestId}`;
    expect(outbox.some(row => row.kind === "linked")).toBe(true);
    expect(JSON.stringify(received)).not.toMatch(/\/booking\/|purpose|requestId/);
  });

  it("ends cancelled, expired and replaced attempts without affecting a new attempt", async () => {
    const client = await connected(role);
    const cookie = role === "host" ? client.host.cookie : "";
    const first = tokenOf(await client.start());
    const second = tokenOf(await client.start());
    expect(await (await get(first, cookie)).json()).toEqual({ state: "closed" });
    expect((await post(first, "cancel", cookie)).status).toBe(410);
    expect(await (await get(second, cookie)).json()).toMatchObject({ state: "open" });
    expect((await post(second, "cancel", cookie)).status).toBe(200);
    expect(await (await get(second, cookie)).json()).toEqual({ state: "closed" });
    const third = tokenOf(await client.start());
    const payload = openConnectLink([testTokenKey], third)!;
    await db`update app.imessage_links set expires_at = now() - interval '1 second' where id = ${payload.linkId}`;
    expect(await (await get(third, cookie)).json()).toEqual({ state: "closed" });
    expect((await post(third, "confirm", cookie)).status).toBe(410);
  });

  it("preserves the unconfigured-channel and hourly-limit guards", async () => {
    const absent = await connected(role, false);
    expect((await absent.start()).structuredContent).toMatchObject({ error: { category: "unavailable_configuration" } });
    const client = await connected(role);
    for (let index = 0; index < 5; index++) expect((await client.start()).isError).toBe(false);
    expect((await client.start()).structuredContent).toMatchObject({ error: { category: "rate_limited" } });
  });
});

it("rejects another host's session and foreign-origin mutations", async () => {
  const client = await connected("host");
  const other = await signInHost(db);
  const token = tokenOf(await client.start());
  expect(await (await get(token, other.cookie)).json()).toEqual({ state: "closed" });
  expect((await post(token, "confirm", other.cookie)).status).toBe(410);
  const foreign = await page(new Request(`${ORIGIN}/connect/link/${token}/confirm`, { method: "POST", headers: { origin: "https://evil.example" } }), token);
  expect(foreign.status).toBe(403);
});

it("cannot retarget a requester token to another attempt or pass an attempt ID", async () => {
  const client = await connected("requester");
  const first = tokenOf(await client.start());
  const second = tokenOf(await client.start());
  const secondId = openConnectLink([testTokenKey], second)!.linkId;
  expect((await post(first, "confirm", "", { linkId: secondId })).status).toBe(400);
  const wrongRole = sealConnectLink(testTokenKey, { role: "host", linkId: secondId });
  expect(await (await get(wrongRole)).json()).toEqual({ state: "closed" });
  const parts = second.split(".");
  parts[parts.length - 1] = "tampered";
  expect(await (await get(parts.join("."))).json()).toEqual({ state: "closed" });
});

it("refuses starting updates for a closed request", async () => {
  const client = await connected("requester");
  await db`update app.requests set state = 'withdrawn', closed_at = now() where id = ${client.request.requestId}`;
  expect((await client.start()).structuredContent).toMatchObject({ error: { category: "request_closed" } });
});
