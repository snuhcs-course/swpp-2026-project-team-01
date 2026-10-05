import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { freshDb, U } from "./helpers"

// Route handlers must await the async services: an un-awaited promise serializes to `{}` and the UI reports "서버 응답을 확인하지 못했어요".
beforeEach(async () => {
  const { db } = await freshDb()
  vi.stubEnv("APP_MODE", "demo")
  ;(globalThis as unknown as { __mvpDb: unknown }).__mvpDb = { db }
})
afterEach(() => { vi.unstubAllEnvs(); delete (globalThis as unknown as { __mvpDb?: unknown }).__mvpDb })

const get = (path: string) => new Request(`http://localhost${path}`, { headers: { cookie: `uid=${U.jiho}` } })

it("returns real JSON bodies for read routes", async () => {
  const { GET: events } = await import("@/app/api/imported-events/route")
  expect(await (await events(get("/api/imported-events"))).json()).toMatchObject({ ok: true, data: [] })
  const { GET: calendar } = await import("@/app/api/calendar/route")
  expect(await (await calendar(get("/api/calendar"))).json()).toMatchObject({ ok: true, data: { sources: [] } })
  const { GET: profile } = await import("@/app/api/profile/route")
  expect((await (await profile(get("/api/profile"))).json()).ok).toBe(true)
})
