import { ForbiddenError } from "eve/channels/auth";
import { describe, expect, it } from "vitest";
import type { Database } from "./database";
import { createAppAuth } from "./eve-auth";

// Requests refused on their route alone; the database is never consulted.
const db = (() => {
  throw new Error("A malformed route must not reach the database.");
}) as unknown as Database;
const appAuth = createAppAuth(() => ({
  auth: { publishableKey: "publishable", url: "http://127.0.0.1:54321" },
  db,
  signingKey: "a-test-signing-key-of-at-least-32-characters",
}));

describe("appAuth routes", () => {
  it("refuses a malformed session ID as forbidden, not a server error", async () => {
    const malformed = "/eve/v1/session/%E0%A4%A";

    await expect(
      appAuth(new Request(`http://127.0.0.1${malformed}/stream`, { headers: { cookie: "sb-127-auth-token=x" } })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      appAuth(new Request(`http://127.0.0.1${malformed}`, { headers: { authorization: "Bearer a.b.c" }, method: "POST" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
