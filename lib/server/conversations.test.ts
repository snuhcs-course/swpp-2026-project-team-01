import { describe, expect, it } from "vitest";
import { agentUrlFromEnvironment, supabaseSessionCookie } from "./conversations";

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
