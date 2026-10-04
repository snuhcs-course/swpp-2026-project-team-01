import { describe, expect, it, vi } from "vitest"
import { OAuth2Client } from "google-auth-library"
import { GoogleAuth, CALENDAR_SCOPES } from "@/server/providers/google-auth"
const config = { clientId: "client-id", clientSecret: "test-secret", redirectUri: "https://app.example/api/auth/google/callback" }
describe("Google adapter", () => {
  it("requests identity only for login and read-only Calendar scopes with offline consent separately", () => {
    const auth = new GoogleAuth(config)
    const login = new URL(auth.authorizationUrl({ purpose: "login", state: "state", nonce: "nonce" }))
    expect(login.searchParams.get("scope")).toBe("openid email profile")
    const calendar = new URL(auth.authorizationUrl({ purpose: "calendar", state: "s", nonce: "n" }))
    expect(calendar.searchParams.get("scope")?.split(" ")).toEqual(["openid", "email", "profile", ...CALENDAR_SCOPES])
    expect(calendar.searchParams.get("access_type")).toBe("offline")
    expect(calendar.searchParams.get("prompt")).toBe("consent")
    expect(calendar.searchParams.get("nonce")).toBe("n")
  })
  it("requires verified issuer, audience, expiration and subject; sanitizes provider failures", async () => {
    const client = new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri)
    vi.spyOn(client, "getToken").mockResolvedValue({ tokens: { id_token: "signed-id", refresh_token: "refresh", scope: "openid email profile" }, res: null } as never)
    const payload = { iss: "https://accounts.google.com", aud: "client-id", exp: 2000, sub: "stable-sub", nonce: "nonce", name: "Name", iat: 900 }
    const verify = vi.spyOn(client, "verifyIdToken").mockResolvedValue({ getPayload: () => payload } as never)
    const auth = new GoogleAuth(config, client, () => 1000000)
    expect(await auth.exchange("code")).toMatchObject({ subject: "stable-sub", nonce: "nonce", name: "Name" })
    expect(verify).toHaveBeenCalledWith({ idToken: "signed-id", audience: "client-id" })
    for (const change of [{ iss: "https://evil.example" }, { aud: "other-client" }, { exp: 1000 }, { sub: "" }]) {
      verify.mockResolvedValueOnce({ getPayload: () => ({ ...payload, ...change }) } as never)
      await expect(auth.exchange("code")).rejects.toMatchObject({ code: "invalid_input" })
    }
    verify.mockRejectedValueOnce(new Error("secret provider response"))
    await expect(auth.exchange("code")).rejects.not.toThrow("secret provider response")
  })
})
