import { applyFilter, clientUnits, hostUnits, compareMeaningful, matchesDimension, strengthOf } from "./filter"
import { kstDateString, kstParts, kstWeekStart } from "./time"
import type { EffectiveConditions, Place, Filter, RankedSlot, Slot, Summary } from "./types"

const RELAXABLE = ["dateRange", "weekdays", "timeOfDay", "places", "meetingTypes"] as const
const EPS = 1e-9

export function summarize(ranked: RankedSlot[], filter: EffectiveConditions, allSlots: Slot[], places: Place[] = []): Summary {
  const byWeek = new Map<string, number>()
  const byWeekday = [0, 0, 0, 0, 0, 0, 0]
  const byTimeOfDay = { morning: 0, afternoon: 0, evening: 0 }
  const byPlace: Record<string, number> = {}
  const byMeetingType: Record<string, number> = {}
  let first: string | null = null
  let last: string | null = null

  for (const { slot } of ranked) {
    const p = kstParts(slot.startMs)
    const date = kstDateString(slot.startMs)
    if (first === null || date < first) first = date
    if (last === null || date > last) last = date
    const week = kstWeekStart(slot.startMs)
    byWeek.set(week, (byWeek.get(week) ?? 0) + 1)
    byWeekday[p.weekday] += 1
    if (p.minuteOfDay < 12 * 60) byTimeOfDay.morning += 1
    else if (p.minuteOfDay < 18 * 60) byTimeOfDay.afternoon += 1
    else byTimeOfDay.evening += 1
    byPlace[slot.placeId] = (byPlace[slot.placeId] ?? 0) + 1
    byMeetingType[slot.meetingTypeId] = (byMeetingType[slot.meetingTypeId] ?? 0) + 1
  }

  const topScore = ranked.length > 0 ? ranked[0].score : null
  const tieCountAtTop = topScore === null ? 0 : ranked.filter((r) => compareMeaningful(r, ranked[0], filter) === 0).length

  const relax: Summary["relax"] = {}
  if (ranked.length === 0) {
    for (const key of RELAXABLE) {
      const f = key === "places" ? filter.places ?? filter.meetingMode : filter[key]
      if (f && f.strength === "must") {
        const without = { ...filter }
        delete without[key]
        if (key === "places") delete without.meetingMode
        relax[key] = applyFilter(allSlots, without, places).length
      }
    }
  }

  return {
    outcome: !ranked.length ? (allSlots.length ? "must_no_results" : "no_availability") : ranked.some(r => RELAXABLE.every(k => {
      const strength = strengthOf(filter, k)
      return strength !== "strong" && strength !== "weak" || matchesDimension(r.slot, filter, k, places)
    })) ? "available" : "preference_mismatch",
    topClientScoreUnits: ranked.length ? clientUnits(ranked[0]) : null,
    topHostScoreUnits: ranked.length ? hostUnits(ranked[0]) : null,
    count: ranked.length,
    firstDate: first,
    lastDate: last,
    byWeek: [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([weekStart, count]) => ({ weekStart, count })),
    byWeekday,
    byTimeOfDay,
    byPlace,
    byMeetingType,
    topScore,
    tieCountAtTop,
    relax,
  }
}
