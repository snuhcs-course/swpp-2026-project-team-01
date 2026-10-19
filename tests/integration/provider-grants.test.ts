import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { readGoogleGrant, recordGoogleGrant } from "../../lib/server/provider-grants";
import { parseTokenKey } from "../../lib/server/token-encryption";
import { testDatabase } from "./support/database";

const db = testDatabase();
const key = parseTokenKey(randomBytes(32).toString("base64"));
const calendarScopes = ["https://www.googleapis.com/auth/calendar.events"];

afterAll(async () => {
  await db.end();
});

async function newHostAccount() {
  const [row] = await db<{ id: string }[]>`insert into app.host_accounts default values returning id`;
  return row!.id;
}

describe("provider grants", () => {
  it("stores the refresh token sealed and never in plaintext, in rows or logs", async () => {
    const hostAccountId = await newHostAccount();
    const refreshToken = `1//refresh-${randomBytes(16).toString("hex")}`;
    const logged: unknown[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args) => {
        logged.push(...args);
      }),
    );

    try {
      await recordGoogleGrant(db, key, { grantedScopes: calendarScopes, hostAccountId, refreshToken });
      const stored = await readGoogleGrant(db, [key], hostAccountId);

      expect(stored).toEqual({ grantedScopes: calendarScopes, refreshToken });
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    const [row] = await db`select to_jsonb(g)::text as data from app.provider_grants g where host_account_id = ${hostAccountId}`;

    expect(row!.data).not.toContain(refreshToken);
    expect(row!.data).toContain(key.id);
    expect(JSON.stringify(logged)).not.toContain(refreshToken);
  });

  it("keeps the stored token when a later sign-in returns none", async () => {
    const hostAccountId = await newHostAccount();
    const refreshToken = `1//refresh-${randomBytes(16).toString("hex")}`;

    await recordGoogleGrant(db, key, { grantedScopes: calendarScopes, hostAccountId, refreshToken });
    await recordGoogleGrant(db, key, { grantedScopes: calendarScopes, hostAccountId, refreshToken: null });

    expect(await readGoogleGrant(db, [key], hostAccountId)).toEqual({ grantedScopes: calendarScopes, refreshToken });
  });

  it("records nothing when neither Calendar scopes nor a refresh token came back", async () => {
    const hostAccountId = await newHostAccount();

    await recordGoogleGrant(db, key, { grantedScopes: null, hostAccountId, refreshToken: null });
    await recordGoogleGrant(db, key, { grantedScopes: ["openid", "email"], hostAccountId, refreshToken: null });

    expect(await readGoogleGrant(db, [key], hostAccountId)).toBeNull();
  });

  it("keeps the first consent's refresh token without Calendar scopes, for a later Calendar grant", async () => {
    const hostAccountId = await newHostAccount();
    const refreshToken = `1//refresh-${randomBytes(16).toString("hex")}`;

    // Calendar unchecked on first consent: the only time Google returns the token.
    await recordGoogleGrant(db, key, { grantedScopes: ["openid", "email"], hostAccountId, refreshToken });
    expect(await readGoogleGrant(db, [key], hostAccountId)).toEqual({ grantedScopes: [], refreshToken });

    // Granted later, with no new token.
    await recordGoogleGrant(db, key, { grantedScopes: calendarScopes, hostAccountId, refreshToken: null });
    expect(await readGoogleGrant(db, [key], hostAccountId)).toEqual({ grantedScopes: calendarScopes, refreshToken });

    // A later consent without Calendar revokes nothing.
    await recordGoogleGrant(db, key, { grantedScopes: ["openid"], hostAccountId, refreshToken: null });
    expect(await readGoogleGrant(db, [key], hostAccountId)).toEqual({ grantedScopes: calendarScopes, refreshToken });
  });

  it("refuses to open a stored token under another key", async () => {
    const hostAccountId = await newHostAccount();

    await recordGoogleGrant(db, key, { grantedScopes: calendarScopes, hostAccountId, refreshToken: "1//sealed" });

    await expect(
      readGoogleGrant(db, [parseTokenKey(randomBytes(32).toString("base64"))], hostAccountId),
    ).rejects.toThrow("unknown key");
  });
});
