import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openToken, parseTokenKey, sealToken, TokenDecryptionError } from "./token-encryption";

const refreshToken = "1//0g-refresh-token-for-tests";
const context = "provider_grant:google:5d0c3c5e-0000-4000-8000-000000000001";

function newKey() {
  return parseTokenKey(randomBytes(32).toString("base64"));
}

describe("token encryption", () => {
  it("round-trips a token under the same key and context", () => {
    const key = newKey();
    const sealed = sealToken(key, refreshToken, context);

    expect(sealed.keyId).toBe(key.id);
    expect(sealed.ciphertext).not.toContain(refreshToken);
    expect(openToken([key], sealed, context)).toBe(refreshToken);
  });

  it("uses a fresh nonce for every seal", () => {
    const key = newKey();

    expect(sealToken(key, refreshToken, context).ciphertext).not.toBe(
      sealToken(key, refreshToken, context).ciphertext,
    );
  });

  it("rejects a different key presented under the stored key identifier", () => {
    const key = newKey();
    const sealed = sealToken(key, refreshToken, context);
    const impostor = { id: key.id, key: randomBytes(32) };

    expect(() => openToken([impostor], sealed, context)).toThrow(TokenDecryptionError);
  });

  it("rejects an unknown key identifier", () => {
    const sealed = sealToken(newKey(), refreshToken, context);

    expect(() => openToken([newKey()], sealed, context)).toThrow("unknown key");
  });

  it("rejects a ciphertext moved to another context", () => {
    const key = newKey();
    const sealed = sealToken(key, refreshToken, context);

    expect(() => openToken([key], sealed, `${context}-other`)).toThrow(TokenDecryptionError);
  });

  it("rejects a tampered ciphertext", () => {
    const key = newKey();
    const sealed = sealToken(key, refreshToken, context);
    const parts = sealed.ciphertext.split(".");
    const body = Buffer.from(parts[3] ?? "", "base64url");
    body[0] = (body[0] ?? 0) ^ 1;
    const tampered = { ...sealed, ciphertext: [...parts.slice(0, 3), body.toString("base64url")].join(".") };

    expect(() => openToken([key], tampered, context)).toThrow(TokenDecryptionError);
  });

  it("derives a stable identifier that does not reveal the key", () => {
    const encoded = randomBytes(32).toString("base64");
    const key = parseTokenKey(encoded);

    expect(parseTokenKey(encoded).id).toBe(key.id);
    expect(key.id).toMatch(/^[0-9a-f]{16}$/);
    expect(encoded).not.toContain(key.id);
  });

  it("refuses a missing or malformed key", () => {
    expect(() => parseTokenKey(undefined)).toThrow("TOKEN_ENCRYPTION_KEY is not set");
    expect(() => parseTokenKey(randomBytes(16).toString("base64"))).toThrow("32-byte");
    expect(() => parseTokenKey("not base64!")).toThrow("32-byte");
  });
});
