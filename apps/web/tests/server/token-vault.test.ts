// AI-generated with Codex (gpt-6-astra), 2026-10-05
import { expect, it } from "vitest"
import { TokenVault } from "@/server/token-vault"
it("encrypts with randomized authenticated owner binding and rejects tampering/wrong key", () => {
  const vault = new TokenVault(Buffer.alloc(32, 1))
  const value = vault.encrypt("refresh-token", "owner:subject:connection")
  expect(value).not.toContain("refresh-token")
  expect(vault.encrypt("refresh-token", "owner:subject:connection")).not.toBe(value)
  expect(vault.decrypt(value, "owner:subject:connection")).toBe("refresh-token")
  expect(() => vault.decrypt(value, "other:subject:connection")).toThrow()
  expect(() => new TokenVault(Buffer.alloc(32, 2)).decrypt(value, "owner:subject:connection")).toThrow()
  const parts = value.split("."); parts[3] = Buffer.from("tampered").toString("base64url")
  expect(() => vault.decrypt(parts.join("."), "owner:subject:connection")).toThrow()
  expect(() => new TokenVault(Buffer.alloc(31))).toThrow()
})
