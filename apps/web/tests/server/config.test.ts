import { describe, expect, it } from "vitest"
import { readServerConfig } from "@/server/config"
describe("mode configuration", () => {
  it("requires a database URL in real mode and rejects invalid mode", () => {
    expect(readServerConfig({}).databaseUrl).toBeUndefined()
    expect(() => readServerConfig({APP_MODE:"real"})).toThrow(/DATABASE_URL/)
    expect(readServerConfig({APP_MODE:"real",DATABASE_URL:"postgresql://x"}).databaseUrl).toBe("postgresql://x")
    expect(() => readServerConfig({APP_MODE:"bogus"})).toThrow()
  })
  it("rejects demo reset in real mode", () => {
    expect(readServerConfig({APP_MODE:"real",DATABASE_URL:"postgresql://x"}).allowReset).toBe(false)
    expect(readServerConfig({APP_MODE:"demo"}).allowReset).toBe(true)
  })
})
