import { describe, expect, it } from "vitest"
import { normalizeWindows, validateProfile, type ProfileValues, type WeeklyWindow } from "../../src/core/profile"

const emptyProfile = (): ProfileValues => ({
  work: { mode: "none", windows: [] },
  meetingWindows: [],
  preferences: { weekdays: null, startTime: null, meetingMode: null, slack: null },
})

const availableProfile = (): ProfileValues => ({
  ...emptyProfile(),
  meetingWindows: [
    { weekday: 1, startMin: 600, endMin: 720 },
    { weekday: 2, startMin: 840, endMin: 1080 },
  ],
})

const invalidWindows: unknown[] = [
  { weekday: -1, startMin: 600, endMin: 720 },
  { weekday: 7, startMin: 600, endMin: 720 },
  { weekday: 1.5, startMin: 600, endMin: 720 },
  { weekday: "1", startMin: 600, endMin: 720 },
  { weekday: 1, startMin: -1, endMin: 720 },
  { weekday: 1, startMin: 600.5, endMin: 720 },
  { weekday: 1, startMin: 600, endMin: 720.5 },
  { weekday: 1, startMin: 600, endMin: 1441 },
  { weekday: 1, startMin: 600, endMin: 600 },
  { weekday: 1, startMin: 1380, endMin: 60 },
  { weekday: 1, startMin: 1440, endMin: 1440 },
  { weekday: 1, startMin: NaN, endMin: 720 },
  { weekday: 1, startMin: 600, endMin: Infinity },
  { weekday: 1, startMin: "600", endMin: 720 },
  { weekday: 1, startMin: 600 },
  null,
]

describe("normalizeWindows", () => {
  it("merges_adjacent_windows_but_preserves_lunch", () => {
    expect(normalizeWindows([
      { weekday: 2, startMin: 600, endMin: 660 },
      { weekday: 2, startMin: 660, endMin: 720 },
      { weekday: 2, startMin: 840, endMin: 1080 },
    ])).toEqual([
      { weekday: 2, startMin: 600, endMin: 720 },
      { weekday: 2, startMin: 840, endMin: 1080 },
    ])
  })

  it("sorts and unions overlapping, nested and duplicate intervals within each weekday", () => {
    const windows = [
      { weekday: 2, startMin: 660, endMin: 800 },
      { weekday: 1, startMin: 600, endMin: 720 },
      { weekday: 2, startMin: 600, endMin: 720 },
      { weekday: 2, startMin: 680, endMin: 700 },
      { weekday: 2, startMin: 600, endMin: 720 },
    ]
    const before = structuredClone(windows)
    const normalized = normalizeWindows(windows)
    expect(normalized).toEqual([
      { weekday: 1, startMin: 600, endMin: 720 },
      { weekday: 2, startMin: 600, endMin: 800 },
    ])
    expect(windows).toEqual(before)
    normalized[0].endMin = 900
    expect(windows).toEqual(before)
  })

  it("accepts empty windows and full days without merging across midnight", () => {
    expect(normalizeWindows([])).toEqual([])
    const windows = [
      { weekday: 0, startMin: 0, endMin: 1440 },
      { weekday: 1, startMin: 0, endMin: 1440 },
      { weekday: 6, startMin: 1439, endMin: 1440 },
    ]
    expect(normalizeWindows(windows)).toEqual(windows)
  })

  it.each(invalidWindows)("rejects malformed intervals: %j", (window) => {
    expect(() => normalizeWindows([window] as WeeklyWindow[])).toThrow(RangeError)
  })
})

