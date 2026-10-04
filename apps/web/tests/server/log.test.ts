import { afterEach, describe, expect, it, vi } from "vitest"
import { logEvent } from "@/server/log"

const env = process.env as Record<string, string | undefined>
const original = env.NODE_ENV
afterEach(async () => {
  env.NODE_ENV = original
  delete env.LOG_LEVEL
  vi.restoreAllMocks()
})

describe("logEvent", () => {
  it("is silent under test", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    logEvent("x", { a: 1 })
    expect(spy).not.toHaveBeenCalled()
  })

  it("prints one JSON object per line otherwise, and can be silenced", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    env.NODE_ENV = "development"
    logEvent("chat.turn", { count: 3 })
    expect(spy).toHaveBeenCalledTimes(1)
    const line = JSON.parse(String(spy.mock.calls[0][0]))
    expect(line).toMatchObject({ event: "chat.turn", count: 3 })
    expect(new Date(line.ts).toString()).not.toBe("Invalid Date")
    env.LOG_LEVEL = "silent"
    logEvent("chat.turn")
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
