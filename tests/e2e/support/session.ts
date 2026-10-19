import { test as base, type BrowserContext } from "@playwright/test";
import { signInHost } from "../../integration/support/auth";
import { testDatabase } from "../../integration/support/database";

// Test-only sign-in: the harness completes the real Supabase Auth PKCE flow
// against the LOCAL stack (only Google's leg is simulated in the database) and
// puts the resulting session cookies into the browser. No application route
// offers a bypass.

type Database = ReturnType<typeof testDatabase>;

// Each worker gets one database pool, ended when the worker finishes.
export const test = base.extend<object, { db: Database }>({
  db: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern.
    async ({}, use) => {
      const db = testDatabase();
      await use(db);
      await db.end();
    },
    { scope: "worker" },
  ],
});

export { expect } from "@playwright/test";

export async function signedInHost(db: Database, context: BrowserContext, baseURL: string) {
  const host = await signInHost(db);
  const url = new URL(baseURL);

  await context.addCookies(
    host.cookie.split("; ").map((pair) => {
      const index = pair.indexOf("=");
      return {
        domain: url.hostname,
        httpOnly: true,
        name: pair.slice(0, index),
        path: "/",
        sameSite: "Lax" as const,
        secure: false,
        value: pair.slice(index + 1),
      };
    }),
  );

  return host;
}

// Scripts the local model stand-in's reply to the next request that mentions
// `includes` (see tests/integration/support/fake-openai.ts).
export async function scriptModelReply(includes: string, reply: object) {
  const response = await fetch(`http://127.0.0.1:${process.env.FAKE_OPENAI_PORT ?? "3102"}/__rules`, {
    body: JSON.stringify({ includes, reply }),
    method: "POST",
  });

  if (!response.ok) throw new Error(`Scripting the model stand-in failed with ${response.status}.`);
}