describe("validateProfile", () => {
  it("allows no work, no meetings and no preferences", () => {
    expect(validateProfile(emptyProfile())).toEqual({ valid: true, fieldErrors: {} })
  })

  it("keeps work and meeting windows independent and leaves inputs unchanged", () => {
    const values = availableProfile()
    values.work = { mode: "fixed", windows: [{ weekday: 5, startMin: 540, endMin: 1020 }] }
    values.meetingWindows.push({ weekday: 1, startMin: 660, endMin: 780 })
    const before = structuredClone(values)
    expect(validateProfile(values)).toEqual({ valid: true, fieldErrors: {} })
    expect(values).toEqual(before)
  })

  it.each(invalidWindows)("reports invalid work and meeting windows: %j", (window) => {
    const values = emptyProfile()
    values.work = { mode: "fixed", windows: [window] as WeeklyWindow[] }
    values.meetingWindows = [window] as WeeklyWindow[]
    const result = validateProfile(values)
    expect(result.valid).toBe(false)
    expect(Object.keys(result.fieldErrors).some((key) => key.startsWith("work.windows"))).toBe(true)
    expect(Object.keys(result.fieldErrors).some((key) => key.startsWith("meetingWindows"))).toBe(true)
  })

  it.each([
    { mode: "fixed", windows: [] },
    { mode: "none", windows: [{ weekday: 1, startMin: 600, endMin: 720 }] },
    { mode: "flexible", windows: [] },
  ])("rejects inconsistent work modes: %j", (work) => {
    expect(validateProfile({ ...emptyProfile(), work } as ProfileValues).valid).toBe(false)
  })

  it("accepts supported strong/weak preferences with combined overlap", () => {
    const values = availableProfile()
    values.preferences = {
      weekdays: { value: [2], strength: "strong" },
      startTime: { value: { startMin: 900, endMin: 1440 }, strength: "weak" },
      meetingMode: { value: "offline", strength: "strong" },
      slack: { strength: "weak" },
    }
    expect(validateProfile(values)).toEqual({ valid: true, fieldErrors: {} })
  })

  it("rejects a combined conflict even when each preference separately intersects", () => {
    const values = availableProfile()
    values.preferences.weekdays = { value: [1], strength: "weak" }
    values.preferences.startTime = { value: { startMin: 840, endMin: 900 }, strength: "strong" }
    const before = structuredClone(values)
    const result = validateProfile(values)
    expect(result.valid).toBe(false)
    expect(result.fieldErrors["preferences.weekdays"]).toBeDefined()
    expect(result.fieldErrors["preferences.startTime"]).toBeDefined()
    expect(values).toEqual(before)
  })

  it.each([
    { weekdays: { value: [6], strength: "weak" } },
    { startTime: { value: { startMin: 720, endMin: 840 }, strength: "strong" } },
    { startTime: { value: { startMin: 1080, endMin: 1200 }, strength: "weak" } },
  ])("rejects disjoint preferences and touching half-open endpoints: %j", (preferences) => {
    const values = availableProfile()
    Object.assign(values.preferences, preferences)
    expect(validateProfile(values).valid).toBe(false)
  })

  it.each(["weekdays", "startTime"] as const)("requires clearing %s when meeting windows are empty", (key) => {
    const values = emptyProfile()
    if (key === "weekdays") values.preferences.weekdays = { value: [1], strength: "weak" }
    else values.preferences.startTime = { value: { startMin: 600, endMin: 720 }, strength: "weak" }
    const before = structuredClone(values)
    const result = validateProfile(values)
    expect(result.valid).toBe(false)
    expect(result.fieldErrors[`preferences.${key}`]).toBeDefined()
    expect(values).toEqual(before)
  })

  it("allows mode and slack without meetings or a counterpart's places", () => {
    const values = emptyProfile()
    values.preferences.meetingMode = { value: "online", strength: "weak" }
    values.preferences.slack = { strength: "strong" }
    expect(validateProfile(values)).toEqual({ valid: true, fieldErrors: {} })
  })

  it.each([
    ["weekdays", { value: [], strength: "weak" }],
    ["weekdays", { value: [7], strength: "weak" }],
    ["weekdays", { value: [1.5], strength: "weak" }],
    ["weekdays", { value: [1, 1], strength: "weak" }],
    ["weekdays", { value: ["1"], strength: "weak" }],
    ["weekdays", { value: [1], strength: "must" }],
    ["startTime", { value: { startMin: 1380, endMin: 60 }, strength: "weak" }],
    ["startTime", { value: { startMin: 600, endMin: 600 }, strength: "weak" }],
    ["startTime", { value: { startMin: -1, endMin: 720 }, strength: "weak" }],
    ["startTime", { value: { startMin: 600, endMin: 1441 }, strength: "weak" }],
    ["startTime", { value: { startMin: 600.5, endMin: 720 }, strength: "weak" }],
    ["startTime", { value: { startMin: 600, endMin: NaN }, strength: "weak" }],
    ["meetingMode", { value: "hybrid", strength: "weak" }],
    ["slack", { strength: "must" }],
    ["slack", { strength: "weak", minMinutes: 30 }],
    ["dateRange", { from: "2026-10-04", to: "2026-10-05", strength: "weak" }],
    ["places", { placeIds: ["host-office"], strength: "weak" }],
    ["meetingTypes", { ids: ["type-1"], strength: "weak" }],
    ["order", "latest"],
  ])("rejects unsupported or malformed preference %s: %j", (key, preference) => {
    const values = availableProfile()
    Object.assign(values.preferences, { [key as string]: preference })
    const result = validateProfile(values)
    expect(result.valid).toBe(false)
    expect(Object.keys(result.fieldErrors).some((path) => path.startsWith(`preferences.${key}`))).toBe(true)
  })

  it.each([null, {}, { ...emptyProfile(), preferences: null }, { ...emptyProfile(), meetingWindows: null }])(
    "returns field errors instead of throwing for a malformed profile: %j", (values) => {
      const result = validateProfile(values as ProfileValues)
      expect(result.valid).toBe(false)
      expect(Object.keys(result.fieldErrors).length).toBeGreaterThan(0)
    },
  )

  it("reports unsupported prototype-named fields instead of throwing", () => {
    const values = { ...emptyProfile(), constructor: "unsupported" }
    expect(validateProfile(values).fieldErrors.constructor).toEqual([expect.any(String)])
  })
})
