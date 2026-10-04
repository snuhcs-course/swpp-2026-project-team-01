import { kstDateString, kstDayStart, kstParts, parseHm } from "./time"
import { resolvePreferences } from "./preferences"
import type { ProfilePreferences } from "./profile"
import type { EffectiveConditions, Filter, FilterChange, FilterKey, Place, RankedSlot, Slot, Strength } from "./types"

export const WEIGHT = { strong: 10, weak: 3 } as const
export const SLACK_FULL_MIN = 120
export const SCORE_SCALE = 7_200_000

/** Same-kind conditions are replaced, different kinds are added; remove drops a kind. */
export function mergeFilter(filter: Filter, change: FilterChange): Filter {
  const next: Filter = { ...filter, ...(change.set ?? {}) }
  for (const key of change.remove ?? []) delete next[key]
  return next
}

/** places represents the single location dimension, including inherited meetingMode. */
export function matchesDimension(slot: Slot, filter: EffectiveConditions, key: FilterKey, places: Place[] = []): boolean {
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
    case "places": {
      if (filter.places) return filter.places.placeIds.includes(slot.placeId)
      if (!filter.meetingMode) return true
      const place = places.find(p => p.id === slot.placeId)
      return !!place && (filter.meetingMode.value === "online" ? place.kind === "online" : place.kind !== "online")
    }
    case "meetingTypes":
      return !filter.meetingTypes || filter.meetingTypes.ids.includes(slot.meetingTypeId)
    default:
      return true
  }
}

export const STRENGTH_DIMENSIONS = ["dateRange", "weekdays", "timeOfDay", "places", "meetingTypes"] as const
export function strengthOf(filter: EffectiveConditions, key: (typeof STRENGTH_DIMENSIONS)[number]): Strength | null {
  return (key === "places" ? filter.places ?? filter.meetingMode : filter[key])?.strength ?? null
}

/** Removes only must mismatches, including explicit meeting mode restrictions. */
export function applyFilter(slots: Slot[], filter: EffectiveConditions, places: Place[] = []): Slot[] {
  const musts = STRENGTH_DIMENSIONS.filter(k => strengthOf(filter, k) === "must")
  if (!musts.length) return slots
  return slots.filter(s => musts.every(k => matchesDimension(s, filter, k, places)))
}

export function scoreSlotUnits(slot: Slot, filter: EffectiveConditions, places: Place[] = []): number {
  let units = 0
  for (const key of STRENGTH_DIMENSIONS) {
    const strength = strengthOf(filter, key)
    if ((strength === "strong" || strength === "weak") && matchesDimension(slot, filter, key, places)) {
      units += WEIGHT[strength] * SCORE_SCALE
    }
  }
  if (filter.slack) {
    // Only old callers need conversion. Exact normalized milliseconds are never rounded to minutes.
    const ms = slot.slackMs ?? Math.round(slot.slackMin * 60_000)
    units += WEIGHT[filter.slack.strength] * Math.max(0, Math.min(ms, SCORE_SCALE))
  }
  return units
}

/** Compatibility display score; ranking never compares floating point display values. */
export function scoreSlot(slot: Slot, filter: Filter): number {
  return scoreSlotUnits(slot, filter) / SCORE_SCALE
}

export function clientUnits(r: RankedSlot): number {
  return r.clientScoreUnits ?? Math.round(r.score * SCORE_SCALE)
}
export function hostUnits(r: RankedSlot): number { return r.hostScoreUnits ?? 0 }

/** Only these comparison keys can settle a recommendation boundary. IDs never do. */
export function compareMeaningful(a: RankedSlot, b: RankedSlot, filter: Pick<Filter, "order">): number {
  const client = clientUnits(b) - clientUnits(a)
  if (client) return client
  if (filter.order) {
    const time = kstDayStart(a.slot.startMs) - kstDayStart(b.slot.startMs)
      || (filter.order === "latest" ? -1 : 1) * (a.slot.startMs - b.slot.startMs)
    if (time) return time
  }
  return hostUnits(b) - hostUnits(a)
}

function deterministicCompare(a: RankedSlot, b: RankedSlot, filter: Pick<Filter, "order">): number {
  return compareMeaningful(a, b, filter)
    || a.slot.startMs - b.slot.startMs
    || a.slot.placeId.localeCompare(b.slot.placeId)
    || a.slot.meetingTypeId.localeCompare(b.slot.meetingTypeId)
}

/** Client always wins; host only resolves equal preceding client/time comparison keys. */
export function rankForParticipants(slots: Slot[], client: EffectiveConditions, host: ProfilePreferences, places: Place[]): RankedSlot[] {
  const hostConditions = resolvePreferences(host, {})
  return applyFilter(slots, client, places).map(slot => {
    const clientScoreUnits = scoreSlotUnits(slot, client, places)
    return { slot, score: clientScoreUnits / SCORE_SCALE, clientScoreUnits, hostScoreUnits: scoreSlotUnits(slot, hostConditions, places) }
  }).sort((a, b) => deterministicCompare(a, b, client))
}

/** Legacy one-person entry point; exact scores with the existing date/time/ID fallback. */
export function rankSlots(slots: Slot[], filter: Filter): RankedSlot[] {
  return applyFilter(slots, filter).map(slot => {
    const clientScoreUnits = scoreSlotUnits(slot, filter)
    return { slot, score: clientScoreUnits / SCORE_SCALE }
  }).sort((a, b) => deterministicCompare(a, b, filter))
}
