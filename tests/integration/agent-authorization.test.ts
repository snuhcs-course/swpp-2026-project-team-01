import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthorizeHandler, readConsent } from "../../lib/server/agent-authorize";
import { accessFromClaims, currentGrantAccess } from "../../lib/server/agent-grants";
import {
  createAuthorizationServerMetadataHandler,
  createHostResourceMetadataHandler,
  createJwksHandler,
  createRegistrationHandler,
  createRequesterResourceMetadataHandler,
  createRevocationHandler,
} from "../../lib/server/agent-oauth-routes";
import { verifyAccessToken } from "../../lib/server/agent-tokens";
import { createGoogleCallbackHandler, createGoogleSignInHandler } from "../../lib/server/google-sign-in";
import { createGrantedScopesFetcher } from "../../lib/server/google-token-info";
import {
  agentDependencies,
  authorizeRequest,
  beginAuthorization,
  CLIENT_REDIRECT,
  connectHost,
  decide,
  exchange,
  grantIdOf,
  HOST_RESOURCE,
  ORIGIN,
  pkce,
  registerTestClient,
  type Tokens,
  tokenRequest,
} from "./support/agents";
import { completeGoogleLeg, cookieHeader, createGoogleUser, localAuthConfig, signInHost, UNBOUNDED_SIGN_UPS } from "./support/auth";
import { testDatabase } from "./support/database";
import { makeHostReady, newHostAccount } from "./support/ready-host";

// The authorization server (agent-access tasks 3.1 and 3.2; design 2, 3, 5 and
// 7): discovery, registration, the authorization request's validation order,
// consent for hosts with the sign-in return, single-use codes, refresh
// rotation and replay, revocation and the current-grant check.

const db = testDatabase();

beforeAll(async () => {
  // The bounds count per hashed key across runs of the disposable database.
  await db`delete from app.agent_protocol_attempts`;
});

afterAll(async () => {
  await db.end();
});

describe("discovery", () => {
  it("publishes authorization server and resource metadata for the addressed origin", async () => {
    const deps = agentDependencies(db);
    const server = (await (await createAuthorizationServerMetadataHandler(() => deps)(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))).json()) as Record<string, unknown>;
    expect(server).toMatchObject({
      authorization_endpoint: `${ORIGIN}/connect/authorize`,
      authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: true,
      code_challenge_methods_supported: ["S256"],
      issuer: ORIGIN,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      token_endpoint_auth_methods_supported: ["none"],
    });

    const resource = (await (await createHostResourceMetadataHandler(() => deps)(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`))).json()) as Record<string, unknown>;
    expect(resource).toEqual(expect.objectContaining({ authorization_servers: [ORIGIN], resource: HOST_RESOURCE, scopes_supported: ["host:read", "host:write", "host:decide"] }));

    const unknown = await createHostResourceMetadataHandler(() => deps)(new Request("http://evil.example/.well-known/oauth-protected-resource"));
    expect(unknown.status).toBe(421);
  });

  it("names a ready host's requester resource and answers the same not-found for any other handle", async () => {
    const deps = agentDependencies(db);
    const hostAccountId = await newHostAccount(db);
    const { handle } = await makeHostReady(db, hostAccountId);
    const metadataOf = (name: string) =>
      createRequesterResourceMetadataHandler(() => deps)(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/${name}/mcp`), {
        params: Promise.resolve({ handle: name }),
      });

    const ready = await metadataOf(handle);
    expect(await ready.json()).toMatchObject({ resource: `${ORIGIN}/${handle}/mcp`, scopes_supported: ["request:read", "request:write", "request:decide"] });

    await db`update app.host_accounts set status = 'suspended' where id = ${hostAccountId}`;
    const suspended = await metadataOf(handle);
    const missing = await metadataOf("no-such-host-anywhere");
    expect(suspended.status).toBe(404);
    expect(await suspended.text()).toBe(await missing.text());
  });

  it("publishes only the public key, and none without a signing key", async () => {
    const deps = agentDependencies(db);
    const set = (await (await createJwksHandler(() => deps)()).json()) as { keys: Record<string, unknown>[] };
    expect(set.keys).toHaveLength(1);
    expect(set.keys[0]).not.toHaveProperty("d");

    const none = agentDependencies(db, { signingKey: null });
    expect(await (await createJwksHandler(() => none)()).json()).toEqual({ keys: [] });
  });
});

