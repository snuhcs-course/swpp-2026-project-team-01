import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GOOGLE_CALENDAR_SCOPES } from "../../lib/contracts/google-scopes";
import {
  createGoogleCallbackHandler,
  createGoogleSignInHandler,
  type GoogleSignInDependencies,
} from "../../lib/server/google-sign-in";
import { createGrantedScopesFetcher } from "../../lib/server/google-token-info";
import { START_COOKIE, startImessageLink } from "../../lib/server/imessage-start";
import { parseTokenKey } from "../../lib/server/token-encryption";
import {
  completeGoogleLeg,
  createGoogleUser,
  localAuthConfig,
  localStack,
  sessionCookies,
  startFakeTokenInfo,
  startGoogleSignIn,
  UNBOUNDED_SIGN_UPS,
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
    signUpLimits: UNBOUNDED_SIGN_UPS,
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

  it("gives this browser's iMessage start to the host who signs in, and clears its cookie (D15)", async () => {
    const { code, flow, user } = await signedInFlow();
    const secret = randomBytes(32).toString("base64url");
    const options = { lineNumber: "+15550001111", tokenKey: deps.tokenKey, tokenKeys: [deps.tokenKey] };
    await startImessageLink(db, options, secret, randomBytes(32).toString("hex"));

    const response = await callback(
      new Request(`${origin}/auth/callback?code=${code}`, { headers: { cookie: `${flow.cookie}; ${START_COOKIE}=${secret}` } }),
    );

    expect(response.headers.get("location")).toBe(`${origin}/app`);
    expect(response.headers.getSetCookie()).toEqual(expect.arrayContaining([expect.stringMatching(new RegExp(`^${START_COOKIE}=;.*Max-Age=0`))]));
    const [link] = await db<{ state: string }[]>`
      select l.state from app.imessage_links l join app.google_identities g on g.host_account_id = l.host_account_id
      where g.google_subject = ${user.googleSubject}
    `;
    expect(link).toEqual({ state: "pending" });
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

describe("renewed Calendar consent", () => {
  async function googleUrl(path: string) {
    const response = await signIn(new Request(`${origin}${path}`));
    const authorize = await fetch(response.headers.get("location")!, { redirect: "manual" });
    return new URL(authorize.headers.get("location")!);
  }

  it("asks Google to show consent again and keep earlier grants for ?consent=calendar", async () => {
    const google = await googleUrl("/auth/sign-in?consent=calendar");

    expect(google.origin).toBe("https://accounts.google.com");
    expect(google.searchParams.get("prompt")).toBe("consent");
    expect(google.searchParams.get("include_granted_scopes")).toBe("true");
    expect(google.searchParams.get("access_type")).toBe("offline");
    expect(google.searchParams.get("scope")!.split(" ")).toEqual(expect.arrayContaining([...GOOGLE_CALENDAR_SCOPES]));
  });

  it("asks for identity only for ?calendar=0, and for Calendar with any other value", async () => {
    const identity = (await googleUrl("/auth/sign-in?calendar=0")).searchParams.get("scope")!.split(" ");
    expect(identity).toEqual(expect.arrayContaining(["email", "profile"]));
    for (const scope of GOOGLE_CALENDAR_SCOPES) expect(identity).not.toContain(scope);

    for (const path of ["/auth/sign-in?calendar=1", "/auth/sign-in?calendar=0&consent=calendar"]) {
      expect((await googleUrl(path)).searchParams.get("scope")!.split(" ")).toEqual(expect.arrayContaining([...GOOGLE_CALENDAR_SCOPES]));
    }
  });

  it("ignores any other consent value", async () => {
    for (const path of ["/auth/sign-in", "/auth/sign-in?consent=other", "/auth/sign-in?consent=CALENDAR"]) {
      const google = await googleUrl(path);

      expect(google.searchParams.get("prompt")).toBeNull();
      expect(google.searchParams.get("include_granted_scopes")).toBeNull();
      expect(google.searchParams.get("access_type")).toBe("offline");
    }
  });
});

describe("display name from the Google profile", () => {
  async function signInWithProfile(userId: string, metadata: Record<string, string>) {
    await db`update auth.users set raw_user_meta_data = ${db.json(metadata)} where id = ${userId}`;
    const flow = await startGoogleSignIn(signIn, origin);
    const code = await completeGoogleLeg(db, flow.codeChallenge, userId, { accessToken: `ya29.${randomUUID()}`, refreshToken: null });
    return callback(new Request(`${origin}/auth/callback?code=${code}`, { headers: { cookie: flow.cookie } }));
  }

  async function displayNameOf(googleSubject: string) {
    const [row] = await db<{ display_name: string | null }[]>`
      select a.display_name
      from app.google_identities i join app.host_accounts a on a.id = i.host_account_id
      where i.google_subject = ${googleSubject}
    `;
    return row?.display_name;
  }

  it("fills it on sign-in without control characters and refreshes it on the next sign-in", async () => {
    const user = await createGoogleUser(db);

    await signInWithProfile(user.userId, { full_name: "  Ada\u0007 Lovelace\n " });
    expect(await displayNameOf(user.googleSubject)).toBe("Ada Lovelace");

    await signInWithProfile(user.userId, { name: `Countess ${"x".repeat(300)}` });
    expect(await displayNameOf(user.googleSubject)).toBe(`Countess ${"x".repeat(191)}`);
  });

  it("leaves a suspended account's name unchanged", async () => {
    const user = await createGoogleUser(db);
    await signInWithProfile(user.userId, { full_name: "Before" });
    await db`
      update app.host_accounts set status = 'suspended'
      where id = (select host_account_id from app.google_identities where google_subject = ${user.googleSubject})
    `;

    await signInWithProfile(user.userId, { full_name: "After" });
    expect(await displayNameOf(user.googleSubject)).toBe("Before");
  });
});
