import { randomUUID } from "node:crypto";
import { combineChunks, parseCookieHeader, stringFromBase64URL, stringToBase64URL } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { authenticatedUserId } from "../../lib/server/chat-routes";
import { createAppAuth } from "../../lib/server/eve-auth";
import { sessionIdHash } from "../../lib/server/model-limits";
import { updateSession } from "../../lib/server/session-proxy";
import { localAuthConfig, signInHost } from "./support/auth";
import { testDatabase } from "./support/database";

// Supabase session refresh: only the session proxy refreshes. Application
// routes and the agent verify the access token they are given, so a refresh
// token is never spent by a request whose new cookies cannot reach the browser
// (which would get the session revoked for refresh-token reuse).

const db = testDatabase();
const auth = localAuthConfig();
const key = `sb-${new URL(auth.url).hostname.split(".")[0]}-auth-token`;
const realFetch = globalThis.fetch;
let refreshes: string[] = [];

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("grant_type=refresh_token")) refreshes.push(url);
    return realFetch(input, init);
  }) as typeof fetch;
});

afterEach(() => {
  refreshes = [];
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await db.end();
});

type StoredSession = { access_token: string; refresh_token: string; expires_at: number; expires_in: number };

async function storedSession(cookie: string) {
  const cookies = parseCookieHeader(cookie);
  const raw = (await combineChunks(key, (name) => cookies.find((c) => c.name === name)?.value))!;
  return JSON.parse(stringFromBase64URL(raw.slice("base64-".length))) as StoredSession;
}

// The same session as the browser holds it once its access token has expired
// by the session's own clock: Supabase JS refreshes such a session on read.
async function expiringCookie(cookie: string, change: (session: StoredSession) => StoredSession = (s) => s) {
  const session = change(await storedSession(cookie));
  const expired = { ...session, expires_at: Math.floor(Date.now() / 1000) - 60, expires_in: -60 };
  return `${key}=base64-${stringToBase64URL(JSON.stringify(expired))}`;
}

// An access token claiming an exp in the past. Auth refuses it (its claims no
// longer match the signature), as it refuses a genuinely expired one.
function expiredJwt(token: string) {
  const [header, payload, signature] = token.split(".") as [string, string, string];
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp: number };
  const stale = Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) - 60 })).toString("base64url");
  return `${header}.${stale}.${signature}`;
}

describe("session refresh", () => {
  it("refreshes an expiring session only in the proxy, onto the request and the response", async () => {
    const host = await signInHost(db);
    const cookie = await expiringCookie(host.cookie);
    const before = await storedSession(cookie);

    const response = await updateSession(new NextRequest("http://localhost:3000/app", { headers: { cookie } }), auth);

    expect(refreshes).toHaveLength(1);
    const written = response.cookies.getAll().filter(({ name }) => name.startsWith(key));
    expect(written.length).toBeGreaterThan(0);
    expect(response.headers.get("cache-control")).toContain("no-store");

    // The forwarded request carries the refreshed session to the route.
    const forwarded = response.headers.get("x-middleware-request-cookie") ?? "";
    const refreshedCookie = written.map(({ name, value }) => `${name}=${value}`).join("; ");
    const after = await storedSession(refreshedCookie);
    expect(after.refresh_token).not.toBe(before.refresh_token);
    expect(forwarded).toContain(key);

    refreshes = [];
    expect(await authenticatedUserId(new Request("http://localhost/", { headers: { cookie: refreshedCookie } }), auth)).toBe(
      host.userId,
    );
    expect(refreshes).toHaveLength(0);
  });

  it("never refreshes in an application route", async () => {
    const host = await signInHost(db);
    const expiring = await expiringCookie(host.cookie);
    const expired = await expiringCookie(host.cookie, (s) => ({ ...s, access_token: expiredJwt(s.access_token) }));

    // A still-valid access token is accepted as is; an expired one is refused.
    expect(await authenticatedUserId(new Request("http://localhost/", { headers: { cookie: expiring } }), auth)).toBe(host.userId);
    expect(await authenticatedUserId(new Request("http://localhost/", { headers: { cookie: expired } }), auth)).toBeNull();
    expect(refreshes).toHaveLength(0);

    // The refresh token is still unspent: the proxy can use it.
    await updateSession(new NextRequest("http://localhost:3000/app", { headers: { cookie: expired } }), auth);
    expect(refreshes).toHaveLength(1);
  });

  it("never refreshes in the agent's cookie authorization", async () => {
    const host = await signInHost(db);
    const sessionId = `wrun_${randomUUID()}`;
    await db`
      insert into app.agent_sessions
        (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version)
      values (${sessionId}, ${sessionIdHash(sessionId)}, ${randomUUID()}, 'host_account', ${host.hostAccountId}, 1, 'test')
    `;
    const appAuth = createAppAuth(() => ({ auth, db, signingKey: "unused-signing-key-of-at-least-32-chars" }));
    const stream = (cookie: string) =>
      appAuth(new Request(`http://127.0.0.1/eve/v1/session/${sessionId}/stream`, { headers: { cookie } }));

    await expect(stream(await expiringCookie(host.cookie))).resolves.toMatchObject({ principalId: host.hostAccountId });
    await expect(
      stream(await expiringCookie(host.cookie, (s) => ({ ...s, access_token: expiredJwt(s.access_token) }))),
    ).rejects.toMatchObject({ name: "UnauthenticatedError" });
    expect(refreshes).toHaveLength(0);
  });
});
