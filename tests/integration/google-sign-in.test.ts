import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GOOGLE_CALENDAR_SCOPES } from "../../lib/contracts/google-scopes";
import {
  createGoogleCallbackHandler,
  createGoogleSignInHandler,
  type GoogleSignInDependencies,
} from "../../lib/server/google-sign-in";
import { createGrantedScopesFetcher } from "../../lib/server/google-token-info";
import { parseTokenKey } from "../../lib/server/token-encryption";
import {
  completeGoogleLeg,
  createGoogleUser,
  localAuthConfig,
  localStack,
  sessionCookies,
  startFakeTokenInfo,
  startGoogleSignIn,
} from "./support/auth";
import { testDatabase } from "./support/database";

const origin = "http://localhost:3000";
const db = testDatabase();
let tokenInfo: Awaited<ReturnType<typeof startFakeTokenInfo>>;
let deps: GoogleSignInDependencies;
let signIn: ReturnType<typeof createGoogleSignInHandler>;
let callback: ReturnType<typeof createGoogleCallbackHandler>;

beforeAll(async () => {
  tokenInfo = await startFakeTokenInfo({});
  deps = {
    appOrigin: origin,
    auth: localAuthConfig(),
    db,
    fetchGrantedScopes: createGrantedScopesFetcher(tokenInfo.url),
    tokenKey: parseTokenKey(randomBytes(32).toString("base64")),
  };
  signIn = createGoogleSignInHandler(() => deps);
  callback = createGoogleCallbackHandler(() => deps);
});

afterAll(async () => {
  await tokenInfo.close();
  await db.end();
});

async function hostAccountsFor(googleSubject: string) {
  const [row] = await db<{ count: number }[]>`
    select count(*)::int as count from app.google_identities where google_subject = ${googleSubject}
  `;
  return row!.count;
}

async function signedInFlow() {
  const user = await createGoogleUser(db);
  const flow = await startGoogleSignIn(signIn, origin);
  const accessToken = `ya29.${randomUUID()}`;
  const code = await completeGoogleLeg(db, flow.codeChallenge, user.userId, {
    accessToken,
    refreshToken: `1//${randomUUID()}`,
  });
  return { accessToken, code, flow, user };
}

