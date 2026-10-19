import { describe, expect, it } from "vitest";
import { appOriginsFromEnvironment, crossSiteRefusal, requestAppOrigin } from "./same-origin";

const appOrigin = "https://findmeatime.com";

function post(headers: Record<string, string>) {
  return new Request(`${appOrigin}/api/chat/messages`, { body: "{}", headers, method: "POST" });
}

describe("cross-site refusal", () => {
  it("allows the app's own origin with JSON", () => {
    expect(crossSiteRefusal(post({ "content-type": "application/json; charset=utf-8", origin: appOrigin }), appOrigin, { json: true })).toBeNull();
  });

  it("refuses a missing, foreign or look-alike origin", () => {
    for (const origin of [undefined, "https://evil.example", "https://findmeatime.com.evil.example", "http://findmeatime.com", "null"]) {
      const refused = crossSiteRefusal(post({ "content-type": "application/json", ...(origin ? { origin } : {}) }), appOrigin, { json: true });
      expect(refused?.status).toBe(403);
    }
  });

  it("refuses a body a cross-site form could send to a JSON route", () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      expect(crossSiteRefusal(post({ "content-type": type, origin: appOrigin }), appOrigin, { json: true })?.status).toBe(415);
    }
    expect(crossSiteRefusal(post({ origin: appOrigin }), appOrigin, { json: true })?.status).toBe(415);
  });

  it("allows a same-origin form post to a route without a body", () => {
    expect(crossSiteRefusal(post({ "content-type": "application/x-www-form-urlencoded", origin: appOrigin }), appOrigin, { json: false })).toBeNull();
  });

  const origins = { allowedOrigins: ["https://release.findmeatime.com"], appOrigin };

  function postTo(target: string, headers: Record<string, string>) {
    return new Request(`${target}/api/chat/messages`, {
      body: "{}",
      headers: { "content-type": "application/json", ...headers },
      method: "POST",
    });
  }

  it("serves each listed origin from its own pages", () => {
    for (const origin of [appOrigin, "https://release.findmeatime.com"]) {
      expect(crossSiteRefusal(postTo(origin, { origin }), origins, { json: true })).toBeNull();
    }
  });

  it("refuses one listed origin posting to another, and any unlisted host", () => {
    expect(
      crossSiteRefusal(postTo(appOrigin, { origin: "https://release.findmeatime.com" }), origins, { json: true })?.status,
    ).toBe(403);
    // A forged Host or forwarded host whose Origin matches it is still unlisted.
    expect(crossSiteRefusal(postTo("https://evil.example", { origin: "https://evil.example" }), origins, { json: true })?.status).toBe(403);
    expect(
      crossSiteRefusal(
        postTo(appOrigin, { origin: "https://evil.example", "x-forwarded-host": "evil.example" }),
        origins,
        { json: true },
      )?.status,
    ).toBe(403);
  });

  it("resolves the addressed origin from the forwarding proxy only within the list", () => {
    const forwarded = (host: string) =>
      new Request("http://internal:3000/auth/sign-in", { headers: { "x-forwarded-host": host, "x-forwarded-proto": "https" } });

    expect(requestAppOrigin(forwarded("release.findmeatime.com"), origins)).toBe("https://release.findmeatime.com");
    expect(requestAppOrigin(forwarded("findmeatime.com"), origins)).toBe(appOrigin);
    expect(requestAppOrigin(forwarded("evil.example"), origins)).toBeNull();
  });

  it("reads the canonical origin and the comma-separated allowlist", () => {
    expect(
      appOriginsFromEnvironment({
        APP_ALLOWED_ORIGINS: " https://release.findmeatime.com/ , ",
        APP_ORIGIN: "https://findmeatime.com/app",
      }),
    ).toEqual({ allowedOrigins: ["https://release.findmeatime.com"], appOrigin });
    expect(appOriginsFromEnvironment({ APP_ORIGIN: appOrigin })).toEqual({ allowedOrigins: [], appOrigin });
  });
});
