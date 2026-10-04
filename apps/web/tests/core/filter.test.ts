import { describe, expect, it } from "vitest"
import { filterChips, slotLabel } from "@/core/chips"
import { applyFilter, mergeFilter, rankSlots, scoreSlot } from "@/core/filter"
import { decideOptions, pickDiverse } from "@/core/options"
import { summarize } from "@/core/summary"
import { kstParts } from "@/core/time"
import type { Filter, Slot } from "@/core/types"
import { NEAR, ONLINE, PLACES, SPECIAL, T, T30, T60 } from "./helpers"

const slot = (date: string, hm: string, placeId = ONLINE.id, typeId = T30.id, slackMin = 60): Slot => ({
  startMs: T(date, hm),
  endMs: T(date, hm) + 30 * 60_000,
  placeId,
  meetingTypeId: typeId,
  slackMin,
})

// 2026-10-05 Mon … 2026-10-09 Fri, 2026-10-10 Sat
const week: Slot[] = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"].flatMap((d) => [
  slot(d, "10:00"),
  slot(d, "14:00"),
  slot(d, "15:00", NEAR.id),
])

describe("mergeFilter", () => {
  it("replaces the same kind and adds different kinds", () => {
    const a: Filter = { timeOfDay: { start: "13:00", end: "18:00", strength: "strong" } }
    const b = mergeFilter(a, { set: { timeOfDay: { start: "08:00", end: "12:00", strength: "strong" }, order: "earliest" } })
    expect(b.timeOfDay?.start).toBe("08:00")
    expect(b.order).toBe("earliest")
  })
  it("removes a kind and does not mutate its input", () => {
    const a: Filter = { order: "earliest", slack: { strength: "weak" } }
    const b = mergeFilter(a, { remove: ["order"] })
    expect(b).toEqual({ slack: { strength: "weak" } })
    expect(a.order).toBe("earliest")
  })
})

describe("applyFilter / rankSlots", () => {
  it("'must' removes non-matching slots", () => {
    const f: Filter = { weekdays: { days: [1, 2, 3, 4], strength: "must" } }
    expect(applyFilter(week, f).every((s) => kstParts(s.startMs).weekday !== 5)).toBe(true)
    expect(applyFilter(week, f)).toHaveLength(12)
  })
  it("'strong'/'weak' never remove slots, they only score", () => {
    const f: Filter = { timeOfDay: { start: "13:00", end: "18:00", strength: "strong" }, places: { placeIds: [ONLINE.id], strength: "weak" } }
    const ranked = rankSlots(week, f)
    expect(ranked).toHaveLength(week.length)
    expect(ranked[0].score).toBe(13)
    expect(scoreSlot(slot("2026-10-05", "10:00", NEAR.id), f)).toBe(0)
  })
  it("date range is inclusive of both ends", () => {
    const f: Filter = { dateRange: { from: "2026-10-06", to: "2026-10-07", strength: "must" } }
    expect(applyFilter(week, f)).toHaveLength(6)
  })
  it("time of day matches on start time, [start, end)", () => {
    const f: Filter = { timeOfDay: { start: "14:00", end: "15:00", strength: "must" } }
    expect(applyFilter(week, f)).toHaveLength(5)
  })
  it("orders ties earliest first by default, latest first when asked, and is deterministic", () => {
    const early = rankSlots(week, {})
    expect(early[0].slot.startMs).toBe(T("2026-10-05", "10:00"))
    const late = rankSlots(week, { order: "latest" })
    expect(late[0].slot.startMs).toBe(T("2026-10-05", "15:00")) // nearest day, latest time on it
    expect(late.slice(0, 3).map((x) => x.slot.startMs)).toEqual([T("2026-10-05", "15:00"), T("2026-10-05", "14:00"), T("2026-10-05", "10:00")])
    expect(rankSlots([...week].reverse(), {})).toEqual(early)
  })
  it("'latest' never jumps to the farthest date: dates stay nearest-first", () => {
    const far = [slot("2026-10-05", "12:00"), slot("2026-11-25", "21:30"), slot("2026-10-06", "20:00")]
    expect(rankSlots(far, { order: "latest" }).map((x) => x.slot.startMs)).toEqual([T("2026-10-05", "12:00"), T("2026-10-06", "20:00"), T("2026-11-25", "21:30")])
    expect(rankSlots(far, { order: "earliest" }).map((x) => x.slot.startMs)).toEqual([T("2026-10-05", "12:00"), T("2026-10-06", "20:00"), T("2026-11-25", "21:30")])
  })
  it("score still outranks date and time", () => {
    const f: Filter = { places: { placeIds: [NEAR.id], strength: "strong" }, order: "latest" }
    const s = [slot("2026-10-05", "20:00"), slot("2026-10-09", "10:00", NEAR.id)]
    expect(rankSlots(s, f)[0].slot.placeId).toBe(NEAR.id)
  })
  it("slack adds up to the strength weight", () => {
    const f: Filter = { slack: { strength: "strong" } }
    expect(scoreSlot(slot("2026-10-05", "10:00", ONLINE.id, T30.id, 120), f)).toBe(10)
    expect(scoreSlot(slot("2026-10-05", "10:00", ONLINE.id, T30.id, 60), f)).toBe(5)
    expect(scoreSlot(slot("2026-10-05", "10:00", ONLINE.id, T30.id, 500), f)).toBe(10)
  })
})

