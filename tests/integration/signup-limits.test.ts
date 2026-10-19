import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createGoogleCallbackHandler,
  createGoogleSignInHandler,
  type GoogleSignInDependencies,
} from "../../lib/server/google-sign-in";
import { createGrantedScopesFetcher } from "../../lib/server/google-token-info";
import { admitSignUp, type SignUpLimits, SignUpLimitError, sourceHash } from "../../lib/server/signup-limits";
import { parseTokenKey } from "../../lib/server/token-encryption";
import {
  completeGoogleLeg,
  createGoogleUser,
  localAuthConfig,
  sessionCookies,
  startGoogleSignIn,
} from "./support/auth";
import { testDatabase } from "./support/database";

const origin = "http://localhost:3000";
const db = testDatabase();
let deps: GoogleSignInDependencies;

beforeAll(() => {
  deps = {
    appOrigin: origin,
    auth: localAuthConfig(),
    db,
    // Nothing listens on the discard port, so no Calendar grant is recorded.
    fetchGrantedScopes: createGrantedScopesFetcher("http://127.0.0.1:9/tokeninfo"),
    signUpLimits: { perSource: 3, service: Number.POSITIVE_INFINITY },
    tokenKey: parseTokenKey(randomBytes(32).toString("base64")),
  };
});

afterAll(async () => {
  await db.end();
});

// A documentation-range address no other suite uses.
function freshAddress() {
  return `198.51.100.${Math.floor(Math.random() * 250) + 1}, 10.${Math.floor(Math.random() * 250)}.0.${Math.floor(Math.random() * 250)}`;
}

async function callbackFor(userId: string, address: string, limits?: SignUpLimits) {
  const withLimits = () => ({ ...deps, ...(limits ? { signUpLimits: limits } : {}) });
  const flow = await startGoogleSignIn(createGoogleSignInHandler(withLimits), origin);
  const code = await completeGoogleLeg(db, flow.codeChallenge, userId, { accessToken: `ya29.${randomUUID()}`, refreshToken: null });

  return createGoogleCallbackHandler(withLimits)(
    new Request(`${origin}/auth/callback?code=${code}`, {
      headers: { cookie: flow.cookie, "x-forwarded-for": address },
    }),
  );
}

async function accountCount(userId: string) {
  const [row] = await db<{ count: number }[]>`
    select count(*)::int as count from app.google_identities where auth_user_id = ${userId}
  `;
  return row!.count;
}

async function authSessions(userId: string) {
  const [row] = await db<{ count: number }[]>`select count(*)::int as count from auth.sessions where user_id = ${userId}`;
  return row!.count;
}

async function attemptsFrom(address: string) {
  const hash = sourceHash(deps.tokenKey, new Request(origin, { headers: { "x-forwarded-for": address } }));
  const [row] = await db<{ count: number }[]>`
    select count(*)::int as count from app.signup_attempts where source_hash = ${hash}
  `;
  return row!.count;
}

describe("sign-up bounds", () => {
  it("rejects the fourth new account from one source, leaving no account and no session", async () => {
    // Unique per run, so earlier runs' attempts never count.
    const address = `2001:db8::${randomUUID().slice(0, 4)}:${randomUUID().slice(0, 4)}`;
    const users = [];

    for (let index = 0; index < 4; index += 1) users.push(await createGoogleUser(db));

    const responses = [];
    for (const user of users) responses.push(await callbackFor(user.userId, address));

    expect(responses.slice(0, 3).map((response) => response.headers.get("location"))).toEqual([
      `${origin}/app`,
      `${origin}/app`,
      `${origin}/app`,
    ]);
    expect(responses[3]!.headers.get("location")).toBe(`${origin}/app?sign_in=limited`);
    expect(sessionCookies(responses[3]!)).toHaveLength(0);
    expect(await accountCount(users[3]!.userId)).toBe(0);
    expect(await authSessions(users[3]!.userId)).toBe(0);
    expect(await attemptsFrom(address)).toBe(3);

    // An existing identity at the bound signs in and is not counted.
    const again = await callbackFor(users[0]!.userId, address);
    expect(again.headers.get("location")).toBe(`${origin}/app`);
    expect(sessionCookies(again).length).toBeGreaterThan(0);
    expect(await accountCount(users[0]!.userId)).toBe(1);
    expect(await attemptsFrom(address)).toBe(3);
  });

  it("rejects a new identity at the service bound but signs in an existing one", async () => {
    const existing = await createGoogleUser(db);
    await callbackFor(existing.userId, freshAddress(), { perSource: Number.POSITIVE_INFINITY, service: Number.POSITIVE_INFINITY });
    const atBound = { perSource: Number.POSITIVE_INFINITY, service: 0 };
    const newcomer = await createGoogleUser(db);

    const rejected = await callbackFor(newcomer.userId, freshAddress(), atBound);
    const returning = await callbackFor(existing.userId, freshAddress(), atBound);

    expect(rejected.headers.get("location")).toBe(`${origin}/app?sign_in=limited`);
    expect(sessionCookies(rejected)).toHaveLength(0);
    expect(await accountCount(newcomer.userId)).toBe(0);
    expect(await authSessions(newcomer.userId)).toBe(0);
    expect(returning.headers.get("location")).toBe(`${origin}/app`);
  });

  it("counts the service window across sources under its lock", async () => {
    // The service lock taken by the first admission holds every other sign-up
    // until this transaction ends, so the count cannot move underneath the test.
    await expect(
      db.begin(async (tx) => {
        await admitSignUp(tx, `test-${randomUUID()}`, { perSource: 3, service: Number.POSITIVE_INFINITY });
        const [row] = await tx<{ count: number }[]>`
          select count(*)::int as count from app.signup_attempts where created_at > now() - interval '24 hours'
        `;
        const limits = { perSource: 3, service: row!.count + 1 };

        await admitSignUp(tx, `test-${randomUUID()}`, limits);
        await expect(admitSignUp(tx, `test-${randomUUID()}`, limits)).rejects.toEqual(new SignUpLimitError("service"));
        throw new Error("roll back");
      }),
    ).rejects.toThrow("roll back");
  });
});
