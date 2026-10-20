import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GOOGLE_CALENDAR_SCOPES } from "../../lib/contracts/google-scopes";
import {
  createGoogleCallbackHandler,
  createGoogleSignInHandler,
  type GoogleSignInDependencies,
} from "../../lib/server/google-sign-in";
import { createGrantedScopesFetcher } from "../../lib/server/google-token-info";
import {
  hasPublicProfile,
  HostIneligibleError,
  readHostStanding,
  withEligibleHost,
} from "../../lib/server/host-eligibility";
import { parseTokenKey } from "../../lib/server/token-encryption";
import {
  completeGoogleLeg,
  createGoogleUser,
  localAuthConfig,
  startFakeTokenInfo,
  startGoogleSignIn,
  UNBOUNDED_SIGN_UPS,
} from "./support/auth";
import { testDatabase } from "./support/database";

const origin = "http://localhost:3000";
const db = testDatabase();
const calendarScopes = `openid ${GOOGLE_CALENDAR_SCOPES.join(" ")}`;
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
    signUpLimits: UNBOUNDED_SIGN_UPS,
    tokenKey: parseTokenKey(randomBytes(32).toString("base64")),
  };
});

afterAll(async () => {
  await tokenInfo.close();
  await db.end();
});

// Prepares a sign-in up to Google's return, so callbacks can be raced.
async function preparedCallback(userId: string, refreshToken: string | null = `1//${randomUUID()}`) {
  const flow = await startGoogleSignIn(createGoogleSignInHandler(() => deps), origin);
  const accessToken = `ya29.${randomUUID()}`;
  scopesByToken[accessToken] = calendarScopes;
  const code = await completeGoogleLeg(db, flow.codeChallenge, userId, { accessToken, refreshToken });

  return () =>
    createGoogleCallbackHandler(() => deps)(
      new Request(`${origin}/auth/callback?code=${code}`, { headers: { cookie: flow.cookie } }),
    );
}

async function accountsOf(googleSubject: string) {
  return db<{ id: string; status: string }[]>`
    select a.id, a.status
    from app.google_identities i join app.host_accounts a on a.id = i.host_account_id
    where i.google_subject = ${googleSubject}
  `;
}

async function hostData(hostAccountId: string) {
  const [row] = await db<{ data: string }[]>`
    select jsonb_build_object(
      'account', (select to_jsonb(a) from app.host_accounts a where a.id = ${hostAccountId}),
      'identity', (select to_jsonb(i) from app.google_identities i where i.host_account_id = ${hostAccountId}),
      'grant', (select to_jsonb(g) from app.provider_grants g where g.host_account_id = ${hostAccountId})
    )::text as data
  `;
  return row!.data;
}

describe("host admission", () => {
  it("creates one active host account on first sign-in", async () => {
    const user = await createGoogleUser(db);

    const response = await (await preparedCallback(user.userId))();

    expect(response.headers.get("location")).toBe(`${origin}/app`);
    expect(await accountsOf(user.googleSubject)).toEqual([{ id: expect.any(String), status: "active" }]);
  });

  it("returns the same account on a repeated sign-in", async () => {
    const user = await createGoogleUser(db);

    await (await preparedCallback(user.userId))();
    const [first] = await accountsOf(user.googleSubject);
    await (await preparedCallback(user.userId, null))();

    expect(await accountsOf(user.googleSubject)).toEqual([first]);
  });

  it("creates one account for two concurrent callbacks of one identity", async () => {
    const user = await createGoogleUser(db);
    const callbacks = await Promise.all([preparedCallback(user.userId), preparedCallback(user.userId)]);
    const responses = await Promise.all(callbacks.map((callback) => callback()));

    expect(responses.map((response) => response.headers.get("location"))).toEqual([
      `${origin}/app`,
      `${origin}/app`,
    ]);
    expect(await accountsOf(user.googleSubject)).toHaveLength(1);
  });

  it("rejects a suspended host's operation without changing host data", async () => {
    const user = await createGoogleUser(db);
    await (await preparedCallback(user.userId))();
    const [account] = await accountsOf(user.googleSubject);
    await db`update app.host_accounts set status = 'suspended' where id = ${account!.id}`;
    const before = await hostData(account!.id);
    const operation = vi.fn(async () => {
      await db`update app.host_accounts set updated_at = now() where id = ${account!.id}`;
    });

    await expect(withEligibleHost(db, user.userId, operation)).rejects.toEqual(
      new HostIneligibleError("account_suspended"),
    );
    await (await preparedCallback(user.userId))();

    expect(operation).not.toHaveBeenCalled();
    expect(await hostData(account!.id)).toBe(before);
    expect(await readHostStanding(db, user.userId)).toMatchObject({
      eligible: false,
      nextAction: "account_suspended",
    });
  });

  it("lets an active host operate but gives an unready host no public profile", async () => {
    const user = await createGoogleUser(db);
    await (await preparedCallback(user.userId))();
    const [account] = await accountsOf(user.googleSubject);

    const operated = await withEligibleHost(db, user.userId, async (_tx, hostAccountId) => hostAccountId);
    const standing = await readHostStanding(db, user.userId);

    expect(operated).toBe(account!.id);
    expect(standing).toEqual({
      eligible: true,
      hostAccountId: account!.id,
      nextAction: "complete_setup",
      ready: false,
    });
    expect(hasPublicProfile(standing)).toBe(false);
  });

  it("treats a user with no host account as needing sign-in", async () => {
    const standing = await readHostStanding(db, randomUUID());

    expect(standing).toEqual({ eligible: false, hostAccountId: null, nextAction: "sign_in", ready: false });
    await expect(withEligibleHost(db, randomUUID(), async () => "ran")).rejects.toThrow(HostIneligibleError);
  });
});
