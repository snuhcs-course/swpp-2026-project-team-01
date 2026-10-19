import { afterAll, describe, expect, it } from "vitest";
import { sessionAccessToken } from "../../lib/server/supabase-auth";
import { localAuthConfig, localStack, signInHost } from "./support/auth";
import { testDatabase } from "./support/database";

// What a browser can reach with the publishable key, signed out or signed in:
// pg_net's request queue and responses (which can carry the worker secret) and
// Vault are outside the Data API, through REST and GraphQL alike.

const db = testDatabase();

afterAll(async () => {
  await db.end();
});

async function accessToken() {
  const host = await signInHost(db);
  return (await sessionAccessToken(new Request("http://localhost/", { headers: { cookie: host.cookie } }), localAuthConfig()))!;
}

describe("Data API exposure", () => {
  it.each([
    ["net", "http_request_queue"],
    ["net", "_http_response"],
    ["vault", "decrypted_secrets"],
    ["vault", "secrets"],
  ])("refuses %s.%s to anon and authenticated callers", async (schema, table) => {
    const { API_URL, PUBLISHABLE_KEY } = localStack();
    const token = await accessToken();

    for (const authorization of [undefined, `Bearer ${token}`]) {
      const response = await fetch(`${API_URL}/rest/v1/${table}?select=*`, {
        headers: { "accept-profile": schema, apikey: PUBLISHABLE_KEY, ...(authorization ? { authorization } : {}) },
      });
      expect(response.status).toBe(406);
      expect(((await response.json()) as { code: string }).code).toBe("PGRST106");
    }
  });

  it("exposes no pg_net or Vault type through GraphQL", async () => {
    const { API_URL, PUBLISHABLE_KEY } = localStack();
    const response = await fetch(`${API_URL}/graphql/v1`, {
      body: JSON.stringify({ query: "{ __schema { types { name } } }" }),
      headers: { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
      method: "POST",
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toMatch(/http_request|http_response|secret/i);
  });
});
