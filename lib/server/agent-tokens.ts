import { createHash, createPrivateKey, createPublicKey, type KeyObject, randomBytes, sign, timingSafeEqual, verify } from "node:crypto";

// Agent access tokens (agent-access D6, design 5): Ed25519-signed JWTs with the
// type at+jwt, bound to one resource, client and grant. The signing key is
// AGENT_TOKEN_SIGNING_KEY, a base64 PKCS#8 Ed25519 private key; only its public
// half is published. Verification accepts exactly one header shape (EdDSA,
// at+jwt, our key ID), so a token naming another algorithm or carrying its own
// key is refused before any signature check. Codes and refresh tokens are
// random strings stored by SHA-256 only.

export const ACCESS_TOKEN_SECONDS = 10 * 60;

export type AgentSigningKey = {
  readonly kid: string;
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  readonly publicJwk: { readonly kty: "OKP"; readonly crv: "Ed25519"; readonly x: string };
};

export class SigningKeyUnavailableError extends Error {
  constructor() {
    super("AGENT_TOKEN_SIGNING_KEY is missing or not an Ed25519 private key.");
    this.name = "SigningKeyUnavailableError";
  }
}

// The key, or null when the variable is absent or malformed: callers report
// unavailable configuration and never generate a key of their own.
export function parseSigningKey(encoded: string | undefined): AgentSigningKey | null {
  if (!encoded?.trim()) return null;

  try {
    const privateKey = createPrivateKey({ format: "der", key: Buffer.from(encoded.trim(), "base64"), type: "pkcs8" });
    if (privateKey.asymmetricKeyType !== "ed25519") return null;

    const publicKey = createPublicKey(privateKey);
    const jwk = publicKey.export({ format: "jwk" }) as { crv?: string; kty?: string; x?: string };
    if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) return null;

    // RFC 7638: the SHA-256 of the required members in lexicographic order.
    const kid = createHash("sha256").update(`{"crv":"Ed25519","kty":"OKP","x":"${jwk.x}"}`).digest("base64url");
    return { kid, privateKey, publicJwk: { crv: "Ed25519", kty: "OKP", x: jwk.x }, publicKey };
  } catch {
    return null;
  }
}

export function signingKeyFromEnvironment(env: Readonly<Record<string, string | undefined>> = process.env) {
  return parseSigningKey(env.AGENT_TOKEN_SIGNING_KEY);
}

export function jwks(key: AgentSigningKey | null) {
  return { keys: key ? [{ ...key.publicJwk, alg: "EdDSA", kid: key.kid, use: "sig" }] : [] };
}

export type AccessTokenClaims = {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly client_id: string;
  readonly grant_id: string;
  readonly scope: string;
  readonly jti: string;
  readonly iat: number;
  readonly nbf: number;
  readonly exp: number;
};

const encode = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

export function signAccessToken(
  key: AgentSigningKey,
  claims: Omit<AccessTokenClaims, "jti" | "iat" | "nbf" | "exp">,
  now: Date = new Date(),
) {
  const iat = Math.floor(now.getTime() / 1000);
  const payload: AccessTokenClaims = { ...claims, exp: iat + ACCESS_TOKEN_SECONDS, iat, jti: randomBytes(16).toString("base64url"), nbf: iat };
  const input = `${encode({ alg: "EdDSA", kid: key.kid, typ: "at+jwt" })}.${encode(payload)}`;
  const signature = sign(null, Buffer.from(input, "utf8"), key.privateKey).toString("base64url");
  return { expiresIn: ACCESS_TOKEN_SECONDS, token: `${input}.${signature}` };
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function decodePart(part: string): unknown {
  if (!BASE64URL.test(part)) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// The verified claims, or null for anything else: a malformed token, another
// header shape, a bad signature, or a wrong issuer, audience, time or claim type.
export function verifyAccessToken(
  key: AgentSigningKey | null,
  token: string,
  expected: { readonly issuer: string; readonly audience: string },
  now: Date = new Date(),
): AccessTokenClaims | null {
  if (!key || token.length > 4096) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const header = decodePart(headerPart) as Record<string, unknown> | null;

  if (
    !header ||
    Object.keys(header).sort().join(",") !== "alg,kid,typ" ||
    header.alg !== "EdDSA" ||
    header.typ !== "at+jwt" ||
    header.kid !== key.kid ||
    !BASE64URL.test(signaturePart)
  ) {
    return null;
  }

  const signed = verify(null, Buffer.from(`${headerPart}.${payloadPart}`, "utf8"), key.publicKey, Buffer.from(signaturePart, "base64url"));
  if (!signed) return null;

  const claims = decodePart(payloadPart) as Partial<AccessTokenClaims> | null;
  const seconds = Math.floor(now.getTime() / 1000);
  const strings = ["iss", "aud", "sub", "client_id", "grant_id", "scope", "jti"] as const;
  const numbers = ["iat", "nbf", "exp"] as const;

  if (
    !claims ||
    strings.some((name) => typeof claims[name] !== "string") ||
    numbers.some((name) => !Number.isInteger(claims[name])) ||
    claims.iss !== expected.issuer ||
    claims.aud !== expected.audience ||
    claims.nbf! > seconds + 30 ||
    claims.exp! <= seconds ||
    claims.exp! - claims.iat! > ACCESS_TOKEN_SECONDS
  ) {
    return null;
  }

  return claims as AccessTokenClaims;
}

export function randomToken() {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
export const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/;

// RFC 7636 S256: the challenge is the base64url SHA-256 of the verifier.
export function verifiesChallenge(verifier: string, challenge: string) {
  if (!VERIFIER.test(verifier) || !CODE_CHALLENGE.test(challenge)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier, "ascii").digest("base64url"));
  const given = Buffer.from(challenge);
  return computed.length === given.length && timingSafeEqual(computed, given);
}
