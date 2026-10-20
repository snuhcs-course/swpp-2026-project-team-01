import { describe, expect, it } from "vitest";
import { photonSignature, verifyPhotonSignature } from "./photon-webhook";

// Photon's documented signature scheme (https://photon.codes/docs/webhooks/verifying-signatures).

const secret = "a".repeat(64);
const body = '{"event":"messages"}';
const now = 1_790_000_000;

function headers(overrides: Record<string, string> = {}) {
  return new Headers({
    "x-spectrum-signature": photonSignature(secret, String(now), body),
    "x-spectrum-timestamp": String(now),
    "x-spectrum-webhook-id": "hook",
    ...overrides,
  });
}

describe("Photon webhook signatures", () => {
  it("are v0= and lowercase hex HMAC-SHA256 of v0:<timestamp>:<body>", () => {
    expect(photonSignature(secret, "1", "x")).toMatch(/^v0=[0-9a-f]{64}$/);
  });

  it("verify the exact body within five minutes", () => {
    const config = { secret, webhookId: "hook" };
    expect(verifyPhotonSignature(config, headers(), body, now)).toBe(true);
    expect(verifyPhotonSignature(config, headers(), body, now + 300)).toBe(true);
    expect(verifyPhotonSignature(config, headers(), body, now + 301)).toBe(false);
    expect(verifyPhotonSignature(config, headers(), `${body} `, now)).toBe(false);
  });

  it("refuse another secret, a missing timestamp and another webhook", () => {
    expect(verifyPhotonSignature({ secret: "b".repeat(64), webhookId: null }, headers(), body, now)).toBe(false);
    expect(verifyPhotonSignature({ secret, webhookId: null }, headers({ "x-spectrum-timestamp": "" }), body, now)).toBe(false);
    expect(verifyPhotonSignature({ secret, webhookId: "other" }, headers(), body, now)).toBe(false);
  });
});
