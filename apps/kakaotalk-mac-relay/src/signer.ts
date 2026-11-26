import { createHmac, randomBytes } from "node:crypto";

// Request signing for the relay routes (host-kakaotalk-channel design 2;
// apps/kakaotalk-relay/PROTOCOL.md "Signing"). The Mac relay signs exactly as
// the Android relay does: hex HMAC-SHA256 of METHOD\npath\ntimestamp\nnonce\nbody,
// keyed by the UTF-8 bytes of the secret. It has its own copy, as the phone app
// does, because it runs on the Mac with no access to lib/server; signer.test.ts
// checks it against the protocol's known-answer vectors.

export const TIMESTAMP_HEADER = "X-FMAT-Relay-Timestamp";
export const NONCE_HEADER = "X-FMAT-Relay-Nonce";
export const SIGNATURE_HEADER = "X-FMAT-Relay-Signature";

export function canonical(method: string, path: string, timestamp: string, nonce: string, body: string) {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${body}`;
}

export function sign(secret: string, method: string, path: string, timestamp: string, nonce: string, body: string) {
  return createHmac("sha256", secret).update(canonical(method, path, timestamp, nonce, body), "utf8").digest("hex");
}

// The headers of one signed POST.
export function signedHeaders(secret: string, path: string, body: string, nowMs: number, nonce: string = randomBytes(16).toString("hex")) {
  const timestamp = String(Math.floor(nowMs / 1000));
  return {
    "content-type": "application/json; charset=utf-8",
    [NONCE_HEADER]: nonce,
    [SIGNATURE_HEADER]: sign(secret, "POST", path, timestamp, nonce, body),
    [TIMESTAMP_HEADER]: timestamp,
  };
}

// A link code as the service's LINK_CODE pattern finds it (lib/server/redaction.ts),
// with JavaScript's \b spelled out as ASCII, as the phone app does.
const LINK_CODE = /(?<![A-Za-z0-9_])FMAT-[0-9A-HJKMNP-TV-Z]{10}(?![A-Za-z0-9_])/gi;

// The distinct link codes in a text, upper-cased, in order of first appearance.
export function linkCodes(text: string) {
  return [...new Set(Array.from(text.matchAll(LINK_CODE), (match) => match[0].toUpperCase()))];
}

// A void_code event's hash: HMAC of the upper-cased code under the inbound secret.
export function codeHash(inboundSecret: string, code: string) {
  return createHmac("sha256", inboundSecret).update(code.toUpperCase(), "utf8").digest("hex");
}
