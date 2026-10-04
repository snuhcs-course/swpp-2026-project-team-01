import type { AvailabilityRule } from "./types"
import { kstDayStart, kstParts, MIN_MS } from "./time"

export const DEFAULT_START_MIN = 8 * 60
export const DEFAULT_END_MIN = 22 * 60

export function defaultRules(): AvailabilityRule[] {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    enabled: true,
    startMin: DEFAULT_START_MIN,
    endMin: DEFAULT_END_MIN,
  }))
}

/** Whole half-open interval must fit the union of this day's enabled windows. */
export function fitsRules(rules: AvailabilityRule[], startMs: number, endMs: number): boolean {
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || endMs <= startMs) return false
  const dayStart = kstDayStart(startMs)
  if (endMs > dayStart + 1440 * MIN_MS) return false
  const weekday = kstParts(startMs).weekday
  const start = (startMs - dayStart) / MIN_MS
  const end = (endMs - dayStart) / MIN_MS
  const windows = rules.filter(r => r.enabled && r.weekday === weekday).sort((a, b) => a.startMin - b.startMin)
  let covered = start
  for (const window of windows) {
    if (window.endMin <= covered) continue
    if (window.startMin > covered) return false
    covered = window.endMin
    if (covered >= end) return true
  }
  return false
}
