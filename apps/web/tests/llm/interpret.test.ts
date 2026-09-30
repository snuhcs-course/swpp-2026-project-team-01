import { describe, expect, it } from "vitest"
import { buildInterpretMessages, interpret, parseInterpretOutput } from "@/llm/interpret"
import { OllamaHttpError, type ChatClient, type ChatMessage } from "@/llm/ollama"
import { PLACES, ONLINE, NEAR, T, T30, T60 } from "../core/helpers"

const NOW = T("2026-09-29", "10:00") // Tuesday
const ctx = { nowMs: NOW, places: PLACES, meetingTypes: [T30, T60] }

describe("parseInterpretOutput", () => {
  it("accepts a full, valid change", () => {
    const { change, showOptions } = parseInterpretOutput(
      {
        set: {
          dateRange: { from: "2026-10-05", to: "2026-10-11", strength: "must" },
          weekdays: { days: [4, 1, 2, 3, 1], strength: "must" },
          timeOfDay: { start: "12:00", end: "18:00", strength: "strong" },
          places: { placeIds: [ONLINE.id], strength: "strong" },
          meetingTypes: { ids: [T30.id], strength: "weak" },
          order: "earliest",
          slack: { strength: "weak" },
        },
        remove: [],
        showOptions: true,
      },
      ctx,
    )
    expect(showOptions).toBe(true)
    expect(change.set?.weekdays).toEqual({ days: [1, 2, 3, 4], strength: "must" })
    expect(change.set?.order).toBe("earliest")
    expect(Object.keys(change.set ?? {})).toHaveLength(7)
  })

  it("drops unknown place and meeting type ids, and a key left empty", () => {
    const { change } = parseInterpretOutput(
      { set: { places: { placeIds: ["nope", ONLINE.id], strength: "must" }, meetingTypes: { ids: ["nope"], strength: "must" } } },
      ctx,
    )
    expect(change.set?.places?.placeIds).toEqual([ONLINE.id])
    expect(change.set?.meetingTypes).toBeUndefined()
  })

  it("clamps a date range to today…today+59 days and drops ranges fully outside", () => {
    const clamped = parseInterpretOutput({ set: { dateRange: { from: "2026-09-01", to: "2027-06-01", strength: "must" } } }, ctx)
    expect(clamped.change.set?.dateRange).toEqual({ from: "2026-09-29", to: "2026-11-27", strength: "must" })
    expect(parseInterpretOutput({ set: { dateRange: { from: "2026-08-01", to: "2026-08-05", strength: "must" } } }, ctx).change.set?.dateRange).toBeUndefined()
    expect(parseInterpretOutput({ set: { dateRange: { from: "2027-01-01", to: "2027-01-05", strength: "must" } } }, ctx).change.set?.dateRange).toBeUndefined()
  })

  it("swaps a reversed date range", () => {
    const { change } = parseInterpretOutput({ set: { dateRange: { from: "2026-10-09", to: "2026-10-05", strength: "must" } } }, ctx)
    expect(change.set?.dateRange).toMatchObject({ from: "2026-10-05", to: "2026-10-09" })
  })

  it("drops malformed values without failing the rest", () => {
    const { change } = parseInterpretOutput(
      {
        set: {
          timeOfDay: { start: "25:00", end: "18:00", strength: "must" },
          weekdays: { days: [9, -1], strength: "must" },
          slack: { strength: "must" },
          order: "sideways",
          bogus: { a: 1 },
          places: { placeIds: [NEAR.id], strength: "strong" },
        },
      },
      ctx,
    )
    expect(Object.keys(change.set ?? {})).toEqual(["places"])
  })

  it("treats null as remove, and a key in both set and remove as set", () => {
    const { change } = parseInterpretOutput({ set: { places: null, order: "latest" }, remove: ["order", "slack", "bogus"] }, ctx)
    expect(change.set).toEqual({ order: "latest" })
    expect([...(change.remove ?? [])].sort()).toEqual(["places", "slack"])
  })

  it("only an explicit true counts as showOptions", () => {
    expect(parseInterpretOutput({ set: {}, showOptions: "true" }, ctx).showOptions).toBe(false)
    expect(parseInterpretOutput({}, ctx).showOptions).toBe(false)
  })

  it("rejects non-objects", () => {
    expect(() => parseInterpretOutput([1], ctx)).toThrow()
    expect(() => parseInterpretOutput("x", ctx)).toThrow()
  })
})

