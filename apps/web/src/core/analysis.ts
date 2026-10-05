import type { AnalysisEvent as NormalizedEvent } from './calendar'
import { kstParts, type TimeRange } from './time'
export type Classification = 'business' | 'personal' | 'unknown'
export interface AnalysisEvent extends NormalizedEvent {
 classification?: Classification; userClassification?: Classification; providerClassification?: Classification
}
export function resolveClassification(event: Pick<AnalysisEvent, 'classification' | 'userClassification' | 'providerClassification'>): Classification {
 return event.userClassification ?? event.providerClassification ?? event.classification ?? 'unknown'
}
/** Observations only. Historical late meetings never authorize future meetings. */
export function analyzeHistory(events: AnalysisEvent[], range: TimeRange) {
 if (!Number.isSafeInteger(range.fromMs) || !Number.isSafeInteger(range.toMs) || range.fromMs >= range.toMs) throw new RangeError('Invalid analysis range')
 const eligible = events.filter(e => e.startMs >= range.fromMs && e.startMs < range.toMs)
 const counts = {business:0, personal:0, unknown:0}, businessByWeekday = Array<number>(7).fill(0)
 const businessStartMinutes: number[] = [], lateBusinessEventIds: string[] = [], business: AnalysisEvent[] = []
 let classified = 0
 for (const e of eligible) {
  const label = resolveClassification(e); counts[label]++
  if (e.userClassification !== undefined || e.providerClassification !== undefined || e.classification !== undefined) classified++
  if (label === 'business') {
   const parts = kstParts(e.startMs); businessByWeekday[parts.weekday]++; businessStartMinutes.push(parts.minuteOfDay)
   if (parts.minuteOfDay >= 18*60) lateBusinessEventIds.push(e.id)
   business.push(e)
  }
 }
 return {counts, coverage:{eligible:eligible.length, classified, partial:classified < eligible.length}, businessByWeekday, businessStartMinutes, lateBusinessEventIds, estimate:estimateFromBusiness(business)}
}

/** Fewer business events than this and a "typical" hour would be one or two meetings dressed up as a pattern. */
export const MIN_EVENTS_FOR_ESTIMATE = 4
const HOUR_MS = 3_600_000
const pct = (sorted: number[], p: number) => sorted[Math.round((sorted.length - 1) * p)]
const down30 = (m: number) => Math.floor(m / 30) * 30, up30 = (m: number) => Math.min(1440, Math.ceil(m / 30) * 30)
export interface HistoryEstimate {
 basedOn: number
 /** The span business events fall in: early (10th percentile) first start to late (90th percentile) last end across days, and the weekdays used. */
 workHours: {startMin: number; endMin: number; weekdays: number[]} | null
 /** Where meetings (business events up to 3 hours) usually started (middle half of start times). */
 meetingStarts: {fromMin: number; toMin: number} | null
 /** Location kinds of business events whose location is known, most frequent first. */
 places: {kind: 'office' | 'place' | 'online'; count: number}[]
}
/**
 * Tendencies read from past business events — said to the user as an estimate, never written into the profile by itself.
 * Multi-day and all-day blocks are left out: they say nothing about hours.
 */
export function estimateFromBusiness(events: AnalysisEvent[]): HistoryEstimate {
 const timed = events.filter(e => e.endMs - e.startMs < 12 * HOUR_MS && kstParts(e.startMs).weekday === kstParts(e.endMs - 1).weekday)
 const enough = timed.length >= MIN_EVENTS_FOR_ESTIMATE
 // Per day: when the first business event began and the last one ended. Meetings alone rarely fill a day, so the span over
 // days says more about working hours than the median day does; the outer 10% are left out as one-offs.
 const byDay = new Map<string, {first: number; last: number; n: number}>()
 for (const e of timed) {
  const s = kstParts(e.startMs), end = kstParts(e.endMs - 1).minuteOfDay + 1, key = `${s.year}-${s.month}-${s.day}`, d = byDay.get(key)
  byDay.set(key, {first: Math.min(d?.first ?? 1440, s.minuteOfDay), last: Math.max(d?.last ?? 0, end), n: (d?.n ?? 0) + 1})
 }
 // A day with a single meeting only shows that meeting, not the working day around it.
 const spansDays = pct([...byDay.values()].map(d => d.n).sort((a, b) => a - b), 0.5) >= 2
 const firsts = [...byDay.values()].map(d => d.first).sort((a, b) => a - b), lasts = [...byDay.values()].map(d => d.last).sort((a, b) => a - b)
 const meetings = timed.filter(e => e.endMs - e.startMs <= 3 * HOUR_MS).map(e => kstParts(e.startMs).minuteOfDay).sort((a, b) => a - b)
 const counts = new Map<'office' | 'place' | 'online', number>()
 for (const e of events) if (e.kind === 'office' || e.kind === 'place' || e.kind === 'online') counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1)
 return {
  basedOn: timed.length,
  workHours: enough && byDay.size >= 3 && spansDays ? {startMin: down30(pct(firsts, 0.1)), endMin: up30(pct(lasts, 0.9)), weekdays: [...new Set(timed.map(e => kstParts(e.startMs).weekday))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))} : null,
  meetingStarts: meetings.length >= MIN_EVENTS_FOR_ESTIMATE ? {fromMin: down30(pct(meetings, 0.25)), toMin: up30(pct(meetings, 0.75) + 1)} : null,
  places: [...counts].map(([kind, count]) => ({kind, count})).sort((a, b) => b.count - a.count),
 }
}
