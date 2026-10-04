import { describe, expect, it } from "vitest"
import { normalizeCalendarEvents, type CalendarSourceInput } from "@/core/calendar"

const timed = (overrides: Partial<CalendarSourceInput> = {}): CalendarSourceInput => ({
  sourceKey: "connection/calendar/event", startMs: Date.parse("2026-10-05T10:00:00Z"),
  endMs: Date.parse("2026-10-05T11:00:00Z"), kind: "office", ...overrides,
})

describe("calendar normalization", () => {
  it.each([
    ["2026-03-08", "2026-03-09", "2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z"],
    ["2026-11-01", "2026-11-02", "2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z"],
  ])("all_day_blocks_without_travel_anchor across DST on %s", (startDate, endDate, start, end) => {
    const result = normalizeCalendarEvents([{ sourceKey: "all-day", allDay: { startDate, endDate, timeZone: "America/New_York" } }])
    expect(result.busyIntervals).toEqual([{ startMs: Date.parse(start), endMs: Date.parse(end) }])
    expect(result.travelAnchors).toEqual([])
    expect(result.analysisEvents).toEqual([])
  })
  it("uses the original timezone, including non-whole-hour offsets", () => {
    const result = normalizeCalendarEvents([{ sourceKey: "all-day", allDay: { startDate: "2026-10-05", endDate: "2026-10-06", timeZone: "Asia/Kathmandu" } }])
    expect(result.busyIntervals).toEqual([{ startMs: Date.parse("2026-10-04T18:15:00Z"), endMs: Date.parse("2026-10-05T18:15:00Z") }])
  })
  it.each([
    { status: "cancelled" }, { responseStatus: "declined" }, { transparency: "transparent" }, { eventType: "workingLocation" },
  ] as Partial<CalendarSourceInput>[])("does not block excluded events: %j", (overrides) => {
    expect(normalizeCalendarEvents([timed(overrides)])).toEqual({ busyIntervals: [], travelAnchors: [], analysisEvents: [] })
  })
  it.each(["tentative", "needsAction"] as const)("blocks %s invitations", responseStatus => {
    expect(normalizeCalendarEvents([timed({ responseStatus })]).busyIntervals).toHaveLength(1)
  })
  it("does not infer online when physical location and conference link coexist", () => {
    const result = normalizeCalendarEvents([timed({ kind: "online", placeRef: "room", hasOnlineLink: true })])
    expect(result.travelAnchors[0]).toMatchObject({ kind: "none", placeRef: null })
    expect(result.analysisEvents[0]).toMatchObject({ kind: "none", locationNeedsConfirmation: true })
    expect(normalizeCalendarEvents([timed({ kind: "online" })]).travelAnchors).toEqual([])
  })
  it.each(["freeBusy", "focusTime", "outOfOffice"] as const)("blocks %s without inferring meeting frequency", eventType => {
    const result = normalizeCalendarEvents([timed({ eventType, kind: "none" })])
    expect(result.busyIntervals).toHaveLength(1)
    expect(result.travelAnchors[0].kind).toBe("none")
    expect(result.analysisEvents).toEqual([])
  })
  it("deduplicates copies by occurrence evidence and preserves source identities", () => {
    const a = timed({ iCalUID: "series", recurringEventId: "series-a", originalStartTime: "2026-10-01T10:00:00Z" })
    const b = { ...a, sourceKey: "other-calendar/event", recurringEventId: "series-b", originalStartTime: "2026-10-01T19:00:00+09:00" }
    const result = normalizeCalendarEvents([a, b])
    expect(result.analysisEvents).toHaveLength(1)
    expect(result.analysisEvents[0].sourceKeys).toEqual([a.sourceKey, b.sourceKey])
    expect(normalizeCalendarEvents([b, a])).toEqual(result)
    expect(normalizeCalendarEvents([a, { ...b, originalStartTime: "2026-10-02T10:00:00Z" }]).analysisEvents).toHaveLength(2)
    expect(normalizeCalendarEvents([timed(), timed({ sourceKey: "unrelated" })]).analysisEvents).toHaveLength(2)
  })
  it("uses the union of live conflicting copies, unknown travel and no analysis", () => {
    const a = timed({ iCalUID: "one", kind: "online" })
    const b = timed({ sourceKey: "b", iCalUID: "one", startMs: a.startMs! + 30 * 60_000, endMs: a.endMs! + 30 * 60_000 })
    const result = normalizeCalendarEvents([a, b])
    expect(result.busyIntervals).toEqual([{ startMs: a.startMs, endMs: b.endMs }])
    expect(result.travelAnchors).toHaveLength(1)
    expect(result.travelAnchors[0]).toMatchObject({ kind: "none", placeRef: null, startMs: a.startMs, endMs: b.endMs })
    expect(result.analysisEvents).toEqual([])
    const cancelled = normalizeCalendarEvents([a, { ...b, status: "cancelled" }])
    expect(cancelled.busyIntervals).toEqual([{ startMs: a.startMs, endMs: a.endMs }])
    expect(cancelled.travelAnchors[0].kind).toBe("none")
    expect(cancelled.analysisEvents).toEqual([])
  })
  it("does not fill a free gap between disjoint conflicting copies", () => {
    const a = timed({ iCalUID: "one" })
    const b = timed({ iCalUID: "one", sourceKey: "b", startMs: a.startMs! + 3_600_000 * 3, endMs: a.endMs! + 3_600_000 * 3 })
    expect(normalizeCalendarEvents([a, b]).busyIntervals).toHaveLength(2)
  })
  it("rejects invalid ranges, dates and ambiguous recurrence timestamps", () => {
    expect(() => normalizeCalendarEvents([timed({ endMs: 0 })])).toThrow(RangeError)
    expect(() => normalizeCalendarEvents([{ sourceKey: "x", allDay: { startDate: "2026-02-30", endDate: "2026-03-01", timeZone: "UTC" } }])).toThrow(RangeError)
    expect(() => normalizeCalendarEvents([timed({ originalStartTime: "2026-10-05T10:00:00" })])).toThrow(RangeError)
  })
})
