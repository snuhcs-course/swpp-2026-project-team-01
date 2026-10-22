import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { jwks, parseSigningKey, signAccessToken, verifiesChallenge, verifyAccessToken } from "./agent-tokens";

function encodedKey() {
  const { privateKey } = generateKeyPairSync("ed25519");
  return privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
}

const key = parseSigningKey(encodedKey())!;
const expected = { audience: "https://findmeatime.com/mcp", issuer: "https://findmeatime.com" };
const claims = {
  aud: expected.audience,
  client_id: "fmat-cli",
  grant_id: "6f0d2c39-6d3c-4d4d-9a51-4d6b7b2f0c11",
  iss: expected.issuer,
  scope: "host:read",
  sub: "host:1",
};

describe("the signing key", () => {
  it("accepts only an Ed25519 PKCS#8 key and never invents one", () => {
    expect(parseSigningKey(undefined)).toBeNull();
    expect(parseSigningKey("not base64 at all")).toBeNull();
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    expect(parseSigningKey(rsa)).toBeNull();
    expect(jwks(null)).toEqual({ keys: [] });
  });

  it("publishes only the public key under its thumbprint", () => {
    const set = jwks(key);
    expect(set.keys).toHaveLength(1);
    expect(set.keys[0]).toMatchObject({ alg: "EdDSA", crv: "Ed25519", kid: key.kid, kty: "OKP", use: "sig" });
    expect(set.keys[0]).not.toHaveProperty("d");
  });
});

describe("access tokens", () => {
  const now = new Date("2026-10-22T10:00:00Z");

  it("verify only for the issuer, audience and time they were issued for", () => {
    const { token } = signAccessToken(key, claims, now);
    expect(verifyAccessToken(key, token, expected, now)).toMatchObject(claims);
    expect(verifyAccessToken(key, token, { ...expected, audience: "https://findmeatime.com/dodo/mcp" }, now)).toBeNull();
    expect(verifyAccessToken(key, token, { ...expected, issuer: "https://release.findmeatime.com" }, now)).toBeNull();
    expect(verifyAccessToken(key, token, expected, new Date(now.getTime() + 11 * 60_000))).toBeNull();
    expect(verifyAccessToken(null, token, expected, now)).toBeNull();
  });

  it("refuse another key, a changed claim, alg none and a token-supplied key", () => {
    const { token } = signAccessToken(key, claims, now);
    const other = parseSigningKey(encodedKey())!;
    expect(verifyAccessToken(other, token, expected, now)).toBeNull();

    const [header, payload, signature] = token.split(".") as [string, string, string];
    const widened = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), scope: "host:read host:write" })).toString("base64url");
    expect(verifyAccessToken(key, `${header}.${widened}.${signature}`, expected, now)).toBeNull();

    const none = Buffer.from(JSON.stringify({ alg: "none", kid: key.kid, typ: "at+jwt" })).toString("base64url");
    expect(verifyAccessToken(key, `${none}.${payload}.`, expected, now)).toBeNull();

    // A header that carries its own key, signed with that key.
    const attacker = generateKeyPairSync("ed25519");
    const withJwk = Buffer.from(
      JSON.stringify({ alg: "EdDSA", jwk: attacker.publicKey.export({ format: "jwk" }), kid: key.kid, typ: "at+jwt" }),
    ).toString("base64url");
    const forged = sign(null, Buffer.from(`${withJwk}.${payload}`), attacker.privateKey).toString("base64url");
    expect(verifyAccessToken(key, `${withJwk}.${payload}.${forged}`, expected, now)).toBeNull();

    const wrongType = Buffer.from(JSON.stringify({ alg: "EdDSA", kid: key.kid, typ: "JWT" })).toString("base64url");
    const typed = sign(null, Buffer.from(`${wrongType}.${payload}`), key.privateKey).toString("base64url");
    expect(verifyAccessToken(key, `${wrongType}.${payload}.${typed}`, expected, now)).toBeNull();
  });
});

describe("PKCE", () => {
  it("accepts only the S256 challenge of the verifier", () => {
    const verifier = "a".repeat(43) + "-._~";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(verifiesChallenge(verifier, challenge)).toBe(true);
    expect(verifiesChallenge(`${verifier}x`, challenge)).toBe(false);
    expect(verifiesChallenge("short", challenge)).toBe(false);
    expect(verifiesChallenge(verifier, verifier)).toBe(false);
  });
});
