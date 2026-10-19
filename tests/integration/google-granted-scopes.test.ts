import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GOOGLE_CALENDAR_SCOPES } from "../../lib/contracts/google-scopes";
import {
  createGoogleCallbackHandler,
  createGoogleSignInHandler,
  type GoogleSignInDependencies,
} from "../../lib/server/google-sign-in";
import { createGrantedScopesFetcher } from "../../lib/server/google-token-info";
import { readGoogleGrant } from "../../lib/server/provider-grants";
import { parseTokenKey } from "../../lib/server/token-encryption";
import {
  completeGoogleLeg,
  createGoogleUser,
  localAuthConfig,
  sessionCookies,
  startFakeTokenInfo,
  startGoogleSignIn,
} from "./support/auth";
import { testDatabase } from "./support/database";

const origin = "http://localhost:3000";
const db = testDatabase();
const identityScopes = "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";
const scopesByToken: Record<string, string | number> = {};
let tokenInfo: Awaited<ReturnType<typeof startFakeTokenInfo>>;
let deps: GoogleSignInDependencies;

beforeAll(async () => {
  tokenInfo = await startFakeTokenInfo(scopesByToken);
  deps = {
    appOrigin: origin,
    auth: localAuthConfig(),
    db,
    fetchGrantedScopes: createGrantedScopesFetcher(tokenInfo.url),
    tokenKey: parseTokenKey(randomBytes(32).toString("base64")),
  };
});

afterAll(async () => {
  await tokenInfo.close();
  await db.end();
});

// Runs a full sign-in through the local Auth stack; Google's token information
// endpoint answers `tokenInfo` for this sign-in's access token.
async function signInAs(user: { userId: string }, tokenInfoAnswer: string | number, refreshToken: string | null) {
  const flow = await startGoogleSignIn(createGoogleSignInHandler(() => deps), origin);
  const accessToken = `ya29.${randomUUID()}`;
  scopesByToken[accessToken] = tokenInfoAnswer;
  const code = await completeGoogleLeg(db, flow.codeChallenge, user.userId, { accessToken, refreshToken });
  const response = await createGoogleCallbackHandler(() => deps)(
    new Request(`${origin}/auth/callback?code=${code}`, { headers: { cookie: flow.cookie } }),
  );

  expect(response.headers.get("location")).toBe(`${origin}/app`);
  expect(sessionCookies(response)).not.toHaveLength(0);
  expect(tokenInfo.requests).toContain(accessToken);
}

async function grantOf(googleSubject: string) {
  const [row] = await db<{ id: string }[]>`
    select host_account_id as id from app.google_identities where google_subject = ${googleSubject}
  `;
  expect(row).toBeDefined();
  return readGoogleGrant(db, [deps.tokenKey], row!.id);
}

describe("granted Google scopes", () => {
  it("records the Calendar scopes Google granted with the sealed refresh token", async () => {
    const user = await createGoogleUser(db);
    const refreshToken = `1//${randomUUID()}`;

    await signInAs(user, `${identityScopes} ${GOOGLE_CALENDAR_SCOPES.join(" ")}`, refreshToken);

    expect(await grantOf(user.googleSubject)).toEqual({
      grantedScopes: [...GOOGLE_CALENDAR_SCOPES],
      refreshToken,
    });
  });

  it("records no Calendar scopes but keeps the refresh token when the Calendar scopes were unchecked", async () => {
    const user = await createGoogleUser(db);
    const refreshToken = `1//${randomUUID()}`;

    await signInAs(user, identityScopes, refreshToken);

    expect(await grantOf(user.googleSubject)).toEqual({ grantedScopes: [], refreshToken });
  });

  it("records no Calendar scopes but keeps the refresh token when the token information call fails", async () => {
    const user = await createGoogleUser(db);
    const refreshToken = `1//${randomUUID()}`;

    await signInAs(user, 500, refreshToken);

    expect(await grantOf(user.googleSubject)).toEqual({ grantedScopes: [], refreshToken });
  });

  it("keeps the stored grant when a repeat sign-in returns no refresh token", async () => {
    const user = await createGoogleUser(db);
    const refreshToken = `1//${randomUUID()}`;
    const calendar = `${identityScopes} ${GOOGLE_CALENDAR_SCOPES.join(" ")}`;

    await signInAs(user, calendar, refreshToken);
    await signInAs(user, calendar, null);

    expect(await grantOf(user.googleSubject)).toEqual({
      grantedScopes: [...GOOGLE_CALENDAR_SCOPES],
      refreshToken,
    });
  });
});
