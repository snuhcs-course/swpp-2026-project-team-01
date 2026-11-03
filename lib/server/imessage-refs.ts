import { createHash } from "node:crypto";

// A request's reference in text (host-imessage-channel D8): six Crockford base32
// characters from the SHA-256 of the request ID. Kept apart from the command
// parser so the outbox can name a request in a WhatsApp template
// (host-whatsapp-channel design 8) without importing the commands.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function requestRef(requestId: string) {
  const bytes = createHash("sha256").update(requestId, "utf8").digest();
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 6) {
      out += ALPHABET[(value >> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length === 6) break;
  }
  return out;
}