describe("Google sign-in", () => {
  it("writes HttpOnly, SameSite=Lax session cookies on path /, Secure when the app is https", async () => {
    const { code, flow } = await signedInFlow();
    const secure = createGoogleCallbackHandler(() => ({ ...deps, auth: { ...deps.auth, secureCookies: true } }));
    const response = await secure(new Request(`${origin}/auth/callback?code=${code}`, { headers: { cookie: flow.cookie } }));
    const cookies = [...flow.response.headers.getSetCookie(), ...sessionCookies(response)];

    expect(sessionCookies(response).length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie).toMatch(/; HttpOnly/i);
      expect(cookie).toMatch(/; SameSite=Lax/i);
      expect(cookie).toMatch(/; Path=\//i);
    }
    for (const cookie of sessionCookies(response)) expect(cookie).toMatch(/; Secure/i);
    for (const cookie of flow.response.headers.getSetCookie()) expect(cookie).not.toMatch(/; Secure/i);
  });

  it("asks Google once for identity and the Calendar scopes with PKCE and offline access", async () => {
    const { flow } = await signedInFlow();

    expect(flow.response.status).toBe(303);
    expect(flow.cookie).toMatch(/-auth-token-code-verifier=/);
    expect(flow.google.origin).toBe("https://accounts.google.com");
    expect(flow.google.searchParams.get("access_type")).toBe("offline");
    expect(flow.google.searchParams.get("redirect_uri")).toBe(`${localStack().API_URL}/auth/v1/callback`);

    const requested = flow.google.searchParams.get("scope")!.split(" ");
    expect(requested).toEqual(expect.arrayContaining(["email", "profile", ...GOOGLE_CALENDAR_SCOPES]));
  });

  it("returns a completed sign-in to /app with a session, ignoring a supplied destination", async () => {
    const { code, flow, user } = await signedInFlow();
    const response = await callback(
      new Request(`${origin}/auth/callback?code=${code}&next=https://evil.example/&redirect_to=https://evil.example/`, {
        headers: { cookie: flow.cookie },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${origin}/app`);
    expect(sessionCookies(response)).not.toHaveLength(0);
    expect(await hostAccountsFor(user.googleSubject)).toBe(1);
  });

  it("establishes no session when the code is replayed", async () => {
    const { code, flow } = await signedInFlow();
    const request = () =>
      callback(new Request(`${origin}/auth/callback?code=${code}`, { headers: { cookie: flow.cookie } }));

    expect(sessionCookies(await request())).not.toHaveLength(0);

    const replay = await request();
    expect(replay.headers.get("location")).toBe(`${origin}/app?sign_in=failed`);
    expect(sessionCookies(replay)).toHaveLength(0);
  });

  it("establishes no session when the callback arrives in another browser", async () => {
    const { code, user } = await signedInFlow();
    const otherBrowser = await startGoogleSignIn(signIn, origin);
    const response = await callback(
      new Request(`${origin}/auth/callback?code=${code}`, { headers: { cookie: otherBrowser.cookie } }),
    );
    const noCookies = await callback(new Request(`${origin}/auth/callback?code=${code}`));

    expect(response.headers.get("location")).toBe(`${origin}/app?sign_in=failed`);
    expect(sessionCookies(response)).toHaveLength(0);
    expect(sessionCookies(noCookies)).toHaveLength(0);
    expect(await hostAccountsFor(user.googleSubject)).toBe(0);
  });

  it("establishes no session when Google sign-in is cancelled", async () => {
    const flow = await startGoogleSignIn(signIn, origin);
    const response = await callback(
      new Request(`${origin}/auth/callback?error=access_denied&error_description=cancelled`, {
        headers: { cookie: flow.cookie },
      }),
    );

    expect(response.headers.get("location")).toBe(`${origin}/app?sign_in=failed`);
    expect(sessionCookies(response)).toHaveLength(0);
  });

  it("rejects an email sign-in request without sending mail", async () => {
    const { API_URL, MAILPIT_URL, PUBLISHABLE_KEY } = localStack();
    const email = `former-email-login-${randomUUID()}@example.test`;
    const headers = { apikey: PUBLISHABLE_KEY, "content-type": "application/json" };
    const otp = await fetch(`${API_URL}/auth/v1/otp`, {
      body: JSON.stringify({ create_user: true, email }),
      headers,
      method: "POST",
    });
    const signup = await fetch(`${API_URL}/auth/v1/signup`, {
      body: JSON.stringify({ email, password: randomUUID() }),
      headers,
      method: "POST",
    });
    const password = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, {
      body: JSON.stringify({ email, password: randomUUID() }),
      headers,
      method: "POST",
    });

    expect(otp.status).toBeGreaterThanOrEqual(400);
    expect(await otp.json()).toMatchObject({ error_code: "email_provider_disabled" });
    expect(signup.status).toBeGreaterThanOrEqual(400);
    expect(password.status).toBeGreaterThanOrEqual(400);

    const mail = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    expect(((await mail.json()) as { messages_count: number }).messages_count).toBe(0);
  });
});

describe("Google sign-in on more than one origin", () => {
  const release = "http://127.0.0.1:3000";
  const both = () => ({ ...deps, allowedOrigins: [release] });

  it("starts and finishes sign-in on the origin the request came to", async () => {
    const user = await createGoogleUser(db);
    const flow = await startGoogleSignIn(createGoogleSignInHandler(both), release);
    const authorize = new URL(flow.response.headers.get("location")!);
    expect(authorize.searchParams.get("redirect_to")).toBe(`${release}/auth/callback`);

    const code = await completeGoogleLeg(db, flow.codeChallenge, user.userId, {
      accessToken: `ya29.${randomUUID()}`,
      refreshToken: null,
    });
    const response = await createGoogleCallbackHandler(both)(
      new Request(`${release}/auth/callback?code=${code}`, { headers: { cookie: flow.cookie } }),
    );
    expect(response.headers.get("location")).toBe(`${release}/app`);
    expect(sessionCookies(response).length).toBeGreaterThan(0);

    // The canonical origin still returns to itself.
    const canonical = await createGoogleSignInHandler(both)(new Request(`${origin}/auth/sign-in`));
    expect(new URL(canonical.headers.get("location")!).searchParams.get("redirect_to")).toBe(`${origin}/auth/callback`);
  });

  it("marks cookies Secure on an https origin and not on an http one", async () => {
    const secure = "https://release.findmeatime.test";
    const handler = createGoogleSignInHandler(() => ({ ...deps, allowedOrigins: [secure] }));

    for (const cookie of (await handler(new Request(`${secure}/auth/sign-in`))).headers.getSetCookie()) {
      expect(cookie).toMatch(/; Secure/i);
    }
    for (const cookie of (await handler(new Request(`${origin}/auth/sign-in`))).headers.getSetCookie()) {
      expect(cookie).not.toMatch(/; Secure/i);
    }
  });

  it("refuses an unlisted host, whether in the URL or a forwarded header, without redirecting", async () => {
    const handlers = [createGoogleSignInHandler(both), createGoogleCallbackHandler(both)];
    const requests = [
      () => new Request("http://evil.example/auth/sign-in"),
      () => new Request(`${origin}/auth/sign-in`, { headers: { "x-forwarded-host": "evil.example" } }),
      () => new Request("http://evil.example/auth/callback?code=x"),
    ];

    for (const handler of handlers) {
      for (const request of requests) {
        const response = await handler(request());
        expect(response.status).toBe(421);
        expect(response.headers.get("location")).toBeNull();
      }
    }
  });
});
