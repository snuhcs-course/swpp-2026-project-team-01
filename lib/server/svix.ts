import { createHmac, timingSafeEqual } from "node:crypto";

// Svix webhook signatures, as AgentMail sends them (requester-email-channel
// design 1). The signed content is `{svix-id}.{svix-timestamp}.{raw body}`, the
// key is the base64 part of the `whsec_` secret, and `svix-signature` lists one
// or more space-separated `v1,{base64 HMAC-SHA256}` values. A timestamp more than
// five minutes from now is refused, so a captured delivery cannot be replayed
// later. Written here rather than taken from the svix package: it is the one
// function the receiver needs, and it must run before anything else is read.

export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export type SvixHeaders = {
  readonly id: string | null;
  readonly timestamp: string | null;
  readonly signature: string | null;
};

export function svixHeaders(headers: Headers): SvixHeaders {
  return {
    id: headers.get("svix-id"),
    signature: headers.get("svix-signature"),
    timestamp: headers.get("svix-timestamp"),
  };
}

function secretKey(secret: string) {
  const encoded = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const key = Buffer.from(encoded, "base64");
  return key.length > 0 ? key : null;
}

export function svixSignature(secret: string, id: string, timestamp: string, body: string) {
  const key = secretKey(secret);
  if (!key) throw new Error("The signing secret is not base64.");
  return createHmac("sha256", key).update(`${id}.${timestamp}.${body}`, "utf8").digest("base64");
}

// True only when one listed v1 signature matches and the timestamp is fresh.
export function verifySvixSignature(
  secret: string,
  headers: SvixHeaders,
  body: string,
  now: Date = new Date(),
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
) {
  const { id, signature, timestamp } = headers;

  if (!id || !signature || !timestamp || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > toleranceSeconds) return false;

  const key = secretKey(secret);
  if (!key) return false;

  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`, "utf8").digest();

  return signature.split(" ").some((entry) => {
    const [version, value] = entry.split(",", 2);
    if (version !== "v1" || !value) return false;
    const presented = Buffer.from(value, "base64");
    return presented.length === expected.length && timingSafeEqual(presented, expected);
  });
}
