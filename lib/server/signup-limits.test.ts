import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sourceBucket, sourceHash } from "./signup-limits";
import { parseTokenKey } from "./token-encryption";

const key = parseTokenKey(randomBytes(32).toString("base64"));

function request(headers: Record<string, string>) {
  return new Request("https://findmeatime.com/auth/callback", { headers });
}

describe("sign-up source hash", () => {
  it("keys on the first x-forwarded-for hop", () => {
    const hash = sourceHash(key, request({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }));

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sourceHash(key, request({ "x-forwarded-for": "203.0.113.7" }))).toBe(hash);
    expect(sourceHash(key, request({ "x-forwarded-for": "203.0.113.8, 10.0.0.1" }))).not.toBe(hash);
    expect(hash).not.toContain("203.0.113.7");
  });

  it("falls back to x-real-ip, then one shared unknown bucket", () => {
    expect(sourceHash(key, request({ "x-real-ip": "198.51.100.2" }))).toBe(
      sourceHash(key, request({ "x-forwarded-for": "198.51.100.2" })),
    );
    expect(sourceHash(key, request({}))).toBe(sourceHash(key, request({ "x-forwarded-for": " " })));
  });

  it("differs under another token key, so it cannot be matched without the key", () => {
    const other = parseTokenKey(randomBytes(32).toString("base64"));
    const headers = { "x-forwarded-for": "203.0.113.7" };

    expect(sourceHash(other, request(headers))).not.toBe(sourceHash(key, request(headers)));
  });
});

describe("sourceBucket", () => {
  it("counts IPv6 addresses by their /64 prefix", () => {
    expect(sourceBucket("2001:db8:abcd:12:1::7")).toBe("2001:db8:abcd:12::/64");
    expect(sourceBucket("2001:db8:abcd:12:ffff:ffff:ffff:1")).toBe("2001:db8:abcd:12::/64");
    expect(sourceBucket("2001:0db8::1")).toBe("2001:db8:0:0::/64");
  });

  it("keeps IPv4, IPv4-mapped and unparseable values as they are", () => {
    expect(sourceBucket("203.0.113.9")).toBe("203.0.113.9");
    expect(sourceBucket("::ffff:203.0.113.9")).toBe("::ffff:203.0.113.9");
    expect(sourceBucket("unknown")).toBe("unknown");
  });
});
