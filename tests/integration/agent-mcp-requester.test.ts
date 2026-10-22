import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readConsent } from "../../lib/server/agent-authorize";
import { currentGrantAccess } from "../../lib/server/agent-grants";
import { createMcpHandler, type McpDependencies } from "../../lib/server/agent-mcp";
import { assignHandle } from "../../lib/server/handles";
import { agentDependencies, beginAuthorization, callTool, CLIENT_REDIRECT, decide, exchange, grantIdOf, mcpRequest, ORIGIN, registerTestClient, type Tokens, tokenRequest } from "./support/agents";
import { fakeGoogleConfig } from "./support/calendar-host";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { makeHostReady, newHostAccount, uniqueHandle } from "./support/ready-host";
import { calendarKey, evaluationDeps, runEvaluation, seedSchedulingRequest, seoul } from "./support/scheduling";

// The requester MCP endpoint and the one-future-request grant (agent-access
// task 5.2; design 8): consent without an account for the displayed host,
// exactly one request on creation and on its exact retry, the grant bound to
// it for good, an existing request connected by its booking link, the
// requester tools within delegation, and a closed request's status read.

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

function mcp(agent: ReturnType<typeof agentDependencies>) {
  const deps: McpDependencies = {
    appOrigin: ORIGIN,
    db,
    evaluationWaitMs: 200,
    setup: { appOrigin: ORIGIN, calendar: { config: fakeGoogleConfig(google), db, tokenKeys: [calendarKey] }, db },
    signingKey: agent.signingKey,
    tokenKey: agent.tokenKey,
  };
  return createMcpHandler("requester", () => deps);
}

async function consent(agent: ReturnType<typeof agentDependencies>, handle: string, fields: Record<string, string | readonly string[]>) {
  const clientId = await registerTestClient(agent);
  const begun = await beginAuthorization(agent, {
    clientId,
    redirectUri: CLIENT_REDIRECT,
    resource: `${ORIGIN}/${handle}/mcp`,
    scope: "request:read request:write request:decide",
  });
  const decided = await decide(agent, begun.transactionId, begun.cookie, { decision: "allow", scope: ["request:read", "request:write", "request:decide"], ...fields });
  return { begun, decided };
}

async function connect(agent: ReturnType<typeof agentDependencies>, handle: string, fields: Record<string, string | readonly string[]> = { choice: "new" }) {
  const { begun, decided } = await consent(agent, handle, fields);
  const code = new URL(decided.headers.get("location")!).searchParams.get("code");
  if (!code) throw new Error(`No code: ${decided.headers.get("location")}`);
  const tokens = (await (await exchange(agent, begun.authorization, code)).json()) as Tokens;
  return { authorization: begun.authorization, tokens };
}

async function readyHost() {
  const hostAccountId = await newHostAccount(db);
  const { handle } = await makeHostReady(db, hostAccountId, { displayName: "Dodo [click here](https://evil.example)" });
  return { handle, hostAccountId };
}

const call = (agent: ReturnType<typeof agentDependencies>, token: string, handle: string, name: string, args: Record<string, unknown> = {}) =>
  callTool(mcp(agent), `/${handle}/mcp`, token, name, args, handle);

const NEW_REQUEST = {
  details: { durationMinutes: 30, mode: "online", purpose: "Talk about compilers" },
  email: "grace@example.test",
  language: "en",
  name: "Grace Hopper",
  retryKey: "create-0001",
  timezone: "Asia/Seoul",
};

