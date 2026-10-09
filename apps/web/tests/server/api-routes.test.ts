// AI-generated with Claude Code (claude-sonnet-5-5), 2026-10-05; Claude Code (claude-opus-5-5), 2026-10-06
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

const as = (user: string, path: string, method = "GET", body?: unknown) => new Request(`http://localhost${path}`, {
  method, headers: { cookie: `uid=${user}`, origin: "http://localhost", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined,
})

it("returns what the older host, rules and event routes read and write", async () => {
  const places = await import("@/app/api/places/route")
  const created = await (await places.POST(as(U.host, "/api/places", "POST", { kind: "special", name: "판교 카페" }))).json()
  expect(created.place).toMatchObject({ id: expect.any(String), kind: "special", name: "판교 카페" })
  expect((await (await places.GET(as(U.host, "/api/places"))).json()).places).toContainEqual(created.place)
  const types = await import("@/app/api/meeting-types/route")
  const type = await (await types.POST(as(U.host, "/api/meeting-types", "POST", { name: "리뷰", durationMin: 45 }))).json()
  expect(type.meetingType).toMatchObject({ id: expect.any(String), name: "리뷰", durationMin: 45 })
  expect((await (await types.GET(as(U.host, "/api/meeting-types"))).json()).meetingTypes).toContainEqual(type.meetingType)
  const { GET: rules } = await import("@/app/api/availability/route")
  expect((await (await rules(as(U.host, "/api/availability"))).json()).rules.length).toBeGreaterThan(0)
  // The new event must be stored before the response says so; the calendar page refreshes right after.
  const events = await import("@/app/api/events/route")
  const added = await (await events.POST(as(U.jiho, "/api/events", "POST", { title: "치과", date: "2026-10-20", start: "10:00", end: "11:00", kind: "none" }))).json()
  expect(added.id).toEqual(expect.any(String))
  expect((await (await events.GET(as(U.jiho, "/api/events"))).json()).events.map((e: { id: string }) => e.id)).toContain(added.id)
})
