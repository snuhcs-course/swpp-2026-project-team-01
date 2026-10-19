import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Provider refresh tokens are sealed with AES-256-GCM before they reach the
// database. The key identifier is a fingerprint of the key, stored beside each
// ciphertext, so a later rotation can tell which key sealed a row. The context
// is bound as additional authenticated data, so a ciphertext copied to another
// row does not open.

const KEY_BYTES = 32;
const IV_BYTES = 12;
const FORMAT = "v1";

export type TokenKey = {
  readonly id: string;
  readonly key: Buffer;
};

export type SealedToken = {
  readonly ciphertext: string;
  readonly keyId: string;
};

export class TokenDecryptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TokenDecryptionError";
  }
}

export function parseTokenKey(encoded: string | undefined): TokenKey {
  if (!encoded) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not set.");
  }

  const key = Buffer.from(encoded, "base64");

  if (key.length !== KEY_BYTES || key.toString("base64") !== encoded.trim()) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }

  const id = createHash("sha256")
    .update("find-me-a-time/token-key/v1\u0000")
    .update(key)
    .digest("hex")
    .slice(0, 16);

  return { id, key };
}

export function tokenKeyFromEnvironment() {
  return parseTokenKey(process.env.TOKEN_ENCRYPTION_KEY);
}

export function sealToken(key: TokenKey, plaintext: string, context: string): SealedToken {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key.key, iv);
  cipher.setAAD(additionalData(key.id, context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    ciphertext: [
      FORMAT,
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join("."),
    keyId: key.id,
  };
}

export function openToken(keys: readonly TokenKey[], sealed: SealedToken, context: string) {
  const key = keys.find((candidate) => candidate.id === sealed.keyId);

  if (!key) {
    throw new TokenDecryptionError("The token was sealed with an unknown key.");
  }

  const [format, iv, tag, ciphertext, ...rest] = sealed.ciphertext.split(".");

  if (format !== FORMAT || !iv || !tag || !ciphertext || rest.length > 0) {
    throw new TokenDecryptionError("The sealed token uses an unsupported format.");
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", key.key, Buffer.from(iv, "base64url"));
    decipher.setAAD(additionalData(key.id, context));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    throw new TokenDecryptionError("The sealed token could not be opened.", { cause: error });
  }
}

function additionalData(keyId: string, context: string) {
  return Buffer.from(`${FORMAT}\u0000${keyId}\u0000${context}`);
}