describe("buildInterpretMessages", () => {
  it("gives the model today, a next-week calendar, ids, and the latest user message", () => {
    const msgs = buildInterpretMessages({ ...ctx, filter: { order: "earliest" }, history: [{ role: "user", content: "다음 주 오후" }] })
    expect(msgs[0].role).toBe("system")
    const payload = JSON.parse(msgs[1].content)
    expect(payload.today).toBe("2026-09-29")
    expect(payload.todayWeekday).toBe("화")
    expect(payload.calendar.nextWeek).toMatchObject({ 월: "2026-10-05", 일: "2026-10-11" })
    expect(payload.calendar.thisWeek).toMatchObject({ 월: "2026-09-28" })
    expect(payload.places.map((p: { id: string }) => p.id)).toContain(ONLINE.id)
    expect(payload.currentFilter).toEqual({ order: "earliest" })
    expect(payload.latestUserMessage).toBe("다음 주 오후")
  })
})

describe("relative requests", () => {
  it("passes the buttons last shown, by name, so 'a bit later' has something to be relative to", () => {
    const shown = [
      { startMs: T("2026-10-05", "12:00"), placeId: NEAR.id, meetingTypeId: T30.id },
      { startMs: T("2026-10-06", "14:00"), placeId: ONLINE.id, meetingTypeId: T60.id },
    ]
    const payload = JSON.parse(buildInterpretMessages({ ...ctx, filter: {}, history: [{ role: "user", content: "조금 더 늦은 시간은?" }], lastShown: shown })[1].content)
    expect(payload.lastShownOptions).toEqual([
      { date: "2026-10-05", weekday: "월", start: "12:00", place: NEAR.name, meetingType: T30.name },
      { date: "2026-10-06", weekday: "화", start: "14:00", place: ONLINE.name, meetingType: T60.name },
    ])
  })
  it("is an empty list when nothing has been shown", () => {
    const payload = JSON.parse(buildInterpretMessages({ ...ctx, filter: {}, history: [{ role: "user", content: "x" }] })[1].content)
    expect(payload.lastShownOptions).toEqual([])
  })
  it("the system prompt defines 'latest' as later in the day and routes relative requests to timeOfDay", () => {
    const system = buildInterpretMessages({ ...ctx, filter: {}, history: [{ role: "user", content: "x" }] })[0].content
    expect(system).toContain("가장 먼 날짜를 뜻하지 않는다")
    expect(system).toContain("order가 아니라 timeOfDay")
    expect(system).toContain("6시쯤 → start=\"17:30\", end=\"19:00\"")
  })
})

describe("interpret (call ①)", () => {
  const scripted = (replies: (string | Error)[]) => {
    const seen: ChatMessage[][] = []
    const client: ChatClient = {
      async chat(messages) {
        seen.push(messages)
        const r = replies[Math.min(seen.length - 1, replies.length - 1)]
        if (r instanceof Error) throw r
        return r
      },
    }
    return { client, seen }
  }
  const input = { ...ctx, filter: {}, history: [{ role: "user" as const, content: "빠른 걸로" }] }

  it("parses a fenced reply", async () => {
    const { client } = scripted(['```json\n{"set":{"order":"earliest"},"remove":[],"showOptions":true}\n```'])
    const r = await interpret(client, input)
    expect(r).toMatchObject({ change: { set: { order: "earliest" }, remove: [] }, showOptions: true, failed: false, failure: null, attempts: 1 })
  })

  it("retries once after unusable output", async () => {
    const { client, seen } = scripted(["죄송합니다", '{"set":{"order":"latest"}}'])
    const r = await interpret(client, input)
    expect(r.failed).toBe(false)
    expect(r.change.set?.order).toBe("latest")
    expect(seen).toHaveLength(2)
  })

  it("retries once after a request error", async () => {
    const { client, seen } = scripted([new Error("boom"), '{"set":{}}'])
    const r = await interpret(client, input)
    expect(r).toMatchObject({ failed: false, attempts: 2 })
    expect(seen).toHaveLength(2)
  })

  it("fails without changing anything after two bad replies", async () => {
    const { client, seen } = scripted(["nope"])
    const r = await interpret(client, input)
    expect(r).toMatchObject({ change: {}, showOptions: false, failed: true, failure: "unparseable", attempts: 2 })
    expect(seen).toHaveLength(2)
  })

  it("reports an unreachable service as 'unavailable', not as a failed interpretation", async () => {
    for (const err of [new OllamaHttpError(429), new OllamaHttpError(402), new TypeError("fetch failed")]) {
      const { client, seen } = scripted([err])
      expect(await interpret(client, input)).toMatchObject({ failed: true, failure: "unavailable", attempts: 2 })
      expect(seen).toHaveLength(2)
    }
  })

  it("records how long it took", async () => {
    const { client } = scripted(['{"set":{}}'])
    expect((await interpret(client, input)).ms).toBeGreaterThanOrEqual(0)
  })
})
