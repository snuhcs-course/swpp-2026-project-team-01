import { createHmac } from "node:crypto";
import { messageFingerprint } from "./internal-bearer";

// Credential redaction for conversation input (design decision 14). Before a
// message is persisted or reaches the runtime, recognized credentials are
// replaced with a visible marker: Bearer values, `LINK <UUID> <proof>` linking
// proofs, URL parameters or fragments whose percent-decoded, case-folded name is
// a credential name or ends in _token, and booking or confirmation links (with or
// without an origin), because the booking UUID is the requester's only
// credential. Requester input (`bareUuids`) also loses any bare UUID,
// which could be a booking identifier pasted without its link; host input keeps
// them. Ordinary prose and links keep their content. Redaction confers no
// authority: nothing here follows or redeems a link.

export const REMOVED_CREDENTIAL = "[removed credential]";

const CREDENTIAL_NAMES = new Set([
  "token",
  "code",
  "state",
  "secret",
  "proof",
  "recovery",
  "invitation",
  "credential",
]);

// A slash, possibly percent-encoded, and a hyphen, possibly percent-encoded.
const SLASH = String.raw`(?:\/|%2f)`;
const HYPHEN = String.raw`(?:-|%2d)?`;
const HEX = (count: number) => `[0-9a-f]{${count}}`;
const UUID = [HEX(8), HEX(4), HEX(4), HEX(4), HEX(12)].join(HYPHEN);
// An optional origin: a scheme with a host, or a bare dotted host name.
const ORIGIN = String.raw`(?:(?:https?:)?\/\/[^\s/?#]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?)?`;

const BOOKING_LINK = new RegExp(
  `${ORIGIN}${SLASH}booking${SLASH}(?:confirm${SLASH}[A-Za-z0-9_-]{16,}|${UUID}(?![0-9a-f]))`,
  "gi",
);
// A bearer value is at least 8 token characters with a digit or punctuation, so
// prose such as "bearer of good news" stays.
const BEARER = /\b(Bearer)\s+(?=[A-Za-z0-9\-._~+/]*[0-9\-._~+/])[A-Za-z0-9\-._~+/]{8,}=*/gi;
const LINK_PROOF = new RegExp(String.raw`\bLINK\s+${UUID}\s+\S+`, "gi");
const BARE_UUID = new RegExp(`(?<![0-9a-z-])${UUID}(?![0-9a-z])`, "gi");
// A parameter: its separator (?, &, # or ;, possibly percent-encoded), its name,
// its = (possibly percent-encoded) and its value up to the next separator.
const PARAMETER = /([?&#;]|%3f|%26|%23)([A-Za-z0-9_.~+%-]+)(=|%3d)([^&#\s<>"'`]*)/gi;

function decodedName(name: string) {
  let current = name;

  // Repeated decoding, so a double-encoded name cannot slip past.
  for (let pass = 0; pass < 3; pass += 1) {
    let next: string;

    try {
      next = decodeURIComponent(current.replaceAll("+", " "));
    } catch {
      break;
    }

    if (next === current) break;
    current = next;
  }

  return current.trim().toLowerCase();
}

function isCredentialName(name: string) {
  const decoded = decodedName(name);
  return CREDENTIAL_NAMES.has(decoded) || decoded.endsWith("_token");
}

// Parameter values are scanned again when their name is ordinary, so a
// credential inside a percent-encoded nested URL (a redirect target) is found.
function redactParameters(text: string, depth = 0): string {
  return text.replace(
    PARAMETER,
    (match, separator: string, name: string, equals: string, value: string, offset: number, whole: string) => {
      const valueAt = offset + separator.length + name.length + equals.length;

      if (!value || whole.startsWith(REMOVED_CREDENTIAL, valueAt)) return match;
      if (isCredentialName(name)) return `${separator}${name}${equals}${REMOVED_CREDENTIAL}`;
      return depth < 3 ? `${separator}${name}${equals}${redactParameters(value, depth + 1)}` : match;
    },
  );
}

export type RedactionOptions = {
  // Requester input, drafts included: remove bare UUIDs too.
  readonly bareUuids?: boolean;
};

export function redactCredentials(text: string, options: RedactionOptions = {}) {
  const redacted = text
    .replace(BOOKING_LINK, REMOVED_CREDENTIAL)
    .replace(LINK_PROOF, REMOVED_CREDENTIAL)
    .replace(BEARER, (_match, word: string) => `${word} ${REMOVED_CREDENTIAL}`);
  return redactParameters(options.bareUuids ? redacted.replace(BARE_UUID, REMOVED_CREDENTIAL) : redacted);
}

// The retry fingerprint of the original, unredacted text, kept only as an HMAC,
// so a changed secret under the same retry key conflicts while the plaintext is
// gone. The key is the service's internal signing key.
export function protectedFingerprint(key: string, original: string) {
  const derived = createHmac("sha256", key).update("find-me-a-time/protected-input/v1").digest();
  return createHmac("sha256", derived).update(messageFingerprint(original)).digest("base64url");
}

export type ProtectedInput = {
  // The text that is stored and sent to the runtime.
  readonly message: string;
  // messageFingerprint() of that text, which the send bearer binds.
  readonly fingerprint: string;
  readonly protectedFingerprint: string;
};

export function protectInput(key: string, original: string, options: RedactionOptions = {}): ProtectedInput {
  const message = redactCredentials(original, options);
  return { fingerprint: messageFingerprint(message), message, protectedFingerprint: protectedFingerprint(key, original) };
}

// Whether a retried submission is the same input as a stored one. An input
// accepted before protected fingerprints existed compares by its plain
// fingerprint, which was taken over the same original text.
export function sameProtectedInput(
  stored: { readonly fingerprint: string; readonly protected_fingerprint: string | null },
  key: string,
  original: string,
) {
  return stored.protected_fingerprint === null
    ? stored.fingerprint === messageFingerprint(original)
    : stored.protected_fingerprint === protectedFingerprint(key, original);
}