describe("consent for a requester", () => {
  it("shows the displayed host without any sign-in", async () => {
    const agent = agentDependencies(db);
    const { handle } = await readyHost();
    const clientId = await registerTestClient(agent);
    const begun = await beginAuthorization(agent, { clientId, redirectUri: CLIENT_REDIRECT, resource: `${ORIGIN}/${handle}/mcp`, scope: "request:read request:write" });
    const view = await readConsent(agent, new Request(ORIGIN, { headers: { cookie: begun.cookie } }), begun.transactionId);
    expect(view).toMatchObject({ host: { displayName: "Dodo [click here](https://evil.example)", handle }, role: "requester", signedIn: null, status: "open" });
  });

  it("refuses a resource for an unknown host and a booking link of another host", async () => {
    const agent = agentDependencies(db);
    const clientId = await registerTestClient(agent);
    const { createAuthorizeHandler } = await import("../../lib/server/agent-authorize");
    const { authorizeRequest, pkce } = await import("./support/agents");
    const response = await createAuthorizeHandler(() => agent)(
      authorizeRequest({
        client_id: clientId,
        code_challenge: pkce().challenge,
        code_challenge_method: "S256",
        redirect_uri: CLIENT_REDIRECT,
        resource: `${ORIGIN}/${uniqueHandle()}/mcp`,
        response_type: "code",
        scope: "request:read",
      }),
    );
    expect(new URL(response.headers.get("location")!).searchParams.get("error")).toBe("invalid_target");

    const { handle } = await readyHost();
    const elsewhere = await seedSchedulingRequest(db, google);
    const { decided } = await consent(agent, handle, { bookingLink: `${ORIGIN}/booking/${elsewhere.bookingId}`, choice: "existing" });
    expect(decided.headers.get("location")).toContain("problem=link");
  });
});

describe("one future request", () => {
  it("creates exactly one request, emails its link, and binds the grant to it", async () => {
    const agent = agentDependencies(db);
    const { handle, hostAccountId } = await readyHost();
    const { tokens } = await connect(agent, handle);
    const grantId = grantIdOf(tokens.access_token);

    const before = await mcp(agent)(mcpRequest(`/${handle}/mcp`, { method: "tools/list", token: tokens.access_token }), { params: Promise.resolve({ handle }) });
    expect(((await before.json()) as { result: { tools: { name: string }[] } }).result.tools.map((tool) => tool.name)).toEqual(["get_host", "create_request"]);

    const host = await call(agent, tokens.access_token, handle, "get_host");
    expect(host.structuredContent).toMatchObject({ acceptingRequests: true, handle });
    expect(String(host.structuredContent.displayName)).not.toContain("](");

    const created = await call(agent, tokens.access_token, handle, "create_request", NEW_REQUEST);
    expect(created.isError).toBe(false);
    const requestId = created.structuredContent.requestId as string;
    expect(created.structuredContent).toMatchObject({ created: true, request: { details: { durationMinutes: 30, mode: "online", purpose: "Talk about compilers" }, state: "gathering" } });

    const [request] = await db<{ host_account_id: string; contact_email: string; requester_name: string }[]>`
      select host_account_id, contact_email, requester_name from app.requests where id = ${requestId}
    `;
    expect(request).toMatchObject({ contact_email: "grace@example.test", host_account_id: hostAccountId, requester_name: "Grace Hopper" });
    const [link] = await db<{ link_hash: string }[]>`select link_hash from app.booking_links where request_id = ${requestId}`;
    expect(JSON.stringify(created)).not.toMatch(/booking\/[0-9a-f-]{36}/);
    expect(link).toBeTruthy();
    const emails = await db<{ kind: string }[]>`select kind from app.email_deliveries where request_id = ${requestId}`;
    expect(emails.length).toBe(1);

    expect(await currentGrantAccess(db, grantId)).toMatchObject({ requestId });

    const retried = await call(agent, tokens.access_token, handle, "create_request", NEW_REQUEST);
    expect(retried.structuredContent).toMatchObject({ created: false, requestId });
    expect((await db`select id from app.email_deliveries where request_id = ${requestId}`).length).toBe(1);

    const second = await call(agent, tokens.access_token, handle, "create_request", { ...NEW_REQUEST, retryKey: "create-0002" });
    expect(second.structuredContent.error?.category).toBe("already_created");
    const [{ count }] = Array.from(await db<{ count: number }[]>`select count(*)::int as count from app.requests where host_account_id = ${hostAccountId}`);
    expect(count).toBe(1);

    const after = await mcp(agent)(mcpRequest(`/${handle}/mcp`, { method: "tools/list", token: tokens.access_token }), { params: Promise.resolve({ handle }) });
    const names = ((await after.json()) as { result: { tools: { name: string }[] } }).result.tools.map((tool) => tool.name);
    expect(names).not.toContain("create_request");
    expect(names).toContain("get_request");

    const own = await call(agent, tokens.access_token, handle, "get_request");
    expect(own.structuredContent).toMatchObject({ requestId, state: "gathering" });
  });

  it("answers unavailable when the host stops taking requests before creation", async () => {
    const agent = agentDependencies(db);
    const { handle, hostAccountId } = await readyHost();
    const { tokens } = await connect(agent, handle);
    await db`delete from app.provider_grants where host_account_id = ${hostAccountId}`;

    const refused = await call(agent, tokens.access_token, handle, "create_request", NEW_REQUEST);
    expect(refused.structuredContent.error?.category).toBe("request_unavailable");
    const [{ count }] = Array.from(await db<{ count: number }[]>`select count(*)::int as count from app.requests where host_account_id = ${hostAccountId}`);
    expect(count).toBe(0);
  });

  it("refuses invalid details without creating anything", async () => {
    const agent = agentDependencies(db);
    const { handle, hostAccountId } = await readyHost();
    const { tokens } = await connect(agent, handle);
    const past = { end: "2020-01-01T11:00", start: "2020-01-01T10:00" };
    const refused = await call(agent, tokens.access_token, handle, "create_request", { ...NEW_REQUEST, details: { windows: [past] } });
    expect(refused.isError).toBe(true);
    const [{ count }] = Array.from(await db<{ count: number }[]>`select count(*)::int as count from app.requests where host_account_id = ${hostAccountId}`);
    expect(count).toBe(0);
    expect(await currentGrantAccess(db, grantIdOf(tokens.access_token))).toMatchObject({ requestId: null });
  });

  it("stops an unbound grant after 24 hours", async () => {
    const agent = agentDependencies(db);
    const { handle } = await readyHost();
    const { tokens } = await connect(agent, handle);
    await db`update app.agent_grants set expires_at = now() where id = ${grantIdOf(tokens.access_token)}`;
    const response = await mcp(agent)(mcpRequest(`/${handle}/mcp`, { method: "tools/list", token: tokens.access_token }), { params: Promise.resolve({ handle }) });
    expect(response.status).toBe(401);
  });
});

