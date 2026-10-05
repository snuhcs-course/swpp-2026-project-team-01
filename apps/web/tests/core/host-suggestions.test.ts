import { describe, expect, it } from "vitest"
import type { AnalysisEvent } from "@/core/analysis"
import type { CalendarSourceInput } from "@/core/calendar"
import { suggestHostSetup } from "@/core/host-suggestions"

const HOUR = 3_600_000
let n = 0
/** A past event as the normaliser leaves it: Google location text stays only on the source copy. */
const ev = (minutes: number, extra: Partial<AnalysisEvent> & { where?: string } = {}): AnalysisEvent => {
  const { where, ...rest } = extra, id = `e${++n}`, startMs = Date.parse("2026-09-15T10:00:00+09:00") + n * 24 * HOUR
  const source: CalendarSourceInput = { sourceKey: id, ...(where ? { placeRef: where } : {}) }
  return { id, title: "meeting", startMs, endMs: startMs + minutes * 60_000, kind: "none", placeRef: null, sourceKeys: [id], sources: [source], responseStatus: "accepted", locationNeedsConfirmation: true, classification: "business", ...rest }
}
const none = { places: [], meetingTypes: [] }

describe("host setup suggestions from past business events", () => {
  it("offers repeated places and meeting lengths, most frequent first", () => {
    const s = suggestHostSetup([
      ev(30, { where: "강남역 스타벅스" }), ev(30, { where: "강남역 스타벅스" }), ev(60, { where: "강남역 스타벅스" }),
      ev(60, { where: "회사 3층 회의실" }), ev(60, { where: "회사 3층 회의실" }),
      ev(30, { where: "한 번만 간 곳" }),
    ], none)
    expect(s.places).toEqual([
      { kind: "special", name: "강남역 스타벅스", count: 3 },
      { kind: "office_near", name: "회사 3층 회의실", count: 2 },
    ])
    expect(s.meetingTypes).toEqual([
      { name: "30분 미팅", durationMin: 30, count: 3 },
      { name: "60분 미팅", durationMin: 60, count: 3 },
    ])
    expect(s.basedOn).toBe(6)
  })

  it("never offers places or lengths from personal or unclassified events", () => {
    const s = suggestHostSetup([
      ev(50, { where: "OO정형외과", classification: "personal" }), ev(50, { where: "OO정형외과", classification: "personal" }),
      ev(50, { where: "집", classification: "unknown" }), ev(50, { where: "집" , classification: undefined }),
    ], none)
    expect(s).toEqual({ basedOn: 0, places: [], meetingTypes: [] })
  })

  it("counts video calls as online, including meeting links written as the location", () => {
    const s = suggestHostSetup([ev(30, { kind: "online" }), ev(30, { where: "https://zoom.us/j/123" })], none)
    expect(s.places).toEqual([{ kind: "online", name: "온라인", count: 2 }])
  })

  it("skips what the host already has and long blocks that are not meetings", () => {
    const s = suggestHostSetup([
      ev(30, { where: "강남역 스타벅스" }), ev(30, { where: "강남역 스타벅스" }), ev(30, { kind: "online" }), ev(30, { kind: "online" }),
      ev(240, { where: "워크숍장" }), ev(240, { where: "워크숍장" }),
    ], { places: [{ id: "p1", kind: "special", name: "강남역 스타벅스" }, { id: "p2", kind: "online", name: "화상" }], meetingTypes: [{ id: "t1", name: "커피챗", durationMin: 30 }] })
    expect(s).toEqual({ basedOn: 4, places: [], meetingTypes: [] })
  })

  it("respects a location the user confirmed, even as unknown", () => {
    const confirmed = (): Partial<AnalysisEvent> => ({ where: "강남역", sources: [{ sourceKey: "x", placeRef: "강남역", confirmedLocation: { kind: "none", placeRef: null } }] } as Partial<AnalysisEvent>)
    expect(suggestHostSetup([ev(30, confirmed()), ev(30, confirmed())], none).places).toEqual([])
    const office = suggestHostSetup([ev(30, { kind: "office", placeRef: "본관" }), ev(30, { kind: "office", placeRef: "본관" })], none)
    expect(office.places).toEqual([{ kind: "office_near", name: "본관", count: 2 }])
  })

  it("rounds lengths to 15 minutes and lets a user label override the AI", () => {
    const s = suggestHostSetup([ev(44), ev(46), ev(44, { classification: "business", userClassification: "personal" })], none)
    expect(s.meetingTypes).toEqual([{ name: "45분 미팅", durationMin: 45, count: 2 }])
  })
})
