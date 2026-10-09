// AI-generated with Codex (gpt-6-astra), 2026-10-05
import { describe, expect, it } from "vitest"
import { resolvePreferences } from "@/core/preferences"
import type { ProfilePreferences } from "@/core/profile"
import type { PreferenceOverrides } from "@/core/types"

export const defaults: ProfilePreferences = {
  weekdays: { value: [1, 2], strength: "strong" },
  startTime: { value: { startMin: 780, endMin: 1440 }, strength: "weak" },
  meetingMode: { value: "online", strength: "strong" }, slack: { strength: "weak" },
}

describe("resolvePreferences", () => {
  it("maps profile preferences to search dimensions with provenance", () => {
    expect(resolvePreferences(defaults, {})).toMatchObject({
      weekdays: { days: [1, 2], strength: "strong" }, timeOfDay: { start: "13:00", end: "24:00", strength: "weak" },
      meetingMode: { value: "online", strength: "strong" }, slack: { strength: "weak" },
      sources: { weekdays: "inherit", timeOfDay: "inherit", location: "inherit", slack: "inherit" },
    })
  })
  it("preserves disabled dimensions across re-resolution and new defaults", () => {
    const overrides: PreferenceOverrides = { weekdays: { state: "disabled" }, location: { state: "override", value: { placeIds: ["office"], strength: "must" } } }
    for (const snapshot of [defaults, { ...defaults, weekdays: { value: [5], strength: "weak" as const } }]) {
      const result = resolvePreferences(snapshot, overrides)
      expect(result.weekdays).toBeUndefined()
      expect(result.meetingMode).toBeUndefined()
      expect(result.places).toEqual({ placeIds: ["office"], strength: "must" })
      expect(result.sources).toMatchObject({ weekdays: "disabled", location: "override" })
    }
    expect(resolvePreferences(defaults, { ...overrides, weekdays: { state: "inherit" } }).weekdays?.days).toEqual([1, 2])
  })
  it("handles state-wrapped search-only dimensions and mode replacement", () => {
    const result = resolvePreferences(defaults, {
      dateRange: { state: "override", value: { from: "2026-10-05", to: "2026-10-06", strength: "must" } },
      meetingTypes: { state: "override", value: { ids: ["t30"], strength: "must" } },
      order: { state: "override", value: "latest" }, location: { state: "override", value: { value: "offline", strength: "weak" } },
    })
    expect(result.order).toBe("latest")
    expect(result.meetingTypes?.ids).toEqual(["t30"])
    expect(result.dateRange?.from).toBe("2026-10-05")
    expect(result.meetingMode).toEqual({ value: "offline", strength: "weak" })
    expect(resolvePreferences(defaults, { order: { state: "disabled" } }).order).toBeUndefined()
  })
  it("does not share mutable arrays with snapshots or overrides", () => {
    const snapshot = structuredClone(defaults)
    const resolved = resolvePreferences(snapshot, {})
    resolved.weekdays!.days.push(6)
    expect(snapshot.weekdays!.value).toEqual([1, 2])
  })
})
