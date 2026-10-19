import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ClientError } from "eve/client";
import { describe, expect, it } from "vitest";
import { agentUrlFromEnvironment, eveRuntime, supabaseSessionCookie } from "./conversations";

const production = { VERCEL: "1", VERCEL_ENV: "production" };

describe("agent URL", () => {
  it("requires https in production", () => {
    expect(() => agentUrlFromEnvironment({ ...production, EVE_AGENT_URL: "http://agent.internal" })).toThrow(/https/);
    expect(() => agentUrlFromEnvironment({ ...production, APP_ORIGIN: "http://findmeatime.com" })).toThrow(/https/);
    expect(agentUrlFromEnvironment({ ...production, APP_ORIGIN: "https://findmeatime.com/app" })).toBe("https://findmeatime.com");
  });

  it("allows http outside production", () => {
    expect(agentUrlFromEnvironment({ EVE_AGENT_URL: "http://127.0.0.1:2000" })).toBe("http://127.0.0.1:2000");
    expect(agentUrlFromEnvironment({ APP_ORIGIN: "http://localhost:3000", VERCEL: "1", VERCEL_ENV: "preview" })).toBe(
      "http://localhost:3000",
    );
  });
});

describe("forwarded cookie", () => {
  it("keeps only the Supabase session cookie and its chunks", () => {
    const cookie =
      "theme=dark; sb-abc-auth-token.0=base64-one; sb-abc-auth-token.1=two; sb-abc-auth-token-code-verifier=v; _vercel_jwt=x; sb-abc-auth-token=base64-whole";

    expect(supabaseSessionCookie(cookie)).toBe(
      "sb-abc-auth-token.0=base64-one; sb-abc-auth-token.1=two; sb-abc-auth-token=base64-whole",
    );
    expect(supabaseSessionCookie("theme=dark")).toBe("");
  });
});

describe("sending to the agent", () => {
  it("gives up on a send the agent never answers, as an unknown outcome", async () => {
    // Accepts the request and never responds.
    const server = createServer(() => {});
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const started = Date.now();
      const sent = eveRuntime(`http://127.0.0.1:${port}`, { sendTimeoutMs: 200 }).sendMessage("wrun_01EXAMPLE", "a.b.c", "Hello.");

      const error = await sent.catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(ClientError);
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