describe("summarize", () => {
  it("counts by week, weekday, time of day, place, and type", () => {
    const s = summarize(rankSlots(week, {}), {}, week)
    expect(s.count).toBe(15)
    expect(s.byWeek).toEqual([{ weekStart: "2026-10-05", count: 15 }])
    expect(s.byWeekday).toEqual([0, 3, 3, 3, 3, 3, 0])
    expect(s.byTimeOfDay).toEqual({ morning: 5, afternoon: 10, evening: 0 })
    expect(s.byPlace).toEqual({ [ONLINE.id]: 10, [NEAR.id]: 5 })
    expect(s.firstDate).toBe("2026-10-05")
    expect(s.lastDate).toBe("2026-10-09")
    expect(s.tieCountAtTop).toBe(15)
    expect(s.relax).toEqual({})
  })
  it("with no results, reports how many slots each 'must' would free up", () => {
    const f: Filter = {
      weekdays: { days: [6], strength: "must" },
      timeOfDay: { start: "10:00", end: "11:00", strength: "must" },
      places: { placeIds: [SPECIAL.id], strength: "strong" },
    }
    const ranked = rankSlots(week, f)
    expect(ranked).toHaveLength(0)
    const s = summarize(ranked, f, week)
    expect(s.count).toBe(0)
    expect(s.relax.weekdays).toBe(5) // drop the weekend-only condition: 10:00 slots on 5 weekdays
    expect(s.relax.timeOfDay).toBe(0) // still no Saturday slots
    expect(s.relax.places).toBeUndefined() // not a 'must'
  })
})

describe("decideOptions", () => {
  const many = (scores: number[]) => scores.map((score, i) => ({ slot: slot("2026-10-05", "10:00", ONLINE.id, T30.id, i), score }))
  it("shows nothing when there are no slots", () => {
    expect(decideOptions([], {}, true).show).toBe(false)
  })
  it("shows when the user asked, even if scores tie", () => {
    const d = decideOptions(many([0, 0, 0, 0, 0]), {}, true)
    expect(d).toMatchObject({ show: true, reason: "requested" })
    expect(d.top).toHaveLength(3)
  })
  it("shows when 3 or fewer remain", () => {
    expect(decideOptions(many([0, 0]), {}, false)).toMatchObject({ show: true, reason: "few" })
    expect(decideOptions(many([0, 0, 0]), {}, false).top).toHaveLength(3)
  })
  it("shows when the 3rd and 4th scores differ", () => {
    expect(decideOptions(many([10, 10, 10, 3, 3]), {}, false)).toMatchObject({ show: true, reason: "settled" })
  })
  it("does not show when the top 3 tie with the 4th", () => {
    expect(decideOptions(many([10, 10, 3, 3, 3]), {}, false).show).toBe(false)
    expect(decideOptions(many([0, 0, 0, 0]), {}, false).show).toBe(false)
  })
  it("an explicit order settles the ranking", () => {
    expect(decideOptions(many([0, 0, 0, 0]), { order: "earliest" }, false)).toMatchObject({ show: true, reason: "settled" })
  })
})

