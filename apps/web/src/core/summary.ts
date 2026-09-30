import { applyFilter } from "./filter"
import { kstDateString, kstParts, kstWeekStart } from "./time"
import type { Filter, RankedSlot, Slot, Summary } from "./types"

const RELAXABLE = ["dateRange", "weekdays", "timeOfDay", "places", "meetingTypes"] as const
const EPS = 1e-9

export function summarize(ranked: RankedSlot[], filter: Filter, allSlots: Slot[]): Summary {
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
  const tieCountAtTop = topScore === null ? 0 : ranked.filter((r) => Math.abs(r.score - topScore) < EPS).length

  const relax: Summary["relax"] = {}
  if (ranked.length === 0) {
    for (const key of RELAXABLE) {
      const f = filter[key]
      if (f && f.strength === "must") {
        const without = { ...filter }
        delete without[key]
        relax[key] = applyFilter(allSlots, without).length
      }
    }
  }

  return {
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