describe("registration", () => {
  it("registers a public client and refuses redirects that are not https or loopback", async () => {
    const deps = agentDependencies(db);
    const register = (body: unknown) =>
      createRegistrationHandler(() => deps)(
        new Request(`${ORIGIN}/oauth/register`, { body: JSON.stringify(body), headers: { "content-type": "application/json" }, method: "POST" }),
      );

    const created = await register({ client_name: "Agent", redirect_uris: ["http://127.0.0.1:4000/cb"], token_endpoint_auth_method: "client_secret_basic" });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ grant_types: ["authorization_code", "refresh_token"], token_endpoint_auth_method: "none" });

    for (const uri of ["http://agent.example/cb", "https://agent.example/cb#frag", "myapp://callback"]) {
      const refused = await register({ client_name: "Agent", redirect_uris: [uri] });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: "invalid_redirect_uri" });
    }
  });

  it("bounds registrations per source and grants nothing", async () => {
    const deps = agentDependencies(db);
    for (let index = 0; index < 10; index += 1) await registerTestClient(deps);

    const refused = await createRegistrationHandler(() => deps)(
      new Request(`${ORIGIN}/oauth/register`, {
        body: JSON.stringify({ client_name: "Agent", redirect_uris: [CLIENT_REDIRECT] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);

    const [{ count }] = Array.from(await db<{ count: number }[]>`
      select count(*)::int as count from app.agent_grants g join app.agent_clients c on c.id = g.client_id
      where c.registration_source_hash is not null and g.created_at > now() - interval '1 minute'
    `);
    expect(count).toBe(0);
  });
});

describe("the authorization request", () => {
  it("shows an error page, never a redirect, until the client and redirect URI are known", async () => {
    const deps = agentDependencies(db);
    const clientId = await registerTestClient(deps);
    const authorize = createAuthorizeHandler(() => deps);
    const base = { client_id: clientId, redirect_uri: CLIENT_REDIRECT, response_type: "code" };

    for (const params of [
      { ...base, client_id: "dcr_unknown" },
      { ...base, redirect_uri: "https://attacker.example/callback" },
      { ...base, redirect_uri: "" },
    ]) {
      const response = await authorize(authorizeRequest(params));
      expect(response.status).toBe(400);
      expect(response.headers.get("location")).toBeNull();
    }

    const repeated = new Request(`${ORIGIN}/connect/authorize?client_id=${clientId}&client_id=${clientId}&redirect_uri=${encodeURIComponent(CLIENT_REDIRECT)}`);
    expect((await authorize(repeated)).headers.get("location")).toBeNull();
  });

  it("returns protocol errors to the client with its state and our issuer", async () => {
    const deps = agentDependencies(db);
    const clientId = await registerTestClient(deps);
    const authorize = createAuthorizeHandler(() => deps);
    const { challenge } = pkce();
    const valid = {
      client_id: clientId,
      code_challenge: challenge,
      code_challenge_method: "S256",
      redirect_uri: CLIENT_REDIRECT,
      resource: HOST_RESOURCE,
      response_type: "code",
      scope: "host:read",
      state: "s1",
    };
    const errorOf = async (params: Record<string, string>) => {
      const location = new URL((await authorize(authorizeRequest(params))).headers.get("location")!);
      expect(location.origin + location.pathname).toBe(CLIENT_REDIRECT);
      expect(location.searchParams.get("iss")).toBe(ORIGIN);
      expect(location.searchParams.get("state")).toBe("s1");
      return location.searchParams.get("error");
    };

    expect(await errorOf({ ...valid, response_type: "token" })).toBe("unsupported_response_type");
    expect(await errorOf({ ...valid, code_challenge_method: "plain" })).toBe("invalid_request");
    expect(await errorOf({ ...valid, code_challenge: "short" })).toBe("invalid_request");
    expect(await errorOf({ ...valid, resource: "https://other.example/mcp" })).toBe("invalid_target");
    expect(await errorOf({ ...valid, resource: `${ORIGIN}/mcp/` })).toBe("invalid_target");
    expect(await errorOf({ ...valid, scope: "request:write" })).toBe("invalid_scope");
    expect(await errorOf({ ...valid, scope: "host:read host:admin" })).toBe("invalid_scope");
    expect(await errorOf({ ...valid, scope: "" })).toBe("invalid_scope");

    const [{ count }] = Array.from(await db<{ count: number }[]>`
      select count(*)::int as count from app.agent_authorization_transactions where client_id = ${clientId}
    `);
    expect(count).toBe(0);
  });

  it("accepts a client ID metadata document only when it names itself", async () => {
    const id = `https://client-${Date.now()}.example.test/oauth/client.json`;
    const document = { client_id: id, client_name: "Metadata Agent", redirect_uris: [CLIENT_REDIRECT] };
    const fetched: string[] = [];
    const deps = agentDependencies(db, {
      fetchMetadata: async (url) => {
        fetched.push(url);
        return { body: JSON.stringify(document), maxAgeSeconds: 600 };
      },
    });
    const begun = await beginAuthorization(deps, { clientId: id, redirectUri: CLIENT_REDIRECT, resource: HOST_RESOURCE, scope: "host:read" });
    expect(begun.transactionId).toBeTruthy();
    expect(fetched).toEqual([id]);

    const otherId = `https://other-${Date.now()}.example.test/oauth/client.json`;
    const lying = agentDependencies(db, { fetchMetadata: async () => ({ body: JSON.stringify(document), maxAgeSeconds: null }) });
    const response = await createAuthorizeHandler(() => lying)(
      authorizeRequest({ client_id: otherId, redirect_uri: CLIENT_REDIRECT, response_type: "code" }),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();

    const insecure = await createAuthorizeHandler(() => lying)(
      authorizeRequest({ client_id: "http://client.example.test/client.json", redirect_uri: CLIENT_REDIRECT }),
    );
    expect(insecure.status).toBe(400);
  });
});

describe("host consent", () => {
  it("narrows the grant to the permissions left checked", async () => {
    const deps = agentDependencies(db);
    const host = await signInHost(db);
    const { tokens } = await connectHost(deps, host.cookie, { allow: ["host:read"] });
    expect(tokens.scope).toBe("host:read");

    const claims = verifyAccessToken(deps.signingKey(), tokens.access_token, { audience: HOST_RESOURCE, issuer: ORIGIN })!;
    expect(claims.scope).toBe("host:read");
    expect(claims.sub).toBe(`host:${host.hostAccountId}`);
    expect(await accessFromClaims(db, claims)).toMatchObject({ hostAccountId: host.hostAccountId, role: "host", scopes: ["host:read"] });
  });

  it("asks a signed-out host to sign in and creates nothing until Allow", async () => {
    const deps = agentDependencies(db);
    const clientId = await registerTestClient(deps);
    const begun = await beginAuthorization(deps, { clientId, redirectUri: CLIENT_REDIRECT, resource: HOST_RESOURCE, scope: "host:read" });

    const view = await readConsent(deps, new Request(ORIGIN, { headers: { cookie: begun.cookie } }), begun.transactionId);
    expect(view).toMatchObject({ clientName: "Test Agent", redirectHost: "agent.example.test", signedIn: "signed_out", status: "open" });

    const refused = await decide(deps, begun.transactionId, begun.cookie, { decision: "allow", scope: "host:read" });
    expect(refused.headers.get("location")).toBe(`${ORIGIN}/connect/consent?transaction=${begun.transactionId}&problem=sign_in`);
    const [{ count }] = Array.from(await db<{ count: number }[]>`select count(*)::int as count from app.agent_grants where client_id = ${clientId}`);
    expect(count).toBe(0);
  });

  it("returns from Google sign-in to the live transaction, and to /app once it is stale", async () => {
    const deps = agentDependencies(db);
    const clientId = await registerTestClient(deps);
    const begun = await beginAuthorization(deps, { clientId, redirectUri: CLIENT_REDIRECT, resource: HOST_RESOURCE, scope: "host:read" });
    const signInDeps = {
      appOrigin: ORIGIN,
      auth: localAuthConfig(),
      db,
      fetchGrantedScopes: createGrantedScopesFetcher("http://127.0.0.1:9/tokeninfo"),
      signUpLimits: UNBOUNDED_SIGN_UPS,
      tokenKey: deps.tokenKey(),
    };

    const signIn = async (transactionId: string, stale: boolean) => {
      const user = await createGoogleUser(db);
      const start = await createGoogleSignInHandler(() => signInDeps)(
        new Request(`${ORIGIN}/auth/sign-in?return=consent&transaction=${transactionId}`),
      );
      const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
      expect(authorize.status).toBeGreaterThanOrEqual(300);
      const challenge = new URL(start.headers.get("location")!).searchParams.get("code_challenge")!;
      const code = await completeGoogleLeg(db, challenge, user.userId, { accessToken: "ya29.test", refreshToken: null });
      if (stale) await db`update app.agent_authorization_transactions set expires_at = now() where id = ${transactionId}`;
      return createGoogleCallbackHandler(() => signInDeps)(
        new Request(`${ORIGIN}/auth/callback?code=${code}`, { headers: { cookie: cookieHeader(start) } }),
      );
    };

    const live = await signIn(begun.transactionId, false);
    expect(live.headers.get("location")).toBe(`${ORIGIN}/connect/consent?transaction=${begun.transactionId}`);
    expect(live.headers.getSetCookie().some((cookie) => cookie.startsWith("fmat_auth_return=;"))).toBe(true);

    const second = await beginAuthorization(deps, { clientId, redirectUri: CLIENT_REDIRECT, resource: HOST_RESOURCE, scope: "host:read" });
    const stale = await signIn(second.transactionId, true);
    expect(stale.headers.get("location")).toBe(`${ORIGIN}/app`);

    // A transaction that does not exist is never recorded at all.
    const unknown = await createGoogleSignInHandler(() => signInDeps)(
      new Request(`${ORIGIN}/auth/sign-in?return=consent&transaction=00000000-0000-4000-8000-000000000000`),
    );
    expect(unknown.headers.getSetCookie().find((cookie) => cookie.startsWith("fmat_auth_return="))).toMatch(/^fmat_auth_return=;/);
  });

  it("records Deny once, and refuses a decision from another browser", async () => {
    const deps = agentDependencies(db);
    const host = await signInHost(db);
    const clientId = await registerTestClient(deps);
    const begun = await beginAuthorization(deps, { clientId, redirectUri: CLIENT_REDIRECT, resource: HOST_RESOURCE, scope: "host:read" }, host.cookie);

    const elsewhere = await decide(deps, begun.transactionId, host.cookie, { decision: "allow", scope: "host:read" });
    expect(elsewhere.status).toBe(400);
    expect(elsewhere.headers.get("location")).toBeNull();

    const denied = await decide(deps, begun.transactionId, begun.cookie, { decision: "deny" });
    const location = new URL(denied.headers.get("location")!);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe(begun.authorization.state);

    const again = await decide(deps, begun.transactionId, begun.cookie, { decision: "allow", scope: "host:read" });
    expect(again.status).toBe(400);
    const [{ count }] = Array.from(await db<{ count: number }[]>`select count(*)::int as count from app.agent_grants where client_id = ${clientId}`);
    expect(count).toBe(0);
  });

  it("refuses a widened or empty permission set and a cross-site post", async () => {
    const deps = agentDependencies(db);
    const host = await signInHost(db);
    const clientId = await registerTestClient(deps);
    const begun = await beginAuthorization(deps, { clientId, redirectUri: CLIENT_REDIRECT, resource: HOST_RESOURCE, scope: "host:read" }, host.cookie);

    const widened = await decide(deps, begun.transactionId, begun.cookie, { decision: "allow", scope: ["host:read", "host:write"] });
    expect(widened.headers.get("location")).toContain("problem=scope");
    const empty = await decide(deps, begun.transactionId, begun.cookie, { decision: "allow" });
    expect(empty.headers.get("location")).toContain("problem=scope");

    const { createDecisionHandler } = await import("../../lib/server/agent-authorize");
    const crossSite = await createDecisionHandler(() => deps)(
      new Request(`${ORIGIN}/connect/decision`, {
        body: `transaction=${begun.transactionId}&decision=allow&scope=host:read`,
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: begun.cookie, origin: "https://evil.example" },
        method: "POST",
      }),
    );
    expect(crossSite.status).toBe(403);
  });
});

describe("codes and refresh tokens", () => {
  async function codeFor(deps: ReturnType<typeof agentDependencies>, scope = "host:read") {
    const host = await signInHost(db);
    const clientId = await registerTestClient(deps);
    const begun = await beginAuthorization(deps, { clientId, redirectUri: CLIENT_REDIRECT, resource: HOST_RESOURCE, scope }, host.cookie);
    const decided = await decide(deps, begun.transactionId, begun.cookie, { decision: "allow", scope: scope.split(" ") });
    return { authorization: begun.authorization, code: new URL(decided.headers.get("location")!).searchParams.get("code")!, host };
  }

  it("redeems a code at most once under concurrency and revokes the grant on replay", async () => {
    const deps = agentDependencies(db);
    const { authorization, code } = await codeFor(deps);
    const [first, second] = await Promise.all([exchange(deps, authorization, code), exchange(deps, authorization, code)]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 400]);

    const winner = (await (first.status === 200 ? first : second).json()) as Tokens;
    const grantId = grantIdOf(winner.access_token);
    const replay = await exchange(deps, authorization, code);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
    expect(await currentGrantAccess(db, grantId)).toBeNull();
  });

  it("refuses a changed resource, redirect URI or verifier", async () => {
    const deps = agentDependencies(db);
    for (const change of [{ resource: `${ORIGIN}/someone/mcp` }, { redirectUri: "https://agent.example.test/other" }, { verifier: pkce().verifier }]) {
      const { authorization, code } = await codeFor(deps);
      const response = await exchange(deps, { ...authorization, ...change }, code);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_grant" });
    }
  });

  it("rotates refresh tokens, never widens scope, and revokes the grant when a used one returns", async () => {
    const deps = agentDependencies(db);
    const { authorization, code } = await codeFor(deps, "host:read host:write");
    const first = (await (await exchange(deps, authorization, code)).json()) as Tokens;
    const refresh = (token: string, extra: Record<string, string> = {}) =>
      tokenRequest(deps, { client_id: authorization.clientId, grant_type: "refresh_token", refresh_token: token, resource: HOST_RESOURCE, ...extra });

    const otherResource = await refresh(first.refresh_token, { resource: `${ORIGIN}/someone/mcp` });
    expect(await otherResource.json()).toMatchObject({ error: "invalid_target" });

    const widened = await refresh(first.refresh_token, { scope: "host:read host:write host:decide" });
    expect(await widened.json()).toMatchObject({ error: "invalid_scope" });

    const narrowed = (await (await refresh(first.refresh_token, { scope: "host:read" })).json()) as Tokens;
    expect(narrowed.scope).toBe("host:read");
    expect(narrowed.refresh_token).not.toBe(first.refresh_token);

    const replay = await refresh(first.refresh_token);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
    const afterReplay = await refresh(narrowed.refresh_token);
    expect(await afterReplay.json()).toMatchObject({ error: "invalid_grant" });
    expect(await currentGrantAccess(db, grantIdOf(first.access_token))).toBeNull();
  });

  it("issues nothing without a signing key and leaves the code for later", async () => {
    const keyless = agentDependencies(db, { signingKey: null });
    const { authorization, code } = await codeFor(keyless);
    const unavailable = await exchange(keyless, authorization, code);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ error: "temporarily_unavailable" });

    const configured = { ...keyless, signingKey: agentDependencies(db).signingKey };
    expect((await exchange(configured, authorization, code)).status).toBe(200);
  });

  it("revokes by refresh token and stops access for a suspended host", async () => {
    const deps = agentDependencies(db);
    const host = await signInHost(db);
    const { authorization, tokens } = await connectHost(deps, host.cookie, { scope: "host:read" });
    const grantId = grantIdOf(tokens.access_token);
    expect(await currentGrantAccess(db, grantId)).not.toBeNull();

    await db`update app.host_accounts set status = 'suspended' where id = ${host.hostAccountId}`;
    expect(await currentGrantAccess(db, grantId)).toBeNull();
    await db`update app.host_accounts set status = 'active' where id = ${host.hostAccountId}`;
    expect(await currentGrantAccess(db, grantId)).not.toBeNull();

    const revoked = await createRevocationHandler(() => deps)(
      new Request(`${ORIGIN}/oauth/revoke`, {
        body: new URLSearchParams({ client_id: authorization.clientId, token: tokens.refresh_token }).toString(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
      }),
    );
    expect(revoked.status).toBe(200);
    expect(await currentGrantAccess(db, grantId)).toBeNull();
  });
});
