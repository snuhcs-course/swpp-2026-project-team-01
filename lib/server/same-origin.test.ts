import { describe, expect, it } from "vitest";
import { crossSiteRefusal } from "./same-origin";

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
});
