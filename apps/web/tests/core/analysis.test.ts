import { describe, expect, it } from "vitest"
import { analyzeHistory, resolveClassification, type AnalysisEvent } from "@/core/analysis"
import { answerFromHistory, describeHistory, historyQuestion } from "@/core/briefing"
import { DAY_MS } from "@/core/time"
const toMs = Date.parse("2026-10-05T00:00:00+09:00")
const range = { fromMs: toMs - 56 * DAY_MS, toMs }
const event = (id: string, time: string, extra: Partial<AnalysisEvent> = {}): AnalysisEvent => ({
 id, title: "meeting", startMs: Date.parse(time), endMs: Date.parse(time) + 3600000,
 kind: "online", placeRef: null, sourceKeys: [id], sources: [], responseStatus: "accepted", locationNeedsConfirmation: false, ...extra,
})
describe("history observations", () => {
 it("late_meeting_is_evidence_not_permission", () => {
  const result = analyzeHistory([
   event("late", "2026-10-02T21:00:00+09:00", { classification: "business" }),
   event("personal", "2026-10-01T10:00:00+09:00", { classification: "personal" }),
   event("unknown", "2026-10-01T11:00:00+09:00"),
   event("future", "2026-10-05T10:00:00+09:00", { classification: "business" }),
   event("old", "2026-01-01T10:00:00+09:00", { classification: "business" }),
  ], range)
  expect(result.counts).toEqual({ business: 1, personal: 1, unknown: 1 })
  expect(result.coverage).toEqual({ eligible: 3, classified: 2, partial: true })
  expect(result.lateBusinessEventIds).toEqual(["late"])
  expect(result.businessByWeekday[5]).toBe(1)
  expect(result).not.toHaveProperty("values")
  expect(result).not.toHaveProperty("meetingWindows")
 })
 it("uses confirmed user meaning before provider facts before model labels", () => {
  expect(resolveClassification({ userClassification: "personal", providerClassification: "business", classification: "business" })).toBe("personal")
  expect(resolveClassification({ providerClassification: "business", classification: "personal" })).toBe("business")
  expect(resolveClassification({ userClassification: "unknown", providerClassification: "business" })).toBe("unknown")
 })
 it("counts explicit unknown as processed, and rejects a nonpositive range", () => {
  const summary = analyzeHistory([event("u", "2026-10-01T10:00:00+09:00", { classification: "unknown" })], range)
  expect(summary.coverage).toEqual({ eligible: 1, classified: 1, partial: false })
  expect(() => analyzeHistory([], { fromMs: 1, toMs: 1 })).toThrow()
 })
})

describe("estimates from past business events", () => {
  const at = (id: string, day: string, from: string, to: string, extra: Partial<AnalysisEvent> = {}) =>
    ({ ...event(id, `${day}T${from}:00+09:00`, { classification: "business", ...extra }), endMs: Date.parse(`${day}T${to}:00+09:00`) }) as AnalysisEvent
  const range = { fromMs: Date.parse("2026-09-01T00:00:00+09:00"), toMs: Date.parse("2026-10-05T00:00:00+09:00") }
  it("reads typical hours, meeting start times and places, and words them as an estimate", () => {
    const summary = analyzeHistory([
      at("a1", "2026-09-07", "10:00", "11:00", { kind: "office" }), at("a2", "2026-09-07", "16:00", "17:30"),
      at("b1", "2026-09-08", "09:30", "10:30"), at("b2", "2026-09-08", "15:00", "18:00"),
      at("c1", "2026-09-09", "10:00", "11:00", { kind: "none" }), at("c2", "2026-09-09", "17:00", "18:00", { kind: "office" }),
      at("d1", "2026-09-10", "11:00", "12:00", { kind: "none" }), at("d2", "2026-09-10", "14:00", "15:00"),
    ], range)
    expect(summary.estimate.workHours).toEqual({ startMin: 570, endMin: 1080, weekdays: [1, 2, 3, 4] })
    expect(summary.estimate.meetingStarts).toEqual({ fromMin: 600, toMin: 930 })
    expect(summary.estimate.places).toEqual([{ kind: "online", count: 4 }, { kind: "office", count: 2 }])
    const text = describeHistory(summary)
    expect(text).toContain("예상 근무시간은 월·화·수·목요일 09:30–18:00")
    expect(text).toContain("기존 미팅은 주로 10:00–15:30 사이에 시작했어요")
    expect(text).toContain("온라인 4건, 회사 2건이라 온라인을 선호하시는 것 같아요")
    expect(text).toContain("지난 일정에서 본 경향")
  })
  it("does not call one meeting a day a working day", () => {
    const summary = analyzeHistory(["07", "08", "09", "10", "11"].map((d, i) => at(`m${i}`, `2026-09-${d}`, "15:00", "16:00")), range)
    expect(summary.estimate.workHours).toBeNull()
    expect(summary.estimate.meetingStarts).toEqual({ fromMin: 900, toMin: 930 })
    expect(describeHistory(summary)).not.toContain("예상 근무시간")
  })
  it("does not invent hours from one or two meetings, and ignores all-day blocks", () => {
    const summary = analyzeHistory([
      at("a", "2026-09-08", "14:00", "15:00"), at("b", "2026-09-09", "15:00", "16:00"),
      at("c", "2026-09-10", "00:00", "23:59"), at("d", "2026-09-11", "09:00", "2026-09-13T09:00".slice(11)),
    ], range)
    expect(summary.estimate.workHours).toBeNull()
    expect(summary.estimate.basedOn).toBe(3)
    expect(describeHistory(summary)).toContain("추정하기는 어려워요")
  })
})

describe("questions about the analysis", () => {
  it("recognizes questions and their topic, and leaves statements alone", () => {
    expect(historyQuestion("내 근무시간은 어떻게 생각했어")).toEqual(["work"])
    expect(historyQuestion("미팅은 주로 언제 했어?")).toEqual(["meeting"])
    expect(historyQuestion("분석 결과 알려줘")).toEqual(["work", "meeting", "place"])
    expect(historyQuestion("평일 10시부터 6시까지 미팅 가능해요")).toBeNull()
  })
  it("answers only from the stored analysis", () => {
    expect(answerFromHistory(null, ["work"])).toContain("아직 가져온 일정을 분석하지 않았어요")
    const old = { counts: { business: 2, personal: 0, unknown: 0 } } as unknown as Parameters<typeof answerFromHistory>[0]
    expect(answerFromHistory(old, ["work"])).toContain("다시 분석")
  })
})
