import { describe, expect, it } from "vitest";
import { messageFingerprint } from "./internal-bearer";
import {
  protectedFingerprint,
  protectInput,
  REMOVED_CREDENTIAL,
  redactCredentials,
  sameProtectedInput,
} from "./redaction";

const uuid = "6f1c2b9e-0d4a-4f1e-8a59-3c3a4b5d6e7f";
const R = REMOVED_CREDENTIAL;

describe("credential redaction", () => {
  it("keeps the scheduling context around a bearer value", () => {
    expect(redactCredentials("Meet Tuesday 3pm at Gangnam. Authorization: Bearer eyJhbGciOi.J9-x_y+z/w==")).toBe(
      `Meet Tuesday 3pm at Gangnam. Authorization: Bearer ${R}`,
    );
    expect(redactCredentials("bearer abc123def456")).toBe(`bearer ${R}`);
  });

  it("removes a LINK proof", () => {
    expect(redactCredentials(`Please LINK ${uuid} 8f3k2-proof and book Friday`)).toBe(`Please ${R} and book Friday`);
    expect(redactCredentials(`link ${uuid.toUpperCase()} abcdef`)).toBe(R);
  });

  it.each(["token", "code", "state", "secret", "proof", "recovery", "invitation", "credential", "access_token", "id_token"])(
    "removes the %s parameter value",
    (name) => {
      expect(redactCredentials(`See https://example.com/cb?x=1&${name}=s3cr3t&y=2 tomorrow`)).toBe(
        `See https://example.com/cb?x=1&${name}=${R}&y=2 tomorrow`,
      );
    },
  );

  it("removes credential parameters regardless of casing and percent encoding", () => {
    expect(redactCredentials("https://a.example/?TOKEN=abc")).toBe(`https://a.example/?TOKEN=${R}`);
    expect(redactCredentials("https://a.example/?Access_Token=abc")).toBe(`https://a.example/?Access_Token=${R}`);
    expect(redactCredentials("https://a.example/?%74oken=abc")).toBe(`https://a.example/?%74oken=${R}`);
    expect(redactCredentials("https://a.example/?%2574oken=abc")).toBe(`https://a.example/?%2574oken=${R}`);
    expect(redactCredentials("https://a.example/?st%41te=abc")).toBe(`https://a.example/?st%41te=${R}`);
    expect(redactCredentials("https://a.example/?code%3Dabc")).toBe(`https://a.example/?code%3D${R}`);
    expect(redactCredentials("https://a.example/next?to=https%3A%2F%2Fb.example%2F%3Ftoken%3Dabc")).toBe(
      `https://a.example/next?to=https%3A%2F%2Fb.example%2F%3Ftoken%3D${R}`,
    );
  });

  it("removes a proof in a URL fragment", () => {
    expect(redactCredentials("https://findmeatime.com/link#proof=xyz&state=abc")).toBe(
      `https://findmeatime.com/link#proof=${R}&state=${R}`,
    );
  });

  it("removes a booking link with or without an origin", () => {
    expect(redactCredentials(`My link is https://findmeatime.com/booking/${uuid} ok`)).toBe(`My link is ${R} ok`);
    expect(redactCredentials(`open findmeatime.com/booking/${uuid}`)).toBe(`open ${R}`);
    expect(redactCredentials(`try /booking/${uuid}`)).toBe(`try ${R}`);
    expect(redactCredentials(`http://localhost:3000/booking/${uuid}/events`)).toBe(`${R}/events`);
  });

  it("removes a booking link whatever its casing or percent encoding", () => {
    expect(redactCredentials(`HTTPS://FINDMEATIME.COM/BOOKING/${uuid.toUpperCase()}`)).toBe(R);
    expect(redactCredentials(`https://findmeatime.com%2Fbooking%2F${uuid}`)).toBe(R);
    expect(redactCredentials(`/booking/${uuid.replaceAll("-", "%2D")}`)).toBe(R);
    expect(redactCredentials(`/booking/${uuid.replaceAll("-", "")}`)).toBe(R);
  });

  it("removes a bare UUID from requester and intake input only", () => {
    const text = `My booking is ${uuid}, and ${uuid.toUpperCase().replaceAll("-", "")} too`;

    expect(redactCredentials(text, { bareUuids: true })).toBe(`My booking is ${R}, and ${R} too`);
    expect(protectInput("key", text, { bareUuids: true }).message).not.toMatch(new RegExp(uuid, "i"));
    expect(redactCredentials(text)).toBe(text);
    // Part of a longer identifier is not a UUID.
    expect(redactCredentials(`id-${uuid}x`, { bareUuids: true })).toBe(`id-${uuid}x`);
  });

  it("removes a confirmation link", () => {
    expect(redactCredentials("https://findmeatime.com/booking/confirm/AbC_dEf-0123456789xyzXYZ please")).toBe(`${R} please`);
  });

  it("leaves ordinary prose and links unchanged", () => {
    const prose = [
      "Can we meet next Tuesday at 10:00 at Gangnam Station exit 11?",
      "Here is the venue: https://maps.google.com/?q=Gangnam+Station&hl=ko",
      "My booking reference is 1234, and the code of conduct is on our site.",
      "Use https://meet.google.com/abc-defg-hij for the call.",
      "다음 주 화요일 오후 3시에 강남역에서 만나요.",
      "https://findmeatime.com/booking",
      "Bearer of good news: the venue is open.",
    ];

    for (const text of prose) {
      expect(redactCredentials(text)).toBe(text);
    }
  });

  it("redacts the intake composer's text the same way before it is stored", () => {
    const original = `I'm Grace, my old link was https://findmeatime.com/booking/${uuid}?code=12345`;
    const input = protectInput("signing-key", original);

    expect(input.message).not.toContain(uuid);
    expect(input.message).not.toContain("12345");
    expect(input.message).toContain("I'm Grace");
    expect(input.fingerprint).toBe(messageFingerprint(input.message));
  });

  it("is idempotent", () => {
    const once = redactCredentials(`Bearer abc-123-xyz /booking/${uuid} ?token=x`);
    expect(redactCredentials(once)).toBe(once);
  });
});

describe("protected retry fingerprints", () => {
  it("tells a changed secret apart under identical protected text", () => {
    const first = protectInput("key", "Book it, Bearer one-11111");
    const second = protectInput("key", "Book it, Bearer two-22222");

    expect(first.message).toBe(second.message);
    expect(first.protectedFingerprint).not.toBe(second.protectedFingerprint);
    expect(
      sameProtectedInput({ fingerprint: first.fingerprint, protected_fingerprint: first.protectedFingerprint }, "key", "Book it, Bearer two-22222"),
    ).toBe(false);
    expect(
      sameProtectedInput({ fingerprint: first.fingerprint, protected_fingerprint: first.protectedFingerprint }, "key", "Book it, Bearer one-11111"),
    ).toBe(true);
  });

  it("stores no plain fingerprint of the original text", () => {
    const original = "Bearer secret-123";
    expect(protectedFingerprint("key", original)).not.toBe(messageFingerprint(original));
  });

  it("compares an input stored before protection by its plain fingerprint", () => {
    const stored = { fingerprint: messageFingerprint("hello Bearer x-1234567"), protected_fingerprint: null };

    expect(sameProtectedInput(stored, "key", "hello Bearer x-1234567")).toBe(true);
    expect(sameProtectedInput(stored, "key", "hello Bearer y-1234567")).toBe(false);
  });
});