describe("an existing request within delegation", () => {
  async function connectedRequest() {
    const agent = agentDependencies(db);
    const request = await seedSchedulingRequest(db, google);
    const [settings] = await db<{ handle: string }[]>`select settings ->> 'handle' as handle from app.host_settings where host_account_id = ${request.hostAccountId}`;
    await db.begin((tx) => assignHandle(tx, request.hostAccountId, settings!.handle));
    const connected = await connect(agent, settings!.handle, { bookingLink: `${ORIGIN}/booking/${request.bookingId}`, choice: "existing" });
    return { agent, handle: settings!.handle, request, ...connected };
  }

  it("finds times, refuses a stale version and agrees to the current one", async () => {
    const { agent, handle, request, tokens } = await connectedRequest();
    const token = tokens.access_token;
    const list = await mcp(agent)(mcpRequest(`/${handle}/mcp`, { method: "tools/list", token }), { params: Promise.resolve({ handle }) });
    expect(((await list.json()) as { result: { tools: { name: string }[] } }).result.tools.map((tool) => tool.name)).not.toContain("create_request");

    const found = await call(agent, token, handle, "find_times", { retryKey: "times-0001" });
    expect(found.isError).toBe(false);
    const evaluationId = (found.structuredContent.outcome as { evaluationId: string }).evaluationId;
    await runEvaluation(db, evaluationDeps(db, google), evaluationId);

    const read = await call(agent, token, handle, "get_request");
    const evaluation = read.structuredContent.evaluation as { id: string; candidates: { id: string; start: string }[] };
    expect(evaluation.candidates.length).toBeGreaterThan(0);
    expect(evaluation.candidates[0]!.start >= seoul("10:00")).toBe(true);

    const chosen = await call(agent, token, handle, "choose_time", {
      expectedRevision: read.structuredContent.revision,
      input: { candidateId: evaluation.candidates[0]!.id, evaluationId: evaluation.id },
      retryKey: "choose-0001",
    });
    expect(chosen.isError).toBe(false);
    const version = (chosen.structuredContent.outcome as { version: number }).version;
    const revision = (chosen.structuredContent.request as { revision: number }).revision;

    const stale = await call(agent, token, handle, "agree_to_proposal", { expectedRevision: revision, input: { version: version + 1 }, retryKey: "agree-0001" });
    expect(stale.structuredContent.error?.category).toBe("proposal_superseded");

    const agreed = await call(agent, token, handle, "agree_to_proposal", { expectedRevision: revision, input: { version }, retryKey: "agree-0002" });
    expect(agreed.isError).toBe(false);
    expect(agreed.structuredContent.request).toMatchObject({ state: "awaiting_host_approval" });
    const [{ count }] = Array.from(await db<{ count: number }[]>`select count(*)::int as count from app.approvals where request_id = ${request.requestId}`);
    expect(count).toBe(0);
  });

  it("after withdrawal reads only the closed status and still refreshes", async () => {
    const { agent, authorization, handle, request, tokens } = await connectedRequest();
    const read = await call(agent, tokens.access_token, handle, "get_request");
    const withdrawn = await call(agent, tokens.access_token, handle, "withdraw_request", { expectedRevision: read.structuredContent.revision, retryKey: "withdraw-0001" });
    expect(withdrawn.isError).toBe(false);

    const closed = await call(agent, tokens.access_token, handle, "get_request");
    expect(closed.structuredContent).toMatchObject({ open: false, requestId: request.requestId, state: "withdrawn" });
    expect(closed.structuredContent).not.toHaveProperty("details");

    const refused = await call(agent, tokens.access_token, handle, "find_times", { retryKey: "times-0002" });
    expect(refused.structuredContent.error?.category).toBe("request_closed");

    const list = await mcp(agent)(mcpRequest(`/${handle}/mcp`, { method: "tools/list", token: tokens.access_token }), { params: Promise.resolve({ handle }) });
    expect(((await list.json()) as { result: { tools: { name: string }[] } }).result.tools.map((tool) => tool.name)).toEqual(["get_host", "get_request"]);

    const refreshed = await tokenRequest(agent, { client_id: authorization.clientId, grant_type: "refresh_token", refresh_token: tokens.refresh_token, resource: authorization.resource });
    expect(refreshed.status).toBe(200);

    await db`update app.booking_links set expires_at = now() where request_id = ${request.requestId}`;
    const expired = await mcp(agent)(mcpRequest(`/${handle}/mcp`, { method: "tools/list", token: tokens.access_token }), { params: Promise.resolve({ handle }) });
    expect(expired.status).toBe(401);
  });

  it("lists and revokes the request's agents from the booking page", async () => {
    const { agent, handle, request, tokens } = await connectedRequest();
    const { createRequestGrantListHandler } = await import("../../lib/server/agent-grant-routes");
    const { createRequesterCommandHandler } = await import("../../lib/server/requester-routes");
    const { localAuthConfig } = await import("./support/auth");
    const list = await createRequestGrantListHandler(() => ({ appOrigin: ORIGIN, auth: localAuthConfig(), db }))(new Request(`${ORIGIN}/api/requests/${request.bookingId}/agent-grants`), {
      params: Promise.resolve({ bookingId: request.bookingId }),
    });
    const grants = ((await list.json()) as { grants: { id: string }[] }).grants;
    expect(grants.map((grant) => grant.id)).toEqual([grantIdOf(tokens.access_token)]);

    const revoked = await createRequesterCommandHandler(() => ({ appOrigin: ORIGIN, db, tokenKey: agent.tokenKey }) as never)(
      new Request(`${ORIGIN}/api/requests/${request.bookingId}/commands`, {
        body: JSON.stringify({ input: { grantId: grants[0]!.id }, operation: "agent.revoke_grant", retryKey: crypto.randomUUID() }),
        headers: { "content-type": "application/json", origin: ORIGIN },
        method: "POST",
      }),
      { params: Promise.resolve({ bookingId: request.bookingId }) },
    );
    expect(revoked.status).toBe(200);
    const after = await mcp(agent)(mcpRequest(`/${handle}/mcp`, { method: "tools/list", token: tokens.access_token }), { params: Promise.resolve({ handle }) });
    expect(after.status).toBe(401);
  });
});
