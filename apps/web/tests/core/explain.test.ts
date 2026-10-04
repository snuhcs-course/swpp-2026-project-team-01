import { describe, expect, it } from "vitest"
import { filterChips, slotLabel } from "@/core/chips"
import { basisSentence, describeOrder, diffChips, selectionBasis } from "@/core/explain"
import { pickDiverse } from "@/core/options"
import { rankSlots } from "@/core/filter"
import type { Filter, Slot } from "@/core/types"
import { NEAR, ONLINE, PLACES, T, T30, T60 } from "./helpers"

const slot = (date: string, hm: string, placeId = ONLINE.id, slackMin = 60): Slot => ({
  startMs: T(date, hm),
  endMs: T(date, hm) + 30 * 60_000,
  placeId,
  meetingTypeId: T30.id,
  slackMin,
})
const chipsOf = (f: Filter) => filterChips(f, PLACES, [T30, T60])

describe("describeOrder", () => {
  it("says what each ordering means", () => {
    expect(describeOrder({ order: "earliest" })).toBe("날짜가 가까운 순, 같은 날은 이른 시각 순")
    expect(describeOrder({ order: "latest" })).toBe("날짜가 가까운 순, 같은 날은 늦은 시각 순")
    expect(describeOrder({})).toBe("조건 점수가 높은 순, 같으면 이른 시각 순")
  })
})

describe("diffChips", () => {
  const before = chipsOf({ weekdays: { days: [1, 2, 3, 4, 5], strength: "must" }, timeOfDay: { start: "12:00", end: "18:00", strength: "strong" }, order: "earliest" })
  it("separates added, replaced, and removed conditions", () => {
    const after = chipsOf({ weekdays: { days: [1, 2, 3, 4, 5], strength: "must" }, timeOfDay: { start: "18:00", end: "22:00", strength: "strong" }, places: { placeIds: [ONLINE.id], strength: "strong" } })
    expect(diffChips(before, after)).toEqual({ added: ["온라인 · 강"], replaced: ["18:00–22:00 · 강"], removed: ["빠른 순"] })
  })
  it("reports nothing when nothing changed", () => {
    expect(diffChips(before, before)).toEqual({ added: [], replaced: [], removed: [] })
  })
  it("treats a changed strength as a replacement", () => {
    const after = chipsOf({ weekdays: { days: [1, 2, 3, 4, 5], strength: "weak" }, timeOfDay: { start: "12:00", end: "18:00", strength: "strong" }, order: "earliest" })
    expect(diffChips(before, after).replaced).toEqual(["평일 · 약"])
  })
})

describe("selectionBasis", () => {
  const filter: Filter = {
    weekdays: { days: [1, 2, 3, 4, 5], strength: "must" },
    timeOfDay: { start: "12:00", end: "18:00", strength: "strong" },
    places: { placeIds: [ONLINE.id], strength: "weak" },
    order: "earliest",
  }
  const label = (r: { slot: Slot }) => slotLabel(r.slot, PLACES, [T30, T60])
  const slots = [slot("2026-10-05", "12:00"), slot("2026-10-05", "12:30"), slot("2026-10-05", "14:00", NEAR.id, 15), slot("2026-10-06", "10:00", ONLINE.id, 120)]
  const ranked = rankSlots(slots, filter)
  const top = pickDiverse(ranked)
  const basis = selectionBasis({ top, ranked, filter, chips: chipsOf(filter), label })

  it("lists the conditions by how they were used", () => {
    expect(basis.must).toEqual(["평일"])
    expect(basis.preferred).toEqual(["12:00–18:00(강하게 선호)", "온라인(약하게 선호)"])
    expect(basis.order).toBe("날짜가 가까운 순, 같은 날은 이른 시각 순")
  })
  it("reports, per option, which preferences it meets and which it misses", () => {
    const byTime = Object.fromEntries(basis.options.map((o) => [o.label, o]))
    const first = byTime["10월 5일(월) 12:00 · 온라인 · 30분 커피챗"]
    expect(first.matched).toEqual(["12:00–18:00", "온라인"])
    expect(first.missed).toEqual([])
    const near = byTime["10월 5일(월) 14:00 · 회사 근처 카페 · 30분 커피챗"]
    expect(near.matched).toEqual(["12:00–18:00"])
    expect(near.missed).toEqual(["온라인"])
    expect(near.slackMin).toBe(15)
  })
  it("flags diversification only when near-duplicates were actually skipped", () => {
    expect(basis.diversified).toBe(true) // 12:30 was skipped in favour of 14:00 and the next day
    const plain = selectionBasis({ top: ranked.slice(0, 1), ranked: ranked.slice(0, 1), filter, chips: chipsOf(filter), label })
    expect(plain.diversified).toBe(false)
  })
})

describe("basisSentence", () => {
  const basis = { must: [], preferred: [], order: describeOrder({}), diversified: false, minGapMin: 60, options: [] }
  it("still reads naturally with no conditions at all", () => {
    expect(basisSentence(basis, { added: [], replaced: [], removed: [] }, 3)).toBe("조건 점수가 높은 순, 같으면 이른 시각 순 기준으로 후보 3개를 골랐어요.")
  })
})

describe("participant recommendation facts", () => {
  const empty = { weekdays: null, startTime: null, meetingMode: null, slack: null }
  it("reports provenance and real host tie breaks without private calendar details", async () => {
    const { resolvePreferences } = await import("@/core/preferences")
    const { rankForParticipants } = await import("@/core/filter")
    const filter = resolvePreferences({ ...empty, meetingMode: { value: "online", strength: "weak" } }, {})
    const data = [slot("2026-10-05", "10:00"), slot("2026-10-06", "10:00")]
    const ranked = rankForParticipants(data, filter, { ...empty, weekdays: { value: [2], strength: "strong" } }, PLACES)
    const basis = selectionBasis({ top: ranked, ranked, filter, chips: filterChips(filter, PLACES, [T30]), places: PLACES, label: r => String(r.slot.startMs) })
    expect(basis.sources?.location).toBe("inherit")
    expect(basis.hostTieBreakUsed).toBe(true)
    expect(basis.options[0]).toMatchObject({ matched: ["온라인"], missed: [], clientScoreUnits: 21_600_000, hostScoreUnits: 72_000_000, hostTieBreakUsed: true })
    const explicit = rankForParticipants(data, { ...filter, order: "earliest" }, { ...empty, weekdays: { value: [2], strength: "strong" } }, PLACES)
    expect(selectionBasis({ top: explicit, ranked: explicit, filter: { ...filter, order: "earliest" }, chips: [], label: r => String(r.slot.startMs) }).hostTieBreakUsed).toBe(false)
  })
  it("distinguishes unmet soft preferences from must producing no results", async () => {
    const { rankForParticipants } = await import("@/core/filter")
    const { summarize } = await import("@/core/summary")
    const data = [slot("2026-10-05", "10:00", NEAR.id)]
    const soft = { meetingMode: { value: "online" as const, strength: "strong" as const } }
    const hard = { meetingMode: { value: "online" as const, strength: "must" as const } }
    expect(summarize(rankForParticipants(data, soft, empty, PLACES), soft, data, PLACES).outcome).toBe("preference_mismatch")
    const result = summarize(rankForParticipants(data, hard, empty, PLACES), hard, data, PLACES)
    expect(result.outcome).toBe("must_no_results")
    expect(result.relax.places).toBe(1)
  })
})
