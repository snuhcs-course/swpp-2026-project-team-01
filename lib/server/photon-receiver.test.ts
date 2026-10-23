import { describe, expect, it } from "vitest";
import { inboundMessage, normalizeSender, photonSignature, verifyPhotonSignature } from "./photon-receiver";

// Photon's webhook signature (`v0=` and the hex HMAC-SHA256 of
// `v0:{timestamp}:{raw body}`, five-minute window), the sender identifier
// format (D2) and the `messages` payload the receiver stores.

const secret = "whsec_test_photon_secret";
const body = '{"event":"messages"}';
const now = Math.floor(new Date("2026-10-23T12:00:00Z").getTime() / 1000);

function headers(signature: string, timestamp = String(now)) {
  return new Headers({ "x-spectrum-signature": signature, "x-spectrum-timestamp": timestamp });
}

describe("verifyPhotonSignature", () => {
  const valid = photonSignature(secret, String(now), body);

  it("accepts the signature over the raw body", () => {
    expect(valid).toMatch(/^v0=[0-9a-f]{64}$/);
    expect(verifyPhotonSignature(secret, headers(valid), body, now)).toBe(true);
  });

  it("refuses a changed body, timestamp or secret", () => {
    expect(verifyPhotonSignature(secret, headers(valid), `${body} `, now)).toBe(false);
    expect(verifyPhotonSignature(secret, headers(valid, String(now + 1)), body, now)).toBe(false);
    expect(verifyPhotonSignature("another", headers(valid), body, now)).toBe(false);
  });

  it("refuses a timestamp more than five minutes away, and a missing one", () => {
    const old = String(now - 301);
    expect(verifyPhotonSignature(secret, headers(photonSignature(secret, old, body), old), body, now)).toBe(false);
    const edge = String(now - 300);
    expect(verifyPhotonSignature(secret, headers(photonSignature(secret, edge, body), edge), body, now)).toBe(true);
    expect(verifyPhotonSignature(secret, new Headers({ "x-spectrum-signature": valid }), body, now)).toBe(false);
  });
});

describe("normalizeSender", () => {
  it("keeps an E.164 number and lower-cases an Apple ID email", () => {
    expect(normalizeSender("+15551234567")).toBe("+15551234567");
    expect(normalizeSender(" +821012345678 ")).toBe("+821012345678");
    expect(normalizeSender("Host@iCloud.com")).toBe("host@icloud.com");
  });

  it("refuses anything else", () => {
    expect(normalizeSender("15551234567")).toBeNull();
    expect(normalizeSender("+1 555 123 4567")).toBeNull();
    expect(normalizeSender("any;-;+15551234567")).toBeNull();
    expect(normalizeSender(42)).toBeNull();
  });
});

describe("inboundMessage", () => {
  const event = {
    event: "messages",
    message: {
      content: { text: "request K7Q2MX", type: "text" },
      direction: "inbound",
      id: "msg_1",
      platform: "imessage",
      sender: { id: "+15551234567", platform: "imessage" },
      space: { id: "any;-;+15551234567", phone: "+15550000000", platform: "imessage", type: "dm" },
      timestamp: "2026-10-23T12:00:00.000Z",
    },
    space: { id: "any;-;+15551234567", phone: "+15550000000", platform: "imessage", type: "dm" },
  };

  it("reads a direct text message", () => {
    expect(inboundMessage(event)).toEqual({
      contentType: "text",
      messageId: "msg_1",
      sender: "+15551234567",
      sentAt: new Date("2026-10-23T12:00:00.000Z"),
      spaceId: "any;-;+15551234567",
      spaceType: "dm",
      text: "request K7Q2MX",
    });
  });

  it("keeps group conversations and other content without text, for the job to refuse", () => {
    const group = { ...event, space: { ...event.space, id: "chat123", type: "group" } };
    expect(inboundMessage(group)?.spaceType).toBe("group");
    const attachment = { ...event, message: { ...event.message, content: { id: "a1", mimeType: "image/png", name: "a.png", type: "attachment" } } };
    expect(inboundMessage(attachment)).toMatchObject({ contentType: "attachment", text: null });
  });

  it("drops other events, outbound echoes and payloads without locators", () => {
    expect(inboundMessage({ ...event, event: "reactions" })).toBeNull();
    expect(inboundMessage({ ...event, message: { ...event.message, direction: "outbound" } })).toBeNull();
    expect(inboundMessage({ ...event, message: { ...event.message, sender: { id: "unknown" } } })).toBeNull();
    expect(inboundMessage({ ...event, message: { ...event.message, id: "" } })).toBeNull();
    expect(inboundMessage(null)).toBeNull();
  });
});
