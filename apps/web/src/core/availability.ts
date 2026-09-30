import type { AvailabilityRule } from "./types"
import { kstParts } from "./time"

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

/** True when [startMs, endMs) lies inside one day's availability window (KST). */
export function fitsRules(rules: AvailabilityRule[], startMs: number, endMs: number): boolean {
  const s = kstParts(startMs)
  const e = kstParts(endMs - 1)
  if (s.year !== e.year || s.month !== e.month || s.day !== e.day) return false
  const rule = rules.find((r) => r.weekday === s.weekday)
  if (!rule || !rule.enabled) return false
  const endMin = s.minuteOfDay + Math.round((endMs - startMs) / 60000)
  return s.minuteOfDay >= rule.startMin && endMin <= rule.endMin
}
