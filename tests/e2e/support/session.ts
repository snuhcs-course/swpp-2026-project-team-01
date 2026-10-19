import type { BrowserContext } from "@playwright/test";
import { signInHost } from "../../integration/support/auth";
import { clearServiceWindow, testDatabase } from "../../integration/support/database";

// Test-only sign-in: the harness completes the real Supabase Auth PKCE flow
// against the LOCAL stack (only Google's leg is simulated in the database) and
// puts the resulting session cookies into the browser. No application route
// offers a bypass.

export const db = testDatabase();

export async function signedInHost(context: BrowserContext, baseURL: string) {
  const host = await signInHost(db);
  const url = new URL(baseURL);

  await context.addCookies(
    host.cookie.split("; ").map((pair) => {
      const index = pair.indexOf("=");
      return {
        domain: url.hostname,
        httpOnly: false,
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

export { clearServiceWindow };
