import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AGENT_SCOPES } from "../../lib/contracts/agent-access";
import { createMcpHandler } from "../../lib/server/agent-mcp";
import { parseScopes } from "../../lib/server/agent-grants";
import { agentDependencies, callTool, grantIdOf, HOST_RESOURCE, issueToken, mcpRequest, ORIGIN, tokenRequest } from "./support/agents";
import { testDatabase } from "./support/database";
import { newHostAccount, makeHostReady } from "./support/ready-host";
import { createTestRequest, testNotices } from "./support/requests";
import { startFakeGoogle, type FakeGoogle } from "./support/fake-google";
import { fakeGoogleConfig } from "./support/calendar-host";
import { seedSchedulingRequest, runEvaluation, evaluationDeps, revisionOf } from "./support/scheduling";
import { readCurrentEvaluation } from "../../lib/server/request-proposals";
import { approveCommand } from "../../lib/server/bookings";
import { asHost, bookingDeps, runBooking } from "./support/booking";
import { createGoogleUser } from "./support/auth";

const db = testDatabase();
let google: FakeGoogle;
beforeAll(async () => { google = await startFakeGoogle(); await db`delete from app.agent_protocol_attempts`; });
afterAll(async () => { await google.close(); await db.end(); });

async function setup(scopes: readonly string[] = AGENT_SCOPES) {
  const agent = agentDependencies(db);
  const accountId = await newHostAccount(db);
  // The account signed in with Google: its verified address is the requester's.
  const user = await createGoogleUser(db, `grace-${randomUUID()}@example.test`);
  await db`
    insert into app.google_identities (google_subject, host_account_id, auth_user_id, email)
    values (${user.googleSubject}, ${accountId}, ${user.userId}, ${user.email})
  `;
  const tokens = await issueToken(agent, { role: "host", hostAccountId: accountId, resource: HOST_RESOURCE, scopes });
  const handler = createMcpHandler("host", () => ({
    ...agent, setup: { db, appOrigin: ORIGIN, calendar: { db, config: fakeGoogleConfig(google), tokenKeys: [agent.tokenKey()] } }, evaluationWaitMs: 1, notices: () => testNotices,
  }));
  return { agent, accountId, email: user.email, tokens, handler, call: (name: string, args: Record<string, unknown> = {}) => callTool(handler, "/mcp", tokens.access_token, name, args) };
}

async function host() {
  const id = await newHostAccount(db);
  return { id, ...await makeHostReady(db, id) };
}
const input = (handle: string, retryKey = randomUUID()) => ({ hostHandle: handle, retryKey, timezone: "Asia/Seoul", details: { purpose: "Discuss compilers", mode: "online", durationMinutes: 30 } });

async function created(client: Awaited<ReturnType<typeof setup>>, handle: string) {
  const result = await client.call("create_request", input(handle));
  expect(result.structuredContent).toMatchObject({ created: true, requestId: expect.any(String) });
  return (result.structuredContent as { requestId: string }).requestId;
}

