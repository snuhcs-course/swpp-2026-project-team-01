import { describe, expect, it } from "vitest";
import { svixSignature, verifySvixSignature } from "./svix";

// Svix verification as AgentMail signs webhooks: the HMAC over
// `{id}.{timestamp}.{body}` with the secret's base64 key, any listed v1
// signature, and a five-minute window.

const secret = `whsec_${Buffer.from("a test signing key of some length").toString("base64")}`;
const body = '{"event_type":"message.received"}';
const now = new Date("2026-10-22T12:00:00Z");
const timestamp = String(Math.floor(now.getTime() / 1000));

function headers(signature: string, at = timestamp, id = "msg_1") {
  return { id, signature, timestamp: at };
}

describe("verifySvixSignature", () => {
  const valid = `v1,${svixSignature(secret, "msg_1", timestamp, body)}`;

  it("accepts the signature over the raw body", () => {
    expect(verifySvixSignature(secret, headers(valid), body, now)).toBe(true);
  });

  it("accepts any one matching signature in the list", () => {
    expect(verifySvixSignature(secret, headers(`v1,AAAA ${valid}`), body, now)).toBe(true);
  });

  it("refuses a changed body, id or timestamp", () => {
    expect(verifySvixSignature(secret, headers(valid), `${body} `, now)).toBe(false);
    expect(verifySvixSignature(secret, headers(valid, timestamp, "msg_2"), body, now)).toBe(false);
    expect(verifySvixSignature(secret, headers(valid, String(Number(timestamp) + 1)), body, now)).toBe(false);
  });

  it("refuses another secret", () => {
    const other = `whsec_${Buffer.from("another key").toString("base64")}`;
    expect(verifySvixSignature(other, headers(valid), body, now)).toBe(false);
  });

  it("refuses a timestamp more than five minutes away", () => {
    const stale = String(Number(timestamp) - 301);
    const signed = `v1,${svixSignature(secret, "msg_1", stale, body)}`;
    expect(verifySvixSignature(secret, headers(signed, stale), body, now)).toBe(false);
    const fresh = String(Number(timestamp) - 299);
    expect(verifySvixSignature(secret, headers(`v1,${svixSignature(secret, "msg_1", fresh, body)}`, fresh), body, now)).toBe(true);
  });

  it("refuses missing headers, other versions and malformed timestamps", () => {
    expect(verifySvixSignature(secret, { id: null, signature: valid, timestamp }, body, now)).toBe(false);
    expect(verifySvixSignature(secret, headers(valid.replace("v1,", "v2,")), body, now)).toBe(false);
    expect(verifySvixSignature(secret, headers(valid, "12e3"), body, now)).toBe(false);
  });
});
