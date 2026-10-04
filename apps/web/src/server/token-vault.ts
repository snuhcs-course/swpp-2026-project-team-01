import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

/** v1 AES-256-GCM; AAD must include the owner, Google sub, and connection ID. */
export class TokenVault {
  private readonly key: Buffer
  constructor(key: Buffer | string) {
    this.key = Buffer.isBuffer(key) ? Buffer.from(key)
      : /^[a-f\d]{64}$/i.test(key) ? Buffer.from(key, "hex") : Buffer.from(key, "base64")
    if (this.key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must encode exactly 32 bytes")
  }
  encrypt(token: string, owner: string): string {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv)
    cipher.setAAD(Buffer.from(owner))
    const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()])
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".")
  }
  decrypt(value: string, owner: string): string {
    const [version, iv, tag, ciphertext, extra] = value.split(".")
    if (version !== "v1" || !iv || !tag || !ciphertext || extra !== undefined) throw new Error("Invalid token envelope")
    const ivBytes = Buffer.from(iv, "base64url"), tagBytes = Buffer.from(tag, "base64url")
    if (ivBytes.length !== 12 || tagBytes.length !== 16) throw new Error("Invalid token envelope")
    const decipher = createDecipheriv("aes-256-gcm", this.key, ivBytes)
    decipher.setAAD(Buffer.from(owner)); decipher.setAuthTag(tagBytes)
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8")
  }
}
