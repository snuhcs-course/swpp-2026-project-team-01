import { describe, expect, it } from "vitest"
import { analyzeHistory, resolveClassification, type AnalysisEvent } from "@/core/analysis"
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
