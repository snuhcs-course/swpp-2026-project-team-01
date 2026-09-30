import { kstDateString, kstDayStart, kstParts, parseHm } from "./time"
import type { Filter, FilterChange, FilterKey, RankedSlot, Slot, Strength } from "./types"

export const WEIGHT = { strong: 10, weak: 3 } as const
export const SLACK_FULL_MIN = 120

/** Same-kind conditions are replaced, different kinds are added; `remove` drops a kind. */
export function mergeFilter(filter: Filter, change: FilterChange): Filter {
  const next: Filter = { ...filter, ...(change.set ?? {}) }
  for (const key of change.remove ?? []) delete next[key]
  return next
}

/** Whether a slot satisfies one dimension of the filter. Dimensions that are absent always match. */
export function matchesDimension(slot: Slot, filter: Filter, key: FilterKey): boolean {
  const p = kstParts(slot.startMs)
  switch (key) {
    case "dateRange": {
      const f = filter.dateRange
      if (!f) return true
      const d = kstDateString(slot.startMs)
      return d >= f.from && d <= f.to
    }
    case "weekdays":
      return !filter.weekdays || filter.weekdays.days.includes(p.weekday)
    case "timeOfDay": {
      const f = filter.timeOfDay
      if (!f) return true
      const start = parseHm(f.start)
      const end = parseHm(f.end)
      if (start === null || end === null) return true
      return p.minuteOfDay >= start && p.minuteOfDay < end
    }
    case "places":
      return !filter.places || filter.places.placeIds.includes(slot.placeId)
    case "meetingTypes":
      return !filter.meetingTypes || filter.meetingTypes.ids.includes(slot.meetingTypeId)
    default:
      return true
  }
}

const STRENGTH_DIMENSIONS = ["dateRange", "weekdays", "timeOfDay", "places", "meetingTypes"] as const

function strengthOf(filter: Filter, key: (typeof STRENGTH_DIMENSIONS)[number]): Strength | null {
  return filter[key]?.strength ?? null
}

/** Removes slots that break any "must" condition. */
export function applyFilter(slots: Slot[], filter: Filter): Slot[] {
  const musts = STRENGTH_DIMENSIONS.filter((k) => strengthOf(filter, k) === "must")
  if (musts.length === 0) return slots
  return slots.filter((s) => musts.every((k) => matchesDimension(s, filter, k)))
}

export function scoreSlot(slot: Slot, filter: Filter): number {
  let score = 0
  for (const key of STRENGTH_DIMENSIONS) {
    const strength = strengthOf(filter, key)
    if (strength === "strong" || strength === "weak") {
      if (matchesDimension(slot, filter, key)) score += WEIGHT[strength]
    }
  }
  if (filter.slack) {
    score += WEIGHT[filter.slack.strength] * (Math.min(slot.slackMin, SLACK_FULL_MIN) / SLACK_FULL_MIN)
  }
  return score
}

/**
 * Filter, score, and sort. Fully deterministic: score, then date (nearest first), then time of day
 * (earlier first, or later first when `order` is "latest"), then place, then type.
 * "latest" never means the farthest date: nobody asks for the last day of a two-month window.
 */
export function rankSlots(slots: Slot[], filter: Filter): RankedSlot[] {
  const timeDir = filter.order === "latest" ? -1 : 1
  return applyFilter(slots, filter)
    .map((slot) => ({ slot, score: scoreSlot(slot, filter) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        kstDayStart(a.slot.startMs) - kstDayStart(b.slot.startMs) ||
        timeDir * (a.slot.startMs - b.slot.startMs) ||
        a.slot.placeId.localeCompare(b.slot.placeId) ||
        a.slot.meetingTypeId.localeCompare(b.slot.meetingTypeId),
    )
}