describe("labels", () => {
  it("formats a button line", () => {
    expect(slotLabel(slot("2026-10-07", "14:00", NEAR.id, T60.id), PLACES, [T30, T60])).toBe("10월 7일(수) 14:00 · 회사 근처 카페 · 60분 상담")
  })
  it("formats chips", () => {
    const chips = filterChips(
      {
        dateRange: { from: "2026-10-05", to: "2026-10-09", strength: "must" },
        weekdays: { days: [1, 2, 3, 4], strength: "must" },
        timeOfDay: { start: "13:00", end: "18:00", strength: "strong" },
        places: { placeIds: [ONLINE.id], strength: "strong" },
        order: "earliest",
      },
      PLACES,
      [T30, T60],
    ).map((c) => c.label)
    expect(chips).toEqual(["10/5–10/9 · 반드시", "월–목 · 반드시", "13:00–18:00 · 강", "온라인 · 강", "빠른 순"])
  })
  it("exposes the condition text and strength separately, and labels 'latest' by what it does", () => {
    const chips = filterChips({ weekdays: { days: [1, 2, 3, 4, 5], strength: "weak" }, order: "latest" }, PLACES, [T30])
    expect(chips).toEqual([
      { key: "weekdays", text: "평일", strength: "weak", label: "평일 · 약" },
      { key: "order", text: "늦은 시각 우선", strength: null, label: "늦은 시각 우선" },
    ])
  })
})

describe("pickDiverse (button candidates)", () => {
  const r = (date: string, hm: string, placeId = ONLINE.id, typeId = T30.id) => ({ slot: slot(date, hm, placeId, typeId), score: 0 })

  it("does not repeat a start time with another place or length", () => {
    const ranked = [r("2026-10-05", "12:00", ONLINE.id, T60.id), r("2026-10-05", "12:00", ONLINE.id, T30.id), r("2026-10-05", "12:00", NEAR.id, T30.id), r("2026-10-05", "13:00"), r("2026-10-05", "14:00")]
    const top = pickDiverse(ranked)
    expect(top.map((x) => x.slot.startMs)).toEqual([T("2026-10-05", "12:00"), T("2026-10-05", "13:00"), T("2026-10-05", "14:00")])
    expect(top[0]).toBe(ranked[0]) // the best-ranked one at that time is kept
  })

  it("keeps same-day buttons an hour apart but treats other days as distinct", () => {
    const ranked = [r("2026-10-05", "12:00"), r("2026-10-05", "12:30"), r("2026-10-06", "12:00"), r("2026-10-07", "12:30")]
    expect(pickDiverse(ranked).map((x) => x.slot.startMs)).toEqual([T("2026-10-05", "12:00"), T("2026-10-06", "12:00"), T("2026-10-07", "12:30")])
  })

  it("preserves rank order among the picks", () => {
    const ranked = [r("2026-10-09", "10:00"), r("2026-10-05", "10:00"), r("2026-10-06", "10:00")]
    expect(pickDiverse(ranked)).toEqual(ranked)
  })

  it("fills up with the next-best candidates when there are not enough distinct ones", () => {
    const ranked = [r("2026-10-05", "12:00", ONLINE.id), r("2026-10-05", "12:00", NEAR.id), r("2026-10-05", "12:30", SPECIAL.id)]
    expect(pickDiverse(ranked)).toEqual(ranked)
    expect(pickDiverse(ranked.slice(0, 2))).toEqual(ranked.slice(0, 2))
    expect(pickDiverse([])).toEqual([])
  })

  it("decideOptions shows the diversified picks", () => {
    const ranked = [r("2026-10-05", "12:00", ONLINE.id, T60.id), r("2026-10-05", "12:00", ONLINE.id, T30.id), r("2026-10-05", "13:00"), r("2026-10-05", "14:00")]
    const d = decideOptions(ranked, { order: "earliest" }, false)
    expect(d.show).toBe(true)
    expect(d.top.map((x) => x.slot.startMs)).toEqual([T("2026-10-05", "12:00"), T("2026-10-05", "13:00"), T("2026-10-05", "14:00")])
  })
})

