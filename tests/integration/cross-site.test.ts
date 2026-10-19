import { afterAll, describe, expect, it } from "vitest";
import { authenticatedUserId, type ChatRouteDependencies, createMessageHandler, createRecoverHandler } from "../../lib/server/chat-routes";
import type { ConversationRuntime } from "../../lib/server/conversations";
import { createSignOutHandler, type GoogleSignInDependencies } from "../../lib/server/google-sign-in";
import { parseTokenKey } from "../../lib/server/token-encryption";
import { localAuthConfig, signInHost } from "./support/auth";
import { testDatabase } from "./support/database";

// State-changing routes refuse cross-site requests before touching the session
// or the database, so a signed-in browser cannot be made to post for its host.

const origin = "http://localhost:3000";
const db = testDatabase();
const unreachable = new Proxy({} as ConversationRuntime, {
  get() {
    throw new Error("A refused request must not reach the agent.");
  },
});
const deps: ChatRouteDependencies = { appOrigin: origin, auth: localAuthConfig(), db, runtime: unreachable, signingKey: "x".repeat(32) };

afterAll(async () => {
  await db.end();
});

async function inputsOf(userId: string) {
  const [row] = await db<{ count: number }[]>`
    select count(*)::int as count from app.conversation_inputs i
    join app.discussions d on d.id = i.discussion_id
    join app.google_identities g on g.host_account_id = d.principal_id
    where g.auth_user_id = ${userId}
  `;
  return row!.count;
}

describe("cross-site requests", () => {
  it("refuses a message or recovery from another origin, without one, or as a form body", async () => {
    const host = await signInHost(db);
    const message = createMessageHandler(() => deps);
    const recover = createRecoverHandler(() => deps);
    const body = JSON.stringify({ clientInputId: crypto.randomUUID(), message: "Book me." });
    const cases: [Record<string, string>, number][] = [
      [{ "content-type": "application/json", origin: "https://evil.example" }, 403],
      [{ "content-type": "application/json" }, 403],
      [{ "content-type": "text/plain", origin }, 415],
    ];

    for (const [headers, status] of cases) {
      const init = { body, headers: { ...headers, cookie: host.cookie }, method: "POST" };
      expect((await message(new Request(`${origin}/api/chat/messages`, init))).status).toBe(status);
      expect((await recover(new Request(`${origin}/api/chat/recover`, { ...init, body: '{"observedGeneration":1}' }))).status).toBe(status);
    }

    expect(await inputsOf(host.userId)).toBe(0);
  });

  it("refuses a cross-site sign-out and keeps the session", async () => {
    const host = await signInHost(db);
    const signOut = createSignOutHandler(
      () => ({ appOrigin: origin, auth: localAuthConfig(), db, tokenKey: parseTokenKey(Buffer.alloc(32).toString("base64")) }) as GoogleSignInDependencies,
    );
    const request = (headers: Record<string, string>) =>
      new Request(`${origin}/auth/sign-out`, { headers: { ...headers, cookie: host.cookie }, method: "POST" });

    expect((await signOut(request({ origin: "https://evil.example" }))).status).toBe(403);
    expect((await signOut(request({}))).status).toBe(403);
    expect(await authenticatedUserId(new Request(`${origin}/`, { headers: { cookie: host.cookie } }), localAuthConfig())).toBe(host.userId);

    const allowed = await signOut(request({ "content-type": "application/x-www-form-urlencoded", origin }));
    expect(allowed.status).toBe(303);
    expect(await authenticatedUserId(new Request(`${origin}/`, { headers: { cookie: host.cookie } }), localAuthConfig())).toBeNull();
  });
});