describe("account requester MCP", () => {
  it("advertises account request scopes without admitting host scopes on anonymous resources", () => {
    expect(parseScopes("host:read request:read request:write request:decide", "host")).toHaveLength(4);
    expect(parseScopes("host:read request:read", "requester")).toBeNull();
  });

  it("creates requests for two hosts and a second meeting with the first over one token", async () => {
    const client = await setup();
    const first = await host(); const second = await host();
    const ids = [await created(client, first.handle), await created(client, second.handle), await created(client, first.handle)];
    expect(new Set(ids).size).toBe(3);
    expect((await client.call("list_sent_requests")).structuredContent).toMatchObject({ requests: expect.arrayContaining(ids.map(requestId => expect.objectContaining({ requestId }))) });
    for (const requestId of ids) {
      const read = await client.call("get_sent_request", { requestId });
      expect(read.structuredContent).toMatchObject({ requestId, state: "gathering" });
      expect(read.structuredContent).not.toHaveProperty("bookingLink");
      expect(JSON.stringify(read)).not.toContain("/booking/");
    }
    const [count] = await db<{ count: number }[]>`select count(*)::int as count from app.requester_host_profiles where host_account_id = ${client.accountId}`;
    expect(count!.count).toBe(3);
  });

  // R01 P-2 and P-3 (account-request-identity): the account is the requester.
  it("identifies the request with the account and counts its host calendars without asking", async () => {
    const client = await setup(); const target = await host();
    await makeHostReady(db, client.accountId, { displayName: "Grace Hopper" });
    await db`
      update app.host_settings
      set settings = settings || ${db.json({ conflictCalendars: [{ accessRole: "owner", id: "grace@example.test", summary: "Personal" }], timezone: "Europe/Paris" })}
      where host_account_id = ${client.accountId}
    `;
    expect((await client.call("create_request", { name: "Someone", email: "someone@example.test", hostHandle: target.handle, retryKey: randomUUID() })).isError).toBe(true);
    const result = await client.call("create_request", { hostHandle: target.handle, retryKey: randomUUID(), details: { purpose: "Compilers" } });
    expect(result.structuredContent).toMatchObject({ created: true, requester: { name: "Grace Hopper", email: client.email }, calendars: ["Personal"] });
    expect(JSON.stringify(result)).not.toContain("/booking/");
    const requestId = (result.structuredContent as { requestId: string }).requestId;
    const [row] = await db<{ requester_name: string; contact_email: string; contact_confirmed_email: string | null; timezone: string; calendar_settled: boolean; items: string[]; decided: boolean }[]>`
      select r.requester_name, r.contact_email, r.contact_confirmed_email, r.details ->> 'timezone' as timezone,
             r.calendar_settled_at is not null as calendar_settled, p.items, p.decided_at is not null as decided
      from app.requests r join app.requester_host_profiles p on p.request_id = r.id
      where r.id = ${requestId} and p.host_account_id = ${client.accountId}
    `;
    expect(row).toEqual({ requester_name: "Grace Hopper", contact_email: client.email, contact_confirmed_email: client.email, timezone: "Europe/Paris", calendar_settled: true, items: ["calendars"], decided: true });
  });

  it("links an account without host settings with no calendars", async () => {
    const client = await setup(); const target = await host();
    const result = await client.call("create_request", input(target.handle));
    expect(result.structuredContent).toMatchObject({ created: true, calendars: [] });
    const requestId = (result.structuredContent as { requestId: string }).requestId;
    const [row] = await db<{ items: string[]; decided: boolean }[]>`
      select items, decided_at is not null as decided from app.requester_host_profiles where request_id = ${requestId}
    `;
    expect(row).toEqual({ items: [], decided: true });
  });

  it("serializes concurrent exact creation retries and rejects changed arguments", async () => {
    const client = await setup(); const target = await host(); const args = input(target.handle);
    const results = await Promise.all([client.call("create_request", args), client.call("create_request", args)]);
    expect(results[0].structuredContent).toMatchObject({ requestId: expect.any(String) });
    expect((results[0].structuredContent as { requestId: string }).requestId).toBe((results[1].structuredContent as { requestId: string }).requestId);
    expect(results.map(r => (r.structuredContent as { created: boolean }).created).sort()).toEqual([false, true]);
    expect((await client.call("create_request", { ...args, timezone: "Europe/London" })).structuredContent).toMatchObject({ error: { category: "retry_conflict" } });
  });

  it("hides unknown, another account's and same-email anonymous requests on reads and mutations", async () => {
    const owner = await setup(); const other = await setup(); const target = await host();
    const owned = await created(owner, target.handle);
    const anonymous = await createTestRequest(db, { hostAccountId: target.id, contactEmail: owner.email });
    for (const requestId of [owned, anonymous.requestId, randomUUID()]) {
      for (const name of ["get_sent_request", "find_times", "withdraw_request"]) {
        expect((await other.call(name, { requestId, arguments: name === "get_sent_request" ? {} : { retryKey: randomUUID() } })).structuredContent).toMatchObject({ error: { category: "request_unavailable" } });
      }
    }
    expect((await other.call("list_sent_requests")).structuredContent).toEqual({ requests: [] });
  });

  it("keeps received and sent tool names separate and host-only grants need new consent", async () => {
    const client = await setup(["host:read", "host:write", "host:decide"]);
    const response = await client.handler(mcpRequest("/mcp", { method: "tools/list", token: client.tokens.access_token }));
    const body = await response.json() as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map(t => t.name)).toContain("get_request");
    expect(body.result.tools.map(t => t.name)).not.toContain("create_request");
    const denied = await client.handler(mcpRequest("/mcp", { method: "tools/call", token: client.tokens.access_token, params: { name: "create_request", arguments: input("some-host") } }));
    expect(denied.status).toBe(403);
    expect(denied.headers.get("www-authenticate")).toContain('scope="request:write"');
    const expanded = await tokenRequest(client.agent, { grant_type: "refresh_token", client_id: "fmat-cli", refresh_token: client.tokens.refresh_token, resource: HOST_RESOURCE, scope: "request:read" });
    expect(expanded.status).toBe(400);
    expect(await expanded.json()).toMatchObject({ error: "invalid_scope" });
  });

  it("requires separate read, write and decision scopes on linked requests", async () => {
    const owner = await setup(); const target = await host(); const requestId = await created(owner, target.handle);
    const reader = await issueToken(owner.agent, { role: "host", hostAccountId: owner.accountId, resource: HOST_RESOURCE, scopes: ["request:read"] });
    const read = await callTool(owner.handler, "/mcp", reader.access_token, "get_sent_request", { requestId });
    expect(read.structuredContent).toMatchObject({ requestId });
    for (const name of ["withdraw_request", "agree_to_proposal", "find_times", "approve_proposal"]) {
      const response = await owner.handler(mcpRequest("/mcp", { method: "tools/call", token: reader.access_token, params: { name, arguments: { requestId } } }));
      expect(response.status).toBe(403);
    }
    const response = await owner.handler(mcpRequest("/mcp", { method: "tools/list", token: owner.tokens.access_token }));
    const body = await response.json() as { result: { tools: { name: string }[] } };
    const names = body.result.tools.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(["get_request", "get_sent_request", "cancel_booking", "cancel_sent_booking"]));
  });

  it("requires decision scope, enforces revision and reuses withdrawal closure rules", async () => {
    const client = await setup(); const target = await host(); const requestId = await created(client, target.handle);
    const read = (await client.call("get_sent_request", { requestId })).structuredContent as { revision: number };
    const action = { requestId, arguments: { retryKey: randomUUID(), expectedRevision: read.revision - 1 } };
    expect((await client.call("withdraw_request", action)).structuredContent).toMatchObject({ error: { category: "stale_revision" } });
    expect((await client.call("withdraw_request", { requestId, arguments: { retryKey: randomUUID(), expectedRevision: read.revision } })).structuredContent).toMatchObject({ request: { state: "withdrawn" } });
    expect((await client.call("get_sent_request", { requestId })).structuredContent).toMatchObject({ state: "withdrawn", open: false });
    expect((await client.call("find_times", { requestId, arguments: { retryKey: randomUUID() } })).structuredContent).toMatchObject({ error: { category: "request_closed" } });
  });

  it("chooses and agrees as requester, waits for the other host, then reads and cancels the booked meeting", async () => {
    const client = await setup();
    const request = await seedSchedulingRequest(db, google);
    const requestId = request.requestId;
    await db`insert into app.requester_host_profiles (request_id, host_account_id) values (${requestId}, ${client.accountId})`;
    const evaluated = await client.call("find_times", { requestId, arguments: { retryKey: randomUUID() } });
    expect(evaluated.isError).toBe(false);
    const evaluationId = (evaluated.structuredContent.outcome as { evaluationId: string }).evaluationId;
    await runEvaluation(db, evaluationDeps(db, google), evaluationId);
    const evaluation = await readCurrentEvaluation(db, requestId);
    expect(evaluation?.candidates.length).toBeGreaterThan(0);
    const chosen = await client.call("choose_time", { requestId, arguments: { retryKey: randomUUID(), expectedRevision: await revisionOf(db, requestId), input: { evaluationId, candidateId: evaluation!.candidates[0]!.id } } });
    expect(chosen.isError).toBe(false);
    const version = (chosen.structuredContent.outcome as { version: number }).version;
    const revision = (chosen.structuredContent.request as { revision: number }).revision;
    const stale = await client.call("agree_to_proposal", { requestId, arguments: { retryKey: randomUUID(), expectedRevision: revision, input: { version: version + 1 } } });
    expect(stale.structuredContent).toMatchObject({ error: { category: "proposal_superseded" } });
    const agreed = await client.call("agree_to_proposal", { requestId, arguments: { retryKey: randomUUID(), expectedRevision: revision, input: { version } } });
    expect(agreed.isError).toBe(false);
    expect(agreed.structuredContent).toMatchObject({ request: { state: "awaiting_host_approval" } });
    expect(agreed.structuredContent.next).toContain("get_sent_request");
    const approved = await asHost(db, request.hostAccountId, requestId, approveCommand, { version }, { expectedRevision: await revisionOf(db, requestId) });
    if (!approved.ok) throw new Error(`approve failed: ${approved.error.category}`);
    expect(await runBooking(db, bookingDeps(db, google), approved.result.bookingId)).toBe("completed");
    const booked = await client.call("get_sent_request", { requestId });
    expect(booked.structuredContent).toMatchObject({ state: "booked" });
    const cancelled = await client.call("cancel_sent_booking", { requestId, arguments: { retryKey: randomUUID(), expectedRevision: booked.structuredContent.revision } });
    expect(cancelled.isError).toBe(false);
    expect((await client.call("get_sent_request", { requestId })).structuredContent).toMatchObject({ state: "cancelled" });
  });

  it("refuses expired links and revocation, suspension, self-booking and paused targets", async () => {
    const client = await setup(); const target = await host(); const requestId = await created(client, target.handle);
    await db`update app.booking_links set expires_at = now() - interval '1 second' where request_id = ${requestId}`;
    expect((await client.call("get_sent_request", { requestId })).structuredContent).toMatchObject({ error: { category: "request_unavailable" } });
    await db`update app.host_accounts set accepting_requests = false where id = ${target.id}`;
    expect((await client.call("create_request", input(target.handle))).structuredContent).toMatchObject({ error: { category: "request_unavailable" } });
    const self = await makeHostReady(db, client.accountId);
    expect((await client.call("create_request", input(self.handle))).structuredContent).toMatchObject({ error: { category: "request_unavailable" } });
    await db`update app.agent_grants set revoked_at = now(), revoke_reason = 'host' where id = ${grantIdOf(client.tokens.access_token)}`;
    expect((await client.handler(mcpRequest("/mcp", { method: "tools/list", token: client.tokens.access_token }))).status).toBe(401);
  });
});