// T11: exact participant scoring has no epsilon or score summation.
describe("rankForParticipants", () => {
  const empty = { weekdays: null, startTime: null, meetingMode: null, slack: null }
  it("host_breaks_only_exact_client_ties", async () => {
    const { rankForParticipants } = await import("@/core/filter")
    const host = { ...empty, meetingMode: { value: "offline" as const, strength: "strong" as const } }
    const a = { ...slot("2026-10-05", "10:00"), slackMs: 3_630_000 }
    const b = { ...slot("2026-10-05", "10:00", NEAR.id), slackMs: 3_600_000 }
    const ranked = rankForParticipants([b, a], { slack: { strength: "weak" } }, host, PLACES)
    expect(ranked.map(r => r.slot.placeId)).toEqual([ONLINE.id, NEAR.id])
    expect(ranked[0].clientScoreUnits! - ranked[1].clientScoreUnits!).toBe(90_000)
    expect(ranked[1].hostScoreUnits).toBe(72_000_000)
    expect(rankForParticipants([b, { ...a, slackMs: b.slackMs }], { slack: { strength: "weak" } }, host, PLACES)[0].slot.placeId).toBe(NEAR.id)
  })
  it("explicit latest precedes host preference and keeps nearest date first", async () => {
    const { rankForParticipants } = await import("@/core/filter")
    const host = { ...empty, meetingMode: { value: "offline" as const, strength: "strong" as const } }
    const data = [slot("2026-10-05", "10:00", NEAR.id), slot("2026-10-05", "14:00"), slot("2026-10-06", "20:00", NEAR.id)]
    expect(rankForParticipants(data, { order: "latest" }, host, PLACES).map(r => r.slot.startMs)).toEqual([T("2026-10-05", "14:00"), T("2026-10-05", "10:00"), T("2026-10-06", "20:00")])
  })
  it("location scores once; unavailable soft modes do not remove slots", async () => {
    const { rankForParticipants } = await import("@/core/filter")
    const { resolvePreferences } = await import("@/core/preferences")
    const snapshot = { ...empty, meetingMode: { value: "online" as const, strength: "strong" as const } }
    const client = resolvePreferences(snapshot, { location: { state: "override", value: { placeIds: [NEAR.id], strength: "weak" } } })
    const ranked = rankForParticipants([slot("2026-10-05", "10:00"), slot("2026-10-05", "10:00", NEAR.id)], client, empty, PLACES)
    expect(ranked.map(r => r.clientScoreUnits)).toEqual([21_600_000, 0])
    expect(rankForParticipants([slot("2026-10-05", "10:00", NEAR.id)], resolvePreferences(snapshot, {}), empty, [NEAR])).toHaveLength(1)
    expect(rankForParticipants(week, { meetingMode: { value: "offline", strength: "must" } }, empty, PLACES)).toHaveLength(5)
  })
  it("clamps exact slack to zero and 120 minutes", async () => {
    const { rankForParticipants } = await import("@/core/filter")
    const ranked = rankForParticipants([-30_000, 9_000_000].map(slackMs => ({ ...slot("2026-10-05", "10:00"), slackMs })), { slack: { strength: "strong" } }, empty, PLACES)
    expect(ranked.map(r => r.clientScoreUnits)).toEqual([72_000_000, 0])
  })
})
